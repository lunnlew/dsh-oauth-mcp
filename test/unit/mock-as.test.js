/**
 * Smoke tests for the mock authorization server and the mock MCP server.
 *
 * The tests only use the Node built-in test runner, so the suite runs with
 * `node --test test/unit/*.test.js` (Node 24 treats a directory argument as a
 * glob pattern and fails on it).
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import { AS_SCENARIO_NAMES, computeCodeChallenge, startMockAs } from '../support/mock-as.js'
import { MCP_SCENARIO_NAMES, startMockMcp } from '../support/mock-mcp.js'

const VERIFIER = 'mock-code-verifier-0123456789-0123456789-0123456789-012'
const CHALLENGE = computeCodeChallenge(VERIFIER)

/**
 * Build a scenario patch that switches every known scenario off.
 *
 * @param {string[]} names The scenario names to reset.
 * @returns {Record<string, false>} The reset patch.
 */
function resetPatch(names) {
  /** @type {Record<string, false>} */
  const patch = {}
  for (const name of names) patch[name] = false
  return patch
}

/**
 * Send a form encoded POST request.
 *
 * @param {string} url The target URL.
 * @param {Record<string, string>} params The form fields.
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>} The response.
 */
async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  return { status: response.status, body: await response.json() }
}

/**
 * Send a JSON-RPC request to the mock MCP server.
 *
 * @param {string} url The target URL.
 * @param {unknown} message The JSON-RPC message.
 * @param {Record<string, string>} [headers] Extra request headers.
 * @returns {Promise<Response>} The response.
 */
function postJsonRpc(url, message, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(message),
  })
}

/**
 * Perform a full authorization-code exchange against the mock server.
 *
 * @param {object} server The mock authorization server handle.
 * @param {Record<string, string>} [overrides] Extra query parameters.
 * @returns {Promise<{ code: string, tokens: Record<string, unknown> }>} The issued code and tokens.
 */
async function exchangeCode(server, overrides = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'mock-client-1',
    redirect_uri: 'http://127.0.0.1:9999/callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'mock-state',
    resource: `${server.url}/mcp`,
    ...overrides,
  })
  const response = await fetch(`${server.url}/authorize?${query.toString()}`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location'))
  const code = location.searchParams.get('code')
  assert.ok(code)
  const tokens = await postForm(`${server.url}/token`, {
    grant_type: 'authorization_code',
    code,
    code_verifier: VERIFIER,
    client_id: 'mock-client-1',
  })
  return { code, tokens }
}

