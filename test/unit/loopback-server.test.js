import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'

import { CallbackError } from '../../lib/oauth/errors.js'
import {
  renderErrorPage,
  renderSuccessPage,
  startLoopbackServer,
} from '../../lib/callback/loopback-server.js'
import { startHostWebCallback } from '../../lib/callback/host-web.js'

/**
 * Send one HTTP request and read the whole answer.
 *
 * @param {string} url The target URL.
 * @param {{ method?: string, headers?: Record<string, string> }} [options] Request options.
 * @returns {Promise<{ status: number, headers: object, body: string }>} The answer.
 */
function send(url, options = {}) {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const client = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    client.on('error', reject)
    client.end()
  })
}

/**
 * Build a fake Node response object.
 *
 * @returns {object} The fake response.
 */
function createFakeResponse() {
  return {
    headersSent: false,
    writableEnded: false,
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
    },
    end(body) {
      this.body = body
      this.writableEnded = true
    },
  }
}

test('the loopback receiver hands the query to the handler', async () => {
  const seen = []
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest({ query, respond }) {
      seen.push(query)
      respond({ status: 200, body: '<p>ok</p>' })
    },
  })

  try {
    const answer = await send(`${receiver.url}?code=abc&state=xyz`)
    assert.equal(answer.status, 200)
    assert.equal(answer.body, '<p>ok</p>')
    assert.equal(seen.length, 1)
    assert.ok(seen[0] instanceof URLSearchParams)
    assert.equal(seen[0].get('code'), 'abc')
    assert.equal(seen[0].get('state'), 'xyz')
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver serves the path a vendor demands as well', async () => {
  const seen = []
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    paths: ['/oauth-mcp/callback', '/callback'],
    onRequest({ query, respond }) {
      seen.push(query)
      respond({ status: 200, body: '<p>ok</p>' })
    },
  })

  try {
    const configured = await send(`${receiver.url}?code=abc&state=xyz`)
    assert.equal(configured.status, 200, 'the configured path is served')

    const demanded = await send(`http://127.0.0.1:${receiver.port}/callback?code=abc&state=xyz`)
    assert.equal(demanded.status, 200, 'the path of the vendor is served')

    const foreign = await send(`http://127.0.0.1:${receiver.port}/other?code=abc&state=xyz`)
    assert.equal(foreign.status, 404, 'any other path is still refused')

    assert.equal(seen.length, 2)
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver answers 405 to another method', async () => {
  let called = false
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest() {
      called = true
    },
  })

  try {
    const answer = await send(`${receiver.url}?code=abc&state=xyz`, { method: 'POST' })
    assert.equal(answer.status, 405)
    assert.equal(answer.headers.allow, 'GET')
    assert.equal(called, false)
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver rejects a foreign Host header', async () => {
  let called = false
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest() {
      called = true
    },
  })

  try {
    const answer = await send(`${receiver.url}?code=abc&state=xyz`, {
      headers: { host: 'evil.example.com' },
    })
    assert.equal(answer.status, 400)
    assert.equal(called, false)
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver answers 404 for another path', async () => {
  let called = false
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest() {
      called = true
    },
  })

  try {
    const answer = await send(`http://127.0.0.1:${receiver.port}/other?code=abc&state=xyz`)
    assert.equal(answer.status, 404)
    assert.equal(called, false)
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver refuses to bind another address', async () => {
  await assert.rejects(
    () =>
      startLoopbackServer({
        port: 0,
        path: '/oauth-mcp/callback',
        host: '0.0.0.0',
        onRequest() {},
      }),
    TypeError,
  )
})

test('the loopback receiver reports a busy port as a callback conflict', async () => {
  const occupied = await startLoopbackServer({ port: 0, path: '/oauth-mcp/callback', onRequest() {} })

  try {
    await assert.rejects(
      () => startLoopbackServer({ port: occupied.port, path: '/oauth-mcp/callback', onRequest() {} }),
      (error) => {
        assert.ok(error instanceof CallbackError)
        assert.equal(error.code, 'callback_conflict')
        return true
      },
    )
  } finally {
    await occupied.close()
  }
})

test('the loopback receiver answers 500 when the handler fails', async () => {
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest() {
      throw new Error('the handler exploded with a secret-value')
    },
  })

  try {
    const answer = await send(`${receiver.url}?code=abc&state=xyz`)
    assert.equal(answer.status, 500)
    assert.equal(answer.body.includes('secret-value'), false)
  } finally {
    await receiver.close()
  }
})

