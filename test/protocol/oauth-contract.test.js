/**
 * Protocol contract tests: the plugin must speak OAuth 2.1 the way the MCP
 * authorization profile and RFC 8414 / 7591 / 7636 / 8707 describe it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { withMockServers } from '../setup.js'
import { createHttpClient } from '../../lib/http/client.js'
import {
  canonicalizeIssuer,
  discoverAuthorizationServer,
  discoverProtectedResource,
  extractAuthorizationServerUrl,
  parseWwwAuthenticate,
} from '../../lib/oauth/discovery.js'
import { registerClient } from '../../lib/oauth/registration.js'
import {
  buildAuthorizationHeader,
  buildTokenRequest,
  exchangeAuthorizationCode,
} from '../../lib/oauth/token.js'
import { buildAuthorizeRequest } from '../../lib/oauth/authorize-request.js'
import { canonicalResource } from '../../lib/oauth/resource.js'
import { DiscoveryError, IssuerMismatchError, MetadataError, TokenError } from '../../lib/oauth/errors.js'

const REDIRECT_URI = 'http://127.0.0.1:39271/oauth-mcp/callback'

/**
 * Read a header out of a plain header record, ignoring the case of its name.
 *
 * @param {Record<string, string>} headers The header record.
 * @param {string} name The header name.
 * @returns {string | undefined} The header value.
 */
function headerValue(headers, name) {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

test('the protected-resource metadata of the MCP server names the authorization server', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const http = createHttpClient()
    const { metadata } = await discoverProtectedResource(mcp.endpoint, { http })
    assert.equal(metadata.resource, canonicalResource(mcp.endpoint))
    const authorizationServer = extractAuthorizationServerUrl(metadata)
    assert.equal(authorizationServer, as.url)
  })
})

test('the authorization-server metadata declares its issuer and its endpoints', async () => {
  await withMockServers(async ({ as }) => {
    const http = createHttpClient()
    const { metadata } = await discoverAuthorizationServer(as.url, { http })
    assert.equal(metadata.issuer, as.url)
    assert.equal(metadata.authorization_endpoint, `${as.url}/authorize`)
    assert.equal(metadata.token_endpoint, `${as.url}/token`)
    assert.equal(metadata.registration_endpoint, `${as.url}/register`)
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  })
})

test('a metadata document with a different issuer is rejected', async () => {
  const http = {
    getJson: async () => ({
      issuer: 'https://evil.example',
      authorization_endpoint: 'https://evil.example/authorize',
      token_endpoint: 'https://evil.example/token',
    }),
  }
  await assert.rejects(
    () => discoverAuthorizationServer('https://as.example', { http }),
    (error) => error instanceof IssuerMismatchError,
  )
})

test('a metadata document without an authorization endpoint is rejected', async () => {
  const http = {
    getJson: async () => ({ issuer: 'https://as.example', token_endpoint: 'https://as.example/token' }),
  }
  await assert.rejects(
    () => discoverAuthorizationServer('https://as.example', { http }),
    (error) => error instanceof MetadataError,
  )
})

test('an unreachable metadata endpoint is a discovery error', async () => {
  const http = createHttpClient()
  await assert.rejects(
    () => discoverProtectedResource('http://127.0.0.1:1/mcp', { http }),
    (error) => error instanceof DiscoveryError,
  )
})

test('the WWW-Authenticate challenge of the MCP server is parsed', async () => {
  await withMockServers(async ({ mcp }) => {
    mcp.setScenario({ 'require-auth': true })
    const response = await fetch(mcp.endpoint, { method: 'POST' })
    assert.equal(response.status, 401)
    const challenge = parseWwwAuthenticate(response.headers.get('www-authenticate'))
    assert.equal(challenge.scheme, 'Bearer')
    assert.ok(challenge.params.resource_metadata, 'the challenge names the resource metadata')
    assert.match(challenge.params.resource_metadata, /\.well-known\/oauth-protected-resource$/)
  })
})

test('dynamic client registration returns a client id', async () => {
  await withMockServers(async ({ as }) => {
    const http = createHttpClient()
    const { metadata } = await discoverAuthorizationServer(as.url, { http })
    const registration = await registerClient({
      metadata,
      redirectUris: [REDIRECT_URI],
      clientName: 'DSH (dsh-oauth-mcp)',
      scopes: ['read'],
      http,
    })
    assert.match(registration.clientId, /^mock-client-/)
    assert.equal(registration.clientSecret, undefined, 'the mock issues a public client')
  })
})