describe('mock authorization server', () => {
  /** @type {Awaited<ReturnType<typeof startMockAs>>} */
  let as

  before(async () => {
    as = await startMockAs()
  })

  after(async () => {
    await as.stop()
  })

  beforeEach(() => {
    as.setScenario(resetPatch([...AS_SCENARIO_NAMES, 'issue-client-secret', 'with-client-secret', 'dcr-client-secret']))
  })

  it('serves the authorization server metadata', async () => {
    const response = await fetch(`${as.url}/.well-known/oauth-authorization-server`)
    assert.equal(response.status, 200)
    const metadata = await response.json()
    assert.equal(metadata.issuer, as.url)
    assert.equal(metadata.authorization_endpoint, `${as.url}/authorize`)
    assert.equal(metadata.token_endpoint, `${as.url}/token`)
    assert.equal(metadata.registration_endpoint, `${as.url}/register`)
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
    assert.deepEqual(metadata.grant_types_supported, ['authorization_code', 'refresh_token'])
    assert.deepEqual(metadata.response_types_supported, ['code'])
    assert.deepEqual(metadata.scopes_supported, [])
  })

  it('serves the protected resource metadata', async () => {
    const response = await fetch(`${as.url}/.well-known/oauth-protected-resource`)
    assert.equal(response.status, 200)
    const metadata = await response.json()
    assert.deepEqual(metadata.authorization_servers, [as.url])
    assert.equal(typeof metadata.resource, 'string')
  })

  it('registers a client without a secret by default', async () => {
    const response = await fetch(`${as.url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/callback'] }),
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.client_id, 'mock-client-1')
    assert.equal(body.client_secret, undefined)
    assert.deepEqual(body.redirect_uris, ['http://127.0.0.1:9999/callback'])
    assert.equal(typeof body.client_id_issued_at, 'number')
  })

  it('accepts a registration without any redirect uri', async () => {
    const response = await fetch(`${as.url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'mock-client' }),
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.match(body.client_id, /^mock-client-\d+$/)
    assert.deepEqual(body.redirect_uris, [])
    assert.equal(body.client_secret, undefined)
  })

  it('issues a secret when the scenario asks for it', async () => {
    as.setScenario({ 'client-secret': true })
    const response = await fetch(`${as.url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/callback'] }),
    })
    const body = await response.json()
    assert.match(body.client_secret, /^mock-secret-\d+$/)
  })

  it('runs an authorization code exchange and rotates the refresh token', async () => {
    const { code, tokens } = await exchangeCode(as)
    assert.match(code, /^mock-code-\d+$/)
    assert.equal(tokens.status, 200)
    assert.match(tokens.body.access_token, /^mock-access-token-\d+$/)
    assert.equal(tokens.body.token_type, 'Bearer')
    assert.equal(tokens.body.expires_in, 3600)
    assert.match(tokens.body.refresh_token, /^mock-refresh-token-\d+$/)

    const refreshed = await postForm(`${as.url}/token`, {
      grant_type: 'refresh_token',
      refresh_token: tokens.body.refresh_token,
    })
    assert.equal(refreshed.status, 200)
    assert.notEqual(refreshed.body.access_token, tokens.body.access_token)
    assert.notEqual(refreshed.body.refresh_token, tokens.body.refresh_token)

    const replayed = await postForm(`${as.url}/token`, {
      grant_type: 'refresh_token',
      refresh_token: tokens.body.refresh_token,
    })
    assert.equal(replayed.status, 400)
    assert.equal(replayed.body.error, 'invalid_grant')
  })

  it('rejects a wrong code verifier and a replayed code', async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: `${as.url}/mcp`,
    })
    const response = await fetch(`${as.url}/authorize?${query.toString()}`, { redirect: 'manual' })
    const code = new URL(response.headers.get('location')).searchParams.get('code')

    const wrong = await postForm(`${as.url}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: 'not-the-verifier',
    })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.error, 'invalid_grant')

    const ok = await postForm(`${as.url}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: VERIFIER,
    })
    assert.equal(ok.status, 200)

    const replay = await postForm(`${as.url}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: VERIFIER,
    })
    assert.equal(replay.status, 400)
    assert.equal(replay.body.error, 'invalid_grant')
  })

  it('exposes the issued tokens and the server state', async () => {
    const before = as.state()
    await exchangeCode(as)
    const response = await fetch(`${as.url}/__mock__/tokens`)
    const body = await response.json()
    assert.equal(body.tokens.length, before.tokens.length + 1)
    assert.match(body.tokens.at(-1).accessToken, /^mock-access-token-\d+$/)
    assert.equal(body.refreshTokens.length, before.refreshTokens.length + 1)

    const state = as.state()
    assert.equal(state.codes.length, before.codes.length + 1)
    assert.equal(state.tokens.length, before.tokens.length + 1)
    assert.equal(state.refreshTokens.length, before.refreshTokens.length + 1)
    assert.equal(JSON.stringify(state).includes(VERIFIER), false)
  })

  it('merges scenarios through the HTTP endpoint', async () => {
    const response = await fetch(`${as.url}/__mock__/scenario`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'token-endpoint-500': true }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.scenario['token-endpoint-500'], true)
    assert.equal(as.scenario()['token-endpoint-500'], true)
  })

  it('removes the registration endpoint', async () => {
    as.setScenario({ 'no-registration-endpoint': true })
    const metadata = await fetch(`${as.url}/.well-known/oauth-authorization-server`).then((r) => r.json())
    assert.equal(metadata.registration_endpoint, undefined)
    const response = await fetch(`${as.url}/register`, { method: 'POST', body: '{}' })
    assert.equal(response.status, 404)
  })

  it('fails the token endpoint with a server error', async () => {
    as.setScenario({ 'token-endpoint-500': true })
    const response = await postForm(`${as.url}/token`, { grant_type: 'authorization_code', code: 'mock-code-1' })
    assert.equal(response.status, 500)
  })

  it('fails every token request with invalid_grant', async () => {
    as.setScenario({ 'token-invalid-grant': true })
    const response = await postForm(`${as.url}/token`, { grant_type: 'authorization_code', code: 'mock-code-1' })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'invalid_grant')
  })

  it('omits the refresh token', async () => {
    as.setScenario({ 'no-refresh-token': true })
    const { tokens } = await exchangeCode(as)
    assert.equal(tokens.status, 200)
    assert.equal(tokens.body.refresh_token, undefined)
    assert.match(tokens.body.access_token, /^mock-access-token-\d+$/)
  })

  it('issues a token that is already expired', async () => {
    as.setScenario({ 'expires-in-0': true })
    const { tokens } = await exchangeCode(as)
    assert.equal(tokens.body.expires_in, 0)
  })

  it('requires a code challenge', async () => {
    as.setScenario({ 'pkce-required': true })
    const query = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_challenge_method: 'S256',
      resource: `${as.url}/mcp`,
    })
    const response = await fetch(`${as.url}/authorize?${query.toString()}`, { redirect: 'manual' })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.error, 'invalid_request')
  })

  it('rejects a mismatching resource', async () => {
    as.setScenario({ 'reject-resource-mismatch': true })
    const query = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: 'https://mcp.example.com/mcp',
    })
    const response = await fetch(`${as.url}/authorize?${query.toString()}`, { redirect: 'manual' })
    assert.equal(response.status, 400)
  })

  it('rejects a missing state', async () => {
    as.setScenario({ 'reject-state': true })
    const query = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: `${as.url}/mcp`,
    })
    const response = await fetch(`${as.url}/authorize?${query.toString()}`, { redirect: 'manual' })
    assert.equal(response.status, 400)
  })

  it('fails the dynamic client registration', async () => {
    as.setScenario({ 'dcr-400': true })
    const response = await fetch(`${as.url}/register`, { method: 'POST', body: '{}' })
    assert.equal(response.status, 400)
  })

  it('advertises an unreachable issuer', async () => {
    as.setScenario({ 'as-unreachable': true })
    const metadata = await fetch(`${as.url}/.well-known/oauth-authorization-server`).then((r) => r.json())
    assert.notEqual(metadata.issuer, as.url)
    assert.equal(metadata.issuer, metadata.token_endpoint.replace(/\/token$/, ''))
  })

  it('delays the authorization response', async () => {
    as.setScenario({ 'slow-authorize': true })
    const started = Date.now()
    const query = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: `${as.url}/mcp`,
    })
    const response = await fetch(`${as.url}/authorize?${query.toString()}`, { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.ok(Date.now() - started >= 1900)
  })
})

