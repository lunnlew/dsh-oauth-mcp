import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildAuthorizeRequest } from '../../lib/oauth/authorize-request.js'

/**
 * Build a valid authorization request.
 *
 * @param {object} [overrides] The values to replace.
 * @returns {object} The request parameters.
 */
function request(overrides = {}) {
  return {
    authorizationEndpoint: 'https://as.example.com/authorize',
    clientId: 'client-1',
    redirectUri: 'http://127.0.0.1:53219/callback',
    scopes: ['read', 'write'],
    state: 'the-state',
    codeChallenge: 'the-challenge',
    ...overrides,
  }
}

test('the request carries the code grant, the client, the state and the PKCE challenge', () => {
  const result = buildAuthorizeRequest(request())

  assert.ok(result.params instanceof URLSearchParams)
  assert.equal(result.params.get('response_type'), 'code')
  assert.equal(result.params.get('client_id'), 'client-1')
  assert.equal(result.params.get('redirect_uri'), 'http://127.0.0.1:53219/callback')
  assert.equal(result.params.get('state'), 'the-state')
  assert.equal(result.params.get('code_challenge'), 'the-challenge')
  assert.equal(result.params.get('code_challenge_method'), 'S256')
  assert.equal(result.params.get('scope'), 'read write')
})

test('the URL carries the parameters', () => {
  const result = buildAuthorizeRequest(request())

  assert.equal(result.url, `https://as.example.com/authorize?${result.params.toString()}`)
  assert.equal(result.url.includes('client_id=client-1'), true)
})

test('an endpoint with a query keeps its own parameters', () => {
  const result = buildAuthorizeRequest(request({ authorizationEndpoint: 'https://as.example.com/authorize?tenant=a' }))

  assert.equal(result.url.startsWith('https://as.example.com/authorize?tenant=a&'), true)
})

test('an empty scope is left out', () => {
  const result = buildAuthorizeRequest(request({ scopes: [] }))

  assert.equal(result.params.has('scope'), false)
})

test('the resource indicator is canonicalised', () => {
  const result = buildAuthorizeRequest(request({ resource: 'https://MCP.example.com:443/mcp/' }))

  assert.equal(result.params.get('resource'), 'https://mcp.example.com/mcp')
})

test('extra parameters are appended', () => {
  const result = buildAuthorizeRequest(request({ extraParams: { audience: 'mcp', prompt: 'consent' } }))

  assert.equal(result.params.get('audience'), 'mcp')
  assert.equal(result.params.get('prompt'), 'consent')
})

test('a loopback IP literal is accepted', () => {
  assert.doesNotThrow(() => buildAuthorizeRequest(request({ redirectUri: 'http://127.0.0.1:53219/callback' })))
  assert.doesNotThrow(() => buildAuthorizeRequest(request({ redirectUri: 'http://127.5.5.5:53219/callback' })))
  assert.doesNotThrow(() => buildAuthorizeRequest(request({ redirectUri: 'http://[::1]:53219/callback' })))
})

test('a host name is refused', () => {
  assert.throws(() => buildAuthorizeRequest(request({ redirectUri: 'http://localhost:53219/callback' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ redirectUri: 'https://example.com/callback' })), TypeError)
})

test('a redirect URI that is not a parsable http URL is refused', () => {
  assert.throws(() => buildAuthorizeRequest(request({ redirectUri: 'not a url' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ redirectUri: 'ftp://127.0.0.1/callback' })), TypeError)
})

test('every required value is checked', () => {
  assert.throws(() => buildAuthorizeRequest(request({ authorizationEndpoint: '' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ clientId: '' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ redirectUri: '' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ state: '' })), TypeError)
  assert.throws(() => buildAuthorizeRequest(request({ codeChallenge: '' })), TypeError)
})
