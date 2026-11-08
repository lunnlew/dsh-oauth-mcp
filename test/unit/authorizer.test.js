import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PkceUnsupportedError,
  RegistrationUnsupportedError,
  StateError,
} from '../../lib/oauth/errors.js'
import { createAuthorizer } from '../../lib/oauth/authorizer.js'
import { createStateStore } from '../../lib/oauth/pkce.js'
import * as authorizeRequest from '../../lib/oauth/authorize-request.js'

/**
 * Build a fake discovery module.
 *
 * @param {object} [overrides] The members to replace.
 * @returns {object} The fake discovery module.
 */
function createDiscovery(overrides = {}) {
  return {
    async discoverProtectedResource(resourceUrl) {
      return {
        metadata: { resource: resourceUrl, authorization_servers: ['https://as.example.com'] },
        metadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      }
    },
    async discoverAuthorizationServer(issuerUrl) {
      return {
        metadata: {
          issuer: issuerUrl,
          authorization_endpoint: 'https://as.example.com/authorize',
          token_endpoint: 'https://as.example.com/token',
          code_challenge_methods_supported: ['S256'],
          registration_endpoint: 'https://as.example.com/register',
        },
        metadataUrl: `${issuerUrl}/.well-known/oauth-authorization-server`,
      }
    },
    ...overrides,
  }
}

/**
 * Build the collaborators of an authorizer.
 *
 * @param {object} [options] The parts to replace.
 * @returns {object} The collaborators and their call logs.
 */
function createCollaborators(options = {}) {
  const tokenCalls = []
  const registerCalls = []
  const discoveryCalls = []
  return {
    tokenCalls,
    registerCalls,
    discoveryCalls,
    http: { getJson: async () => ({}) },
    stateStore: createStateStore(),
    discovery: createDiscovery({
      async discoverProtectedResource(resourceUrl) {
        discoveryCalls.push({ fn: 'discoverProtectedResource', resourceUrl })
        return {
          metadata: { resource: resourceUrl, authorization_servers: ['https://as.example.com'] },
          metadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
        }
      },
      async discoverAuthorizationServer(issuerUrl) {
        discoveryCalls.push({ fn: 'discoverAuthorizationServer', issuerUrl })
        return {
          metadata: {
            issuer: issuerUrl,
            authorization_endpoint: 'https://as.example.com/authorize',
            token_endpoint: 'https://as.example.com/token',
            code_challenge_methods_supported: ['S256'],
            registration_endpoint: 'https://as.example.com/register',
            ...(options.authorizationServerMetadata ?? {}),
          },
          metadataUrl: `${issuerUrl}/.well-known/oauth-authorization-server`,
        }
      },
    }),
    register: {
      async registerClient(params) {
        registerCalls.push(params)
        return { clientId: 'registered-client', clientSecret: 'registered-secret' }
      },
    },
    buildAuthorizeRequest: authorizeRequest,
    token: {
      async exchangeAuthorizationCode(params) {
        tokenCalls.push(params)
        return {
          access_token: 'the-token',
          refresh_token: 'the-refresh-token',
          expires_in: 3600,
          scope: 'read write',
        }
      },
    },
    now: () => 1_700_000_000_000,
  }
}

/**
 * Build an authorization request for one server.
 *
 * @param {object} [overrides] The values to replace.
 * @returns {object} The request.
 */
function startRequest(overrides = {}) {
  return {
    serverId: 'server-a',
    serverUrl: 'https://mcp.example.com/mcp',
    redirectUri: 'http://127.0.0.1:53219/callback',
    scopes: ['read', 'write'],
    ...overrides,
  }
}

test('the authorizer needs an HTTP client and a state store', () => {
  assert.throws(() => createAuthorizer({ stateStore: createStateStore() }), TypeError)
  assert.throws(() => createAuthorizer({ http: {} }), TypeError)
})

test('starting an authorization returns the URL to open and exchanges nothing', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  const started = await authorizer.start(startRequest({ clientId: 'client-1' }))

  assert.equal(started.clientId, 'client-1')
  assert.equal(typeof started.state, 'string')
  assert.equal(typeof started.expiresAt, 'number')
  assert.equal(started.resource, 'https://mcp.example.com/mcp')
  assert.equal(started.issuer, 'https://as.example.com')
  assert.equal(started.authorizationEndpoint, 'https://as.example.com/authorize')
  assert.equal(started.tokenEndpoint, 'https://as.example.com/token')
  assert.equal(started.authorizationUrl.startsWith('https://as.example.com/authorize?'), true)
  assert.equal(started.authorizationUrl.includes(`state=${started.state}`), true)
  assert.equal(started.authorizationUrl.includes('code_challenge_method=S256'), true)
  assert.equal(started.authorizationUrl.includes('resource=https%3A%2F%2Fmcp.example.com%2Fmcp'), true)
  assert.equal(collaborators.tokenCalls.length, 0)
})

test('the authorization server is taken from the protected-resource metadata', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  await authorizer.start(startRequest({ clientId: 'client-1' }))

  const protectedResource = collaborators.discoveryCalls.find(
    (call) => call.fn === 'discoverProtectedResource',
  )
  const authorizationServer = collaborators.discoveryCalls.find(
    (call) => call.fn === 'discoverAuthorizationServer',
  )
  assert.equal(protectedResource.resourceUrl, 'https://mcp.example.com/mcp')
  assert.equal(authorizationServer.issuerUrl, 'https://as.example.com')
})

test('an explicit authorization server skips the protected-resource discovery', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  await authorizer.start(
    startRequest({ clientId: 'client-1', authorizationServerUrl: 'https://as.example.com' }),
  )

  const names = collaborators.discoveryCalls.map((call) => call.fn)
  assert.equal(names.includes('discoverProtectedResource'), false)
  assert.equal(names.includes('discoverAuthorizationServer'), true)
})

