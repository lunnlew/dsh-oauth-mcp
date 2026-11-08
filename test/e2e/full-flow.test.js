/**
 * End-to-end test: a full authorization-code + PKCE flow against the mock
 * authorization server, followed by a real MCP tool call against the mock MCP
 * server, followed by a token refresh and a 401 replay.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { withMockServers } from '../setup.js'
import { createHttpClient } from '../../lib/http/client.js'
import { createStateStore } from '../../lib/oauth/pkce.js'
import { createAuthorizer } from '../../lib/oauth/authorizer.js'
import { canonicalResource } from '../../lib/oauth/resource.js'
import { createMcpSession } from '../../lib/mcp/session.js'
import { createAuthFetch } from '../../lib/mcp/auth-fetch.js'
import { createTokenStore } from '../../lib/store/token-store.js'
import { createRefresher } from '../../lib/store/refresher.js'

const REDIRECT_URI = 'http://127.0.0.1:39271/oauth-mcp/callback'

/**
 * A minimal in-memory stand-in for the host credential service.
 *
 * @returns {{ records: Map<string, object>, service: object }} The fake service.
 */
function fakeCredentials() {
  const records = new Map()
  return {
    records,
    service: {
      readRecord: async (key) => records.get(key),
      describeRecord: async (key) => ({ key, kind: records.get(key)?.kind }),
      listRecords: async () => [...records.keys()],
      modifyRecord: async (key, mutate) => {
        const next = await mutate(records.get(key))
        if (next === undefined) records.delete(key)
        else records.set(key, next)
        return records.get(key)
      },
      deleteRecord: async (key) => {
        records.delete(key)
      },
    },
  }
}

/**
 * Run the browser half of the flow: open the authorization URL and follow the
 * redirect of the authorization server.
 *
 * @param {string} authorizationUrl The URL the user has to open.
 * @returns {Promise<{ code: string, state: string }>} The authorization code and the state.
 */
async function followAuthorization(authorizationUrl) {
  const response = await fetch(authorizationUrl, { redirect: 'manual' })
  assert.equal(response.status, 302, 'the authorization server redirects back')
  const location = new URL(response.headers.get('location'))
  const code = location.searchParams.get('code')
  const state = location.searchParams.get('state')
  assert.ok(code, 'the redirect carries an authorization code')
  assert.ok(state, 'the redirect carries the state')
  return { code, state }
}

test('the full authorization flow issues a token and calls a remote tool', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const http = createHttpClient()
    const stateStore = createStateStore()
    const authorizer = createAuthorizer({ http, stateStore })

    const started = await authorizer.start({
      serverId: 'mock',
      serverUrl: mcp.endpoint,
      scopes: ['read'],
      redirectUri: REDIRECT_URI,
    })

    // The authorization request must carry everything RFC 9700 / the MCP
    // authorization profile ask for.
    const authorizeUrl = new URL(started.authorizationUrl)
    assert.equal(authorizeUrl.searchParams.get('response_type'), 'code')
    assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(authorizeUrl.searchParams.get('code_challenge'))
    assert.equal(authorizeUrl.searchParams.get('redirect_uri'), REDIRECT_URI)
    assert.equal(authorizeUrl.searchParams.get('resource'), canonicalResource(mcp.endpoint))
    assert.equal(authorizeUrl.searchParams.get('scope'), 'read')
    assert.ok(started.clientId, 'the client was registered')

    const { code, state } = await followAuthorization(started.authorizationUrl)
    assert.equal(state, started.state)

    const completed = await authorizer.complete({ serverId: 'mock', code, state })
    assert.match(completed.payload.accessToken, /^mock-access-token-/)
    assert.equal(completed.payload.tokenType, 'Bearer')
    assert.ok(completed.payload.refreshToken, 'the grant carries a refresh token')
    assert.equal(completed.payload.resource, canonicalResource(mcp.endpoint))

    // The state may be used only once.
    await assert.rejects(() => authorizer.complete({ serverId: 'mock', code, state }))

    // The MCP call must carry the bearer token: the mock server rejects every
    // request without one.
    mcp.setScenario({ 'require-auth': true })
    const authFetch = createAuthFetch({
      getAccessToken: () => completed.payload.accessToken,
    })
    const session = await createMcpSession({ url: mcp.endpoint, fetchImpl: authFetch })
    try {
      const tools = await session.request('tools/list')
      const names = tools.tools.map((tool) => tool.name).sort()
      assert.deepEqual(names, ['add', 'echo'])

      const result = await session.request('tools/call', {
        name: 'echo',
        arguments: { text: 'hello' },
      })
      const text = result.content.map((block) => block.text ?? '').join('')
      assert.match(text, /hello/)
    } finally {
      await session.close()
    }

    const calls = mcp.state().calls
    assert.ok(calls.length > 0, 'the mock MCP recorded the calls')
    assert.ok(
      calls.some((call) => call.method === 'tools/call' && call.toolName === 'echo'),
      'the tool call reached the MCP server',
    )
    // The bearer token is the whole point of the plugin: the request has to
    // carry the token the authorization server issued.
    const listing = calls.find((call) => call.method === 'tools/list')
    assert.ok(listing, 'the mock MCP received a tools/list')
    assert.match(
      String(listing.authorization ?? ''),
      /^Bearer mock-access-token-/,
      'the request carried the bearer token',
    )
  })
})

