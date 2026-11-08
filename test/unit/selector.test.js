import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectCallbackMode } from '../../lib/callback/selector.js'
import { CallbackError } from '../../lib/oauth/errors.js'

/**
 * Build a fake receiver handle.
 *
 * @param {string} url The redirect URI of the receiver.
 * @returns {{ url: string, close: () => void, closed: boolean }} The handle.
 */
function createHandle(url) {
  return {
    url,
    closed: false,
    close() {
      this.closed = true
    },
  }
}

test('the selector starts the loopback receiver in dedicated-port mode', async () => {
  const handle = createHandle('http://127.0.0.1:39271/oauth-mcp/callback')
  let loopbackCalls = 0
  let hostWebCalls = 0

  const selector = await selectCallbackMode({
    configuredMode: 'dedicated-port',
    startLoopback: async () => {
      loopbackCalls += 1
      return handle
    },
    startHostWeb: async () => {
      hostWebCalls += 1
      return createHandle('http://127.0.0.1:64188/oauth-mcp/callback')
    },
  })

  assert.equal(selector.mode, 'dedicated-port')
  assert.equal(selector.redirectUri, 'http://127.0.0.1:39271/oauth-mcp/callback')
  assert.equal(loopbackCalls, 1)
  assert.equal(hostWebCalls, 0)
})

test('the selector reports the running mode when it is started', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'dedicated-port',
    startLoopback: async () => createHandle('http://127.0.0.1:39271/oauth-mcp/callback'),
  })

  const started = await selector.start()
  assert.equal(started.mode, 'dedicated-port')
  assert.equal(started.redirectUri, 'http://127.0.0.1:39271/oauth-mcp/callback')
})

test('the selector falls back to host-web when the loopback port is busy', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'dedicated-port',
    startLoopback: async () => {
      throw new CallbackError('The loopback callback port is already in use.', {
        code: 'callback_conflict',
      })
    },
    startHostWeb: async () => createHandle('http://127.0.0.1:64188/oauth-mcp/callback'),
  })

  assert.equal(selector.mode, 'host-web')
  assert.equal(selector.redirectUri, 'http://127.0.0.1:64188/oauth-mcp/callback')
})

test('the selector falls back to manual-only when nothing else works', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'dedicated-port',
    startLoopback: async () => {
      const error = new Error('listen EADDRINUSE: address already in use')
      error.code = 'EADDRINUSE'
      throw error
    },
    startHostWeb: async () => {
      throw new Error('the host web server is not bound')
    },
  })

  assert.equal(selector.mode, 'manual-only')
  assert.equal(selector.redirectUri, '')
})

test('the selector starts the host-web receiver', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'host-web',
    startLoopback: async () => createHandle('http://127.0.0.1:39271/oauth-mcp/callback'),
    startHostWeb: async () => createHandle('http://127.0.0.1:64188/oauth-mcp/callback'),
  })

  assert.equal(selector.mode, 'host-web')
  assert.equal(selector.redirectUri, 'http://127.0.0.1:64188/oauth-mcp/callback')
})

test('the selector falls back to manual-only when the host web server is unavailable', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'host-web',
    startHostWeb: async () => {
      throw new Error('the host web server is not bound')
    },
  })

  assert.equal(selector.mode, 'manual-only')
  assert.equal(selector.redirectUri, '')
})

test('the selector starts no listener in manual-only mode', async () => {
  let loopbackCalls = 0
  let hostWebCalls = 0

  const selector = await selectCallbackMode({
    configuredMode: 'manual-only',
    startLoopback: async () => {
      loopbackCalls += 1
      return createHandle('http://127.0.0.1:39271/oauth-mcp/callback')
    },
    startHostWeb: async () => {
      hostWebCalls += 1
      return createHandle('http://127.0.0.1:64188/oauth-mcp/callback')
    },
  })

  assert.equal(selector.mode, 'manual-only')
  assert.equal(selector.redirectUri, '')
  assert.equal(loopbackCalls, 0)
  assert.equal(hostWebCalls, 0)
})

test('the selector treats an unknown mode as dedicated-port', async () => {
  const selector = await selectCallbackMode({
    configuredMode: 'something-else',
    startLoopback: async () => createHandle('http://127.0.0.1:39271/oauth-mcp/callback'),
  })

  assert.equal(selector.mode, 'dedicated-port')
})

test('the selector closes the receiver when it is stopped', async () => {
  const handle = createHandle('http://127.0.0.1:39271/oauth-mcp/callback')
  const selector = await selectCallbackMode({
    configuredMode: 'dedicated-port',
    startLoopback: async () => handle,
  })

  await selector.stop()
  assert.equal(handle.closed, true)
})

test('the selector reports a loopback failure that is not a port conflict', async () => {
  await assert.rejects(
    () =>
      selectCallbackMode({
        configuredMode: 'dedicated-port',
        startLoopback: async () => {
          throw new Error('the receiver could not be created')
        },
        startHostWeb: async () => createHandle('http://127.0.0.1:64188/oauth-mcp/callback'),
      }),
    /the receiver could not be created/,
  )
})