describe('mock MCP server', () => {
  /** @type {Awaited<ReturnType<typeof startMockMcp>>} */
  let mcp

  before(async () => {
    mcp = await startMockMcp({ asUrl: 'http://127.0.0.1:1/' })
  })

  after(async () => {
    await mcp.stop()
  })

  beforeEach(() => {
    mcp.setScenario(resetPatch(MCP_SCENARIO_NAMES))
  })

  it('initializes a session', async () => {
    const response = await postJsonRpc(mcp.endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })
    assert.equal(response.status, 200)
    const sessionId = response.headers.get('mcp-session-id')
    assert.match(sessionId, /^mock-session-\d+$/)
    const body = await response.json()
    assert.equal(body.jsonrpc, '2.0')
    assert.equal(body.id, 1)
    assert.equal(body.result.protocolVersion, '2025-06-18')
    assert.deepEqual(body.result.capabilities, { tools: {} })
    assert.deepEqual(body.result.serverInfo, { name: 'mock-mcp', version: '0.0.1' })
  })

  it('acknowledges a notification with 202', async () => {
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(response.status, 202)
    assert.equal(await response.text(), '')
  })

  it('lists the tools', async () => {
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const body = await response.json()
    assert.equal(body.result.tools.length, 2)
    assert.equal(body.result.tools[0].name, 'echo')
    assert.deepEqual(body.result.tools[0].inputSchema.required, ['text'])
    assert.equal(body.result.tools[1].name, 'add')
    assert.deepEqual(body.result.tools[1].inputSchema.required, ['a', 'b'])
  })

  it('calls the echo and the add tool', async () => {
    const echo = await postJsonRpc(mcp.endpoint, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hello' } },
    })
    const echoBody = await echo.json()
    assert.deepEqual(echoBody.result.content, [{ type: 'text', text: 'hello' }])

    const add = await postJsonRpc(mcp.endpoint, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 2, b: 3 } },
    })
    const addBody = await add.json()
    assert.deepEqual(addBody.result.content, [{ type: 'text', text: '5' }])
  })

  it('answers an unknown method with -32601', async () => {
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 5, method: 'does/not/exist' })
    const body = await response.json()
    assert.equal(body.error.code, -32601)
  })

  it('answers an unknown session with 404', async () => {
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 6, method: 'tools/list' }, {
      'Mcp-Session-Id': 'mock-session-does-not-exist',
    })
    assert.equal(response.status, 404)
  })

  it('answers a GET with 405 and a DELETE with 204', async () => {
    const get = await fetch(mcp.endpoint)
    assert.equal(get.status, 405)
    const del = await fetch(mcp.endpoint, { method: 'DELETE' })
    assert.equal(del.status, 204)
  })

  it('requires a bearer token', async () => {
    mcp.setScenario({ 'require-auth': true })
    const unauthorized = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 7, method: 'tools/list' })
    assert.equal(unauthorized.status, 401)
    const challenge = unauthorized.headers.get('www-authenticate')
    assert.match(challenge, /^Bearer resource_metadata=".*\/\.well-known\/oauth-protected-resource"$/)

    const authorized = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 8, method: 'tools/list' }, {
      authorization: 'Bearer mock-access-token-1',
    })
    assert.equal(authorized.status, 200)
  })

  it('forgets the session', async () => {
    const initialized = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 9, method: 'initialize' })
    const sessionId = initialized.headers.get('mcp-session-id')
    mcp.setScenario({ 'expired-session': true })
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 10, method: 'tools/list' }, {
      'Mcp-Session-Id': sessionId,
    })
    assert.equal(response.status, 404)
  })

  it('answers with a chunked event stream', async () => {
    mcp.setScenario({ 'chunked-sse': true })
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 11, method: 'tools/list' })
    assert.match(response.headers.get('content-type'), /^text\/event-stream/)
    const text = await response.text()
    assert.ok(text.startsWith('data: '))
    const data = text.replace(/^data: /, '').trim()
    const body = JSON.parse(data)
    assert.equal(body.id, 11)
    assert.equal(body.result.tools.length, 2)
  })

  it('rejects an unsupported protocol version', async () => {
    const response = await postJsonRpc(mcp.endpoint, { jsonrpc: '2.0', id: 12, method: 'tools/list' }, {
      'MCP-Protocol-Version': '1999-01-01',
    })
    assert.equal(response.status, 400)
  })

  it('fails a tool call on purpose', async () => {
    mcp.setScenario({ 'tool-error': true })
    const response = await postJsonRpc(mcp.endpoint, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hello' } },
    })
    const body = await response.json()
    assert.ok(body.error)
    assert.equal(typeof body.error.code, 'number')
  })

  it('records the sessions and the calls', async () => {
    const state = mcp.state()
    assert.ok(Array.isArray(state.sessions))
    assert.ok(Array.isArray(state.calls))
    assert.ok(state.calls.some((call) => call.method === 'tools/call'))
  })
})