test('an expired token is refreshed once and the request is replayed', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const http = createHttpClient()
    const stateStore = createStateStore()
    const authorizer = createAuthorizer({ http, stateStore })

    const started = await authorizer.start({
      serverId: 'mock',
      serverUrl: mcp.endpoint,
      scopes: ['read'],
      redirectUri: REDIRECT_URI,
    })
    const { code, state } = await followAuthorization(started.authorizationUrl)
    const completed = await authorizer.complete({ serverId: 'mock', code, state })

    const { service: credentials } = fakeCredentials()
    const tokenStore = createTokenStore({ credentials, logger: { warn() {}, error() {}, info() {} } })

    // Pretend the grant is already stale.
    await tokenStore.save('mock', { ...completed.payload, expiresAt: Date.now() - 1000 })

    const refresher = createRefresher({ tokenStore, http })
    const refreshed = await refresher.refreshIfNeeded('mock')
    assert.ok(refreshed, 'the refresher returned a grant')
    assert.notEqual(refreshed.accessToken, completed.payload.accessToken, 'a new access token was issued')
    assert.ok(refreshed.refreshToken)
    assert.notEqual(refreshed.refreshToken, completed.payload.refreshToken, 'the refresh token was rotated')

    // The 401 path: the MCP server rejects the stale token, the auth fetch
    // refreshes once and replays the request once.
    mcp.setScenario({ 'require-auth': true })
    let refreshCalls = 0
    let currentToken = 'stale-access-token'
    const authFetch = createAuthFetch({
      getAccessToken: () => currentToken,
      refresh: async () => {
        refreshCalls += 1
        currentToken = refreshed.accessToken
        return refreshed.accessToken
      },
    })
    const session = await createMcpSession({ url: mcp.endpoint, fetchImpl: authFetch })
    try {
      assert.equal(refreshCalls, 1, 'the rejected handshake was refreshed exactly once')
      const tools = await session.request('tools/list')
      assert.ok(Array.isArray(tools.tools))
      assert.equal(refreshCalls, 1, 'the replayed request needed no second refresh')
    } finally {
      await session.close()
    }
  })
})

test('a server without dynamic registration can still use a known client id', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const http = createHttpClient()
    const stateStore = createStateStore()
    const authorizer = createAuthorizer({ http, stateStore })

    // Register a client by hand, then turn dynamic registration off.
    const registered = await http.postJson(`${as.url}/register`, {
      client_name: 'DSH (dsh-oauth-mcp)',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    as.setScenario({ 'no-registration-endpoint': true })

    const started = await authorizer.start({
      serverId: 'mock',
      serverUrl: mcp.endpoint,
      clientId: registered.client_id,
      scopes: [],
      redirectUri: REDIRECT_URI,
    })
    assert.equal(started.clientId, registered.client_id)

    const { code, state } = await followAuthorization(started.authorizationUrl)
    const completed = await authorizer.complete({ serverId: 'mock', code, state })
    assert.match(completed.payload.accessToken, /^mock-access-token-/)
  })
})