test('a client is registered when the user configured none', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  const started = await authorizer.start(startRequest())

  assert.equal(collaborators.registerCalls.length, 1)
  assert.deepEqual(collaborators.registerCalls[0].redirectUris, ['http://127.0.0.1:53219/callback'])
  assert.equal(started.clientId, 'registered-client')
  assert.equal(started.clientSecret, 'registered-secret')
})

test('a server without a registration endpoint is refused', async () => {
  const collaborators = createCollaborators()
  collaborators.discovery = createDiscovery({
    async discoverAuthorizationServer(issuerUrl) {
      return {
        metadata: {
          issuer: issuerUrl,
          authorization_endpoint: 'https://as.example.com/authorize',
          token_endpoint: 'https://as.example.com/token',
        },
        metadataUrl: `${issuerUrl}/.well-known/oauth-authorization-server`,
      }
    },
  })
  const authorizer = createAuthorizer(collaborators)

  await assert.rejects(
    () => authorizer.start(startRequest()),
    (error) => {
      assert.ok(error instanceof RegistrationUnsupportedError)
      return true
    },
  )
})

test('a server without the S256 code challenge method is refused', async () => {
  const collaborators = createCollaborators({
    authorizationServerMetadata: { code_challenge_methods_supported: ['plain'] },
  })
  const authorizer = createAuthorizer(collaborators)

  await assert.rejects(
    () => authorizer.start(startRequest({ clientId: 'client-1' })),
    (error) => {
      assert.ok(error instanceof PkceUnsupportedError)
      return true
    },
  )
})

test('completing the authorization exchanges the code and returns the payload', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)
  const started = await authorizer.start(startRequest({ clientId: 'client-1' }))

  const { payload } = await authorizer.complete({
    serverId: 'server-a',
    code: 'the-code',
    state: started.state,
  })

  assert.equal(collaborators.tokenCalls.length, 1)
  assert.equal(collaborators.tokenCalls[0].code, 'the-code')
  assert.equal(collaborators.tokenCalls[0].tokenEndpoint, 'https://as.example.com/token')
  assert.equal(collaborators.tokenCalls[0].clientId, 'client-1')
  assert.equal(typeof collaborators.tokenCalls[0].codeVerifier, 'string')
  assert.equal(payload.serverId, 'server-a')
  assert.equal(payload.serverUrl, 'https://mcp.example.com/mcp')
  assert.equal(payload.resource, 'https://mcp.example.com/mcp')
  assert.equal(payload.clientId, 'client-1')
  assert.equal(payload.accessToken, 'the-token')
  assert.equal(payload.refreshToken, 'the-refresh-token')
  assert.equal(payload.tokenType, 'Bearer')
  assert.equal(payload.redirectUri, 'http://127.0.0.1:53219/callback')
  assert.deepEqual(payload.scopes, ['read', 'write'])
  assert.equal(payload.obtainedAt, 1_700_000_000_000)
  assert.equal(payload.expiresAt, 1_700_000_000_000 + 3_600_000)
})

test('two authorizations of one server are completed with their own request', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  // The user starts a second authorization before the first callback arrives.
  const first = await authorizer.start(startRequest({ clientId: 'client-1' }))
  const second = await authorizer.start(startRequest({ clientId: 'client-1' }))

  await authorizer.complete({ serverId: 'server-a', code: 'the-code', state: first.state })
  await authorizer.complete({ serverId: 'server-a', code: 'the-code', state: second.state })

  assert.equal(collaborators.tokenCalls.length, 2, 'both callbacks were exchanged')
  assert.notEqual(
    collaborators.tokenCalls[0].codeVerifier,
    collaborators.tokenCalls[1].codeVerifier,
    'every callback is exchanged with the code verifier of its own request',
  )
})

test('a state that does not match is refused and nothing is exchanged', async () => {  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)
  await authorizer.start(startRequest({ clientId: 'client-1' }))

  await assert.rejects(
    () => authorizer.complete({ serverId: 'server-a', code: 'the-code', state: 'another-state' }),
    (error) => {
      assert.ok(error instanceof StateError)
      assert.equal(error.code, 'state_invalid')
      return true
    },
  )
  assert.equal(collaborators.tokenCalls.length, 0)
})

test('a state can be used only once', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)
  const started = await authorizer.start(startRequest({ clientId: 'client-1' }))
  await authorizer.complete({ serverId: 'server-a', code: 'the-code', state: started.state })

  await assert.rejects(
    () => authorizer.complete({ serverId: 'server-a', code: 'the-code', state: started.state }),
    (error) => {
      assert.ok(error instanceof StateError)
      return true
    },
  )
})

test('cancelling drops the pending request', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)
  const started = await authorizer.start(startRequest({ clientId: 'client-1' }))

  await authorizer.cancel('server-a')

  await assert.rejects(
    () => authorizer.complete({ serverId: 'server-a', code: 'the-code', state: started.state }),
    (error) => {
      assert.ok(error instanceof StateError)
      return true
    },
  )
  assert.equal(collaborators.tokenCalls.length, 0)
})

test('the server identifier and the redirect URI are required', async () => {
  const collaborators = createCollaborators()
  const authorizer = createAuthorizer(collaborators)

  await assert.rejects(() => authorizer.start(startRequest({ serverId: '' })), TypeError)
  await assert.rejects(() => authorizer.start(startRequest({ serverUrl: '' })), TypeError)
  await assert.rejects(() => authorizer.start(startRequest({ redirectUri: '' })), TypeError)
})
