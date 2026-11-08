/**
 * Tests of the service that sits between the host and the OAuth modules.
 *
 * The service owns the pending authorizations, the state index and the
 * decisions about which credential goes into a request. It had no test file
 * for a long time, so the timeout, the cancellation and the client secret
 * were never pinned down.
 *
 * @module dsh-oauth-mcp/test/unit/service
 */

import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { createOauthMcpService } from '../../lib/service.js'

/**
 * The services built by `createService`, released after every test.
 *
 * The timer of a pending authorization is ref'd on purpose (see
 * `lib/http/timeout.js`), so a service that is left with a pending
 * authorization keeps the event loop alive. Every test therefore gives its
 * service back when it is done.
 *
 * @type {Array<{ dispose: () => void }>}
 */
const services = []

/**
 * Release every service that a test left behind.
 *
 * @returns {void}
 */
afterEach(() => {
  while (services.length > 0) {
    services.pop()?.dispose()
  }
})

/**
 * Build a service with fake collaborators.
 *
 * @param {object} [options] The options.
 * @param {object[]} [options.servers] The configured servers.
 * @param {object} [options.grant] The stored grant.
 * @param {number} [options.authorizationTimeoutMs] The timeout of an authorization.
 * @returns {object} The service and the recorded calls.
 */
function createService(options = {}) {
  const calls = { starts: [], cancels: [], saved: [], loads: [] }
  const serverList = options.servers ?? [
    { id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp', enabled: true },
  ]
  let grant = options.grant

  const service = createOauthMcpService({
    ctx: {},
    config: {
      defaultScopes: [],
      authorizationTimeoutMs: options.authorizationTimeoutMs ?? 300000,
    },
    servers: {
      get: (id) => serverList.find((server) => server.id === id),
      list: () => serverList,
      upsert: async (server) => server,
      remove: async () => {},
    },
    tokens: {
      load: async (id) => {
        calls.loads.push(id)
        return grant
      },
      save: async (id, payload) => {
        calls.saved.push({ id, payload })
        grant = payload
        return payload
      },
      delete: async () => {
        grant = undefined
      },
    },
    refresher: { refreshIfNeeded: async () => grant },
    authorizer: {
      start: async (request) => {
        calls.starts.push(request)
        return {
          authorizationUrl: 'https://as.example.com/authorize?state=the-state',
          state: 'the-state',
          expiresAt: Date.now() + 60000,
          clientId: request.clientId ?? 'registered-client',
        }
      },
      complete: async () => ({ payload: { serverId: 'mock', accessToken: 'the-token' } }),
      cancel: async (id) => {
        calls.cancels.push(id)
      },
    },
    callback: { redirectUri: 'http://127.0.0.1:39271/oauth-mcp/callback', mode: 'dedicated-port' },
    connections: {
      get: () => undefined,
      connect: async () => {},
      disconnect: async () => {},
    },
    credentialStatus: () => 'ready',
    logger: { info() {}, warn() {}, error() {} },
  })

  services.push(service)
  return { service, calls }
}

test('the configured client secret goes into the authorization request', async () => {
  const { service, calls } = createService({
    servers: [
      {
        id: 'mock',
        label: 'Mock',
        url: 'https://mcp.example.com/mcp',
        clientId: 'the-client-id',
        clientSecret: 'the-client-secret',
        enabled: true,
      },
    ],
  })

  await service.beginAuthorization({ serverId: 'mock' })

  assert.equal(calls.starts.length, 1)
  assert.equal(calls.starts[0].clientId, 'the-client-id')
  assert.equal(calls.starts[0].clientSecret, 'the-client-secret')
})

test('the secret of an earlier grant is used when the configuration has none', async () => {
  const { service, calls } = createService({
    grant: { serverId: 'mock', clientId: 'the-client-id', clientSecret: 'the-old-secret' },
  })

  await service.beginAuthorization({ serverId: 'mock' })

  assert.equal(calls.starts[0].clientSecret, 'the-old-secret')
})

test('the secret of the configuration wins over the one of an earlier grant', async () => {
  const { service, calls } = createService({
    servers: [
      {
        id: 'mock',
        label: 'Mock',
        url: 'https://mcp.example.com/mcp',
        clientId: 'the-client-id',
        clientSecret: 'the-new-secret',
        enabled: true,
      },
    ],
    grant: { serverId: 'mock', clientId: 'the-client-id', clientSecret: 'the-old-secret' },
  })

  await service.beginAuthorization({ serverId: 'mock' })

  assert.equal(calls.starts[0].clientSecret, 'the-new-secret')
})

test('a second authorization of one server is refused', async () => {
  const { service } = createService()

  await service.beginAuthorization({ serverId: 'mock' })

  await assert.rejects(
    () => service.beginAuthorization({ serverId: 'mock' }),
    (error) => {
      assert.equal(error.code, 'authorization_in_flight')
      return true
    },
    'the second authorization is refused',
  )
})

test('an authorization that times out is over', async () => {
  const { service, calls } = createService({ authorizationTimeoutMs: 20 })

  await service.beginAuthorization({ serverId: 'mock' })
  const waiting = service.waitForCompletion('mock')

  await assert.rejects(
    () => waiting,
    (error) => {
      assert.equal(error.code, 'authorization_timeout')
      return true
    },
    'the waiting caller learns about the timeout',
  )
  assert.deepEqual(calls.cancels, ['mock'], 'the authorizer forgot the request')
})

test('an authorization can be cancelled', async () => {
  const { service, calls } = createService()

  await service.beginAuthorization({ serverId: 'mock' })
  const waiting = service.waitForCompletion('mock')
  const outcome = await service.cancelAuthorization('mock')

  assert.equal(outcome.cancelled, true)
  assert.deepEqual(calls.cancels, ['mock'], 'the authorizer forgot the request')
  await assert.rejects(
    () => waiting,
    (error) => {
      assert.equal(error.code, 'authorization_cancelled')
      return true
    },
    'the waiting caller learns about the cancellation',
  )
})

test('cancelling a server without an authorization says so', async () => {
  const { service } = createService()

  const outcome = await service.cancelAuthorization('mock')

  assert.equal(outcome.cancelled, false)
})