test('a server without a registration endpoint cannot register a client', async () => {
  await withMockServers(async ({ as }) => {
    const http = createHttpClient()
    await assert.rejects(
      () =>
        registerClient({
          metadata: { issuer: as.url },
          redirectUris: [REDIRECT_URI],
          clientName: 'DSH (dsh-oauth-mcp)',
          scopes: [],
          http,
        }),
      (error) => error.code === 'registration_unsupported',
    )
  })
})

test('the authorization request carries PKCE, the state and the resource', () => {
  const request = buildAuthorizeRequest({
    authorizationEndpoint: 'https://as.example/authorize',
    clientId: 'client-1',
    redirectUri: REDIRECT_URI,
    scopes: ['read', 'write'],
    state: 'state-1',
    codeChallenge: 'challenge-1',
    resource: 'https://mcp.example/mcp',
  })
  assert.equal(request.params.get('response_type'), 'code')
  assert.equal(request.params.get('client_id'), 'client-1')
  assert.equal(request.params.get('redirect_uri'), REDIRECT_URI)
  assert.equal(request.params.get('state'), 'state-1')
  assert.equal(request.params.get('code_challenge'), 'challenge-1')
  assert.equal(request.params.get('code_challenge_method'), 'S256')
  assert.equal(request.params.get('scope'), 'read write')
  assert.equal(request.params.get('resource'), 'https://mcp.example/mcp')
  assert.match(request.url, /^https:\/\/as\.example\/authorize\?/)
})

test('the authorization request refuses a non loopback redirect URI', () => {
  assert.throws(() =>
    buildAuthorizeRequest({
      authorizationEndpoint: 'https://as.example/authorize',
      clientId: 'client-1',
      redirectUri: 'http://localhost:39271/oauth-mcp/callback',
      scopes: [],
      state: 'state-1',
      codeChallenge: 'challenge-1',
    }),
  )
})

test('the token request carries the code verifier and the resource', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example/token',
    grantType: 'authorization_code',
    clientId: 'client-1',
    code: 'code-1',
    redirectUri: REDIRECT_URI,
    codeVerifier: 'verifier-1',
    resource: 'https://mcp.example/mcp',
  })
  assert.equal(request.body.get('grant_type'), 'authorization_code')
  assert.equal(request.body.get('client_id'), 'client-1')
  assert.equal(request.body.get('code'), 'code-1')
  assert.equal(request.body.get('redirect_uri'), REDIRECT_URI)
  assert.equal(request.body.get('code_verifier'), 'verifier-1')
  assert.equal(request.body.get('resource'), 'https://mcp.example/mcp')
  assert.equal(headerValue(request.headers, 'content-type'), 'application/x-www-form-urlencoded')
})

test('the confidential client authenticates with the Basic scheme', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example/token',
    grantType: 'authorization_code',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    code: 'code-1',
    redirectUri: REDIRECT_URI,
    codeVerifier: 'verifier-1',
    tokenEndpointAuthMethod: 'client_secret_basic',
  })
  assert.equal(headerValue(request.headers, 'authorization'), buildAuthorizationHeader('client-1', 'secret-1'))
  assert.equal(request.body.get('client_secret'), null, 'the secret is not repeated in the body')
})

test('a token request with a wrong code verifier is an invalid grant', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const http = createHttpClient()
    const { metadata } = await discoverAuthorizationServer(as.url, { http })
    const registration = await registerClient({
      metadata,
      redirectUris: [REDIRECT_URI],
      clientName: 'DSH (dsh-oauth-mcp)',
      scopes: [],
      http,
    })

    const authorizeUrl = new URL(`${as.url}/authorize`)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', registration.clientId)
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authorizeUrl.searchParams.set('state', 'state-1')
    authorizeUrl.searchParams.set('code_challenge', 'challenge-that-does-not-match')
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('resource', canonicalResource(mcp.endpoint))
    const response = await fetch(authorizeUrl, { redirect: 'manual' })
    const location = new URL(response.headers.get('location'))
    const code = location.searchParams.get('code')

    await assert.rejects(
      () =>
        exchangeAuthorizationCode(
          {
            tokenEndpoint: metadata.token_endpoint,
            clientId: registration.clientId,
            code,
            redirectUri: REDIRECT_URI,
            codeVerifier: 'the-wrong-verifier',
            resource: canonicalResource(mcp.endpoint),
          },
          { http },
        ),
      (error) => error instanceof TokenError && error.code === 'invalid_grant',
    )
  })
})

test('the issuer of a metadata document is canonicalized', () => {
  assert.equal(canonicalizeIssuer('https://as.example/'), 'https://as.example')
  assert.equal(canonicalizeIssuer('https://as.example:443/path/'), 'https://as.example/path')
  assert.equal(canonicalizeIssuer('https://as.example:8443/path/'), 'https://as.example:8443/path')
  assert.equal(canonicalizeIssuer('https://as.example?x=1'), 'https://as.example')
})