test('the loopback receiver stops listening when it is closed', async () => {
  const receiver = await startLoopbackServer({
    port: 0,
    path: '/oauth-mcp/callback',
    onRequest({ respond }) {
      respond({ status: 200, body: 'ok' })
    },
  })
  const url = receiver.url
  await receiver.close()

  await assert.rejects(() => send(url))
})

test('the success page carries no code, no token and no state', () => {
  const page = renderSuccessPage().toLowerCase()
  assert.equal(page.includes('code'), false)
  assert.equal(page.includes('token'), false)
  assert.equal(page.includes('state'), false)
  assert.ok(page.includes('authorization complete'))
})

test('the error page carries the OAuth error and a truncated description', () => {
  const page = renderErrorPage('invalid_request', 'a'.repeat(500))
  assert.ok(page.includes('invalid_request'))
  assert.ok(page.includes('…'))
  assert.equal(page.includes('a'.repeat(250)), false)
})

test('the error page redacts a secret in the description', () => {
  const page = renderErrorPage('invalid_request', 'access_token=super-secret-value')
  assert.equal(page.includes('super-secret-value'), false)
})

test('the host-web receiver registers the route and hands the query to the handler', async () => {
  const registered = []
  const removed = []
  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:64188'
    },
    register(route) {
      registered.push(route)
      return () => removed.push(route)
    },
  }
  const seen = []
  const receiver = await startHostWebCallback({
    webServer,
    path: '/oauth-mcp/callback',
    onRequest({ query, respond }) {
      seen.push(query)
      respond({ status: 200, body: '<p>ok</p>' })
    },
  })

  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'exact')
  assert.equal(registered[0].path, '/oauth-mcp/callback')
  assert.equal(receiver.origin, 'http://127.0.0.1:64188')
  assert.equal(receiver.url, 'http://127.0.0.1:64188/oauth-mcp/callback')

  const response = createFakeResponse()
  await registered[0].handler(
    {
      method: 'GET',
      url: '/oauth-mcp/callback?code=abc&state=xyz',
      headers: { origin: 'http://127.0.0.1:64188' },
    },
    response,
  )

  assert.equal(response.status, 200)
  assert.equal(response.body, '<p>ok</p>')
  assert.equal(seen.length, 1)
  assert.ok(seen[0] instanceof URLSearchParams)
  assert.equal(seen[0].get('code'), 'abc')

  receiver.close()
  assert.equal(removed.length, 1)
})

test('the host-web receiver rejects a foreign Origin', async () => {
  let called = false
  const registered = []
  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:64188'
    },
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  await startHostWebCallback({
    webServer,
    path: '/oauth-mcp/callback',
    onRequest() {
      called = true
    },
  })

  const response = createFakeResponse()
  await registered[0].handler(
    {
      method: 'GET',
      url: '/oauth-mcp/callback?code=abc&state=xyz',
      headers: { origin: 'http://evil.example.com' },
    },
    response,
  )

  assert.equal(response.status, 403)
  assert.equal(called, false)
})

test('the host-web receiver rejects a request without an Origin header', async () => {
  let called = false
  const registered = []
  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:64188'
    },
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  await startHostWebCallback({
    webServer,
    path: '/oauth-mcp/callback',
    onRequest() {
      called = true
    },
  })

  const response = createFakeResponse()
  await registered[0].handler(
    { method: 'GET', url: '/oauth-mcp/callback?code=abc&state=xyz', headers: {} },
    response,
  )

  assert.equal(response.status, 403)
  assert.equal(called, false)
})

test('the host-web receiver answers 405 to another method', async () => {
  const registered = []
  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:64188'
    },
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  await startHostWebCallback({
    webServer,
    path: '/oauth-mcp/callback',
    onRequest() {},
  })

  const response = createFakeResponse()
  await registered[0].handler(
    { method: 'POST', url: '/oauth-mcp/callback', headers: { origin: 'http://127.0.0.1:64188' } },
    response,
  )

  assert.equal(response.status, 405)
})

test('the host-web receiver reports an unbound web server', async () => {
  const webServer = {
    getOrigin() {
      throw new Error('the web server is not bound')
    },
    register() {
      throw new Error('the web server is not bound')
    },
  }

  await assert.rejects(
    () =>
      startHostWebCallback({
        webServer,
        path: '/oauth-mcp/callback',
        onRequest() {},
      }),
    (error) => {
      assert.ok(error instanceof CallbackError)
      return true
    },
  )
})

test('the host-web receiver reports a refused route', async () => {
  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:64188'
    },
    register() {
      throw new Error('the route is already taken')
    },
  }

  await assert.rejects(
    () =>
      startHostWebCallback({
        webServer,
        path: '/oauth-mcp/callback',
        onRequest() {},
      }),
    CallbackError,
  )
})
