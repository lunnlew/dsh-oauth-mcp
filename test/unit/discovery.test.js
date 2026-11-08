import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DiscoveryError,
  IssuerMismatchError,
  MetadataError,
} from '../../lib/oauth/errors.js'
import {
  canonicalizeIssuer,
  discoverAuthorizationServer,
  discoverProtectedResource,
  extractAuthorizationServerUrl,
  parseWwwAuthenticate,
} from '../../lib/oauth/discovery.js'

/**
 * Build a fake HTTP client that answers from a route table.
 *
 * @param {Record<string, unknown>} routes The answers, by metadata URL.
 * @returns {{ getJson: (url: string) => Promise<unknown>, calls: string[] }} The fake client.
 */
function createHttp(routes) {
  /** @type {string[]} */
  const calls = []
  return {
    calls,
    async getJson(url) {
      calls.push(url)
      if (!Object.prototype.hasOwnProperty.call(routes, url)) {
        const error = new Error('not found')
        error.status = 404
        error.detail = 'The document is missing.'
        throw error
      }
      const answer = routes[url]
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

/**
 * Build a fake HTTP client that answers with a challenge first.
 *
 * The MCP authorization profile expects the client to read the
 * `WWW-Authenticate` header of a `401`, so the fake answers the unauthenticated
 * request with one and then serves the metadata documents.
 *
 * @param {Record<string, unknown>} routes The answers, by metadata URL.
 * @param {string} metadataUrl The address the challenge names.
 * @returns {{ getJson: (url: string) => Promise<unknown>, request: (url: string) => Promise<unknown>, gets: string[] }} The fake client.
 */
function createHttpWithChallenge(routes, metadataUrl) {
  const http = createHttp(routes)
  return {
    ...http,
    gets: http.calls,
    async request() {
      const error = new Error('unauthorized')
      error.status = 401
      error.headers = new Headers({
        'www-authenticate': `Bearer resource_metadata="${metadataUrl}"`,
      })
      throw error
    },
  }
}

test('the challenge header is split into a scheme and its parameters', () => {  const parsed = parseWwwAuthenticate(
    'Bearer resource_metadata="https://as.example.com/.well-known/oauth-protected-resource", scope="read"',
  )

  assert.equal(parsed.scheme, 'Bearer')
  assert.equal(parsed.params.resource_metadata, 'https://as.example.com/.well-known/oauth-protected-resource')
  assert.equal(parsed.params.scope, 'read')
})

test('a missing or unreadable challenge header yields an empty result', () => {
  assert.deepEqual(parseWwwAuthenticate(''), { scheme: '', params: {} })
  assert.deepEqual(parseWwwAuthenticate('   '), { scheme: '', params: {} })
  assert.deepEqual(parseWwwAuthenticate(undefined), { scheme: '', params: {} })
  assert.deepEqual(parseWwwAuthenticate(42), { scheme: '', params: {} })
})

test('the issuer keeps its path and port but loses its trailing slash, query and fragment', () => {
  assert.equal(canonicalizeIssuer('https://as.example.com/'), 'https://as.example.com')
  assert.equal(canonicalizeIssuer('https://as.example.com'), 'https://as.example.com')
  assert.equal(canonicalizeIssuer('https://as.example.com:8443/tenant/?a=1#b'), 'https://as.example.com:8443/tenant')
})

test('an issuer that is not a parsable URL is refused', () => {
  assert.throws(() => canonicalizeIssuer('nonsense'), TypeError)
  assert.throws(() => canonicalizeIssuer(undefined), TypeError)
})

test('the protected-resource metadata is taken from the path-insertion form first', async () => {
  const http = createHttp({
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://as.example.com'],
    },
  })

  const result = await discoverProtectedResource('https://mcp.example.com/mcp', { http })

  assert.equal(result.metadataUrl, 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp')
  assert.deepEqual(result.metadata.authorization_servers, ['https://as.example.com'])
  assert.equal(http.calls.length, 1)
})

test('the plain origin form is used when the path-insertion form is missing', async () => {
  const http = createHttp({
    'https://mcp.example.com/.well-known/oauth-protected-resource': {
      resource: 'https://mcp.example.com/mcp',
    },
  })

  const result = await discoverProtectedResource('https://mcp.example.com/mcp', { http })

  assert.equal(result.metadataUrl, 'https://mcp.example.com/.well-known/oauth-protected-resource')
  assert.deepEqual(http.calls, [
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
    'https://mcp.example.com/.well-known/oauth-protected-resource',
  ])
})

test('the challenge of the endpoint names the metadata to use', async () => {
  const http = createHttpWithChallenge(
    {
      'https://mcp.example.com/.well-known/oauth-protected-resource/other': {
        resource: 'https://mcp.example.com/mcp',
        authorization_servers: ['https://as.example.com'],
      },
    },
    'https://mcp.example.com/.well-known/oauth-protected-resource/other',
  )

  const result = await discoverProtectedResource('https://mcp.example.com/mcp', { http })

  assert.equal(
    result.metadataUrl,
    'https://mcp.example.com/.well-known/oauth-protected-resource/other',
    'the address of the challenge is used',
  )
  assert.deepEqual(http.gets, ['https://mcp.example.com/.well-known/oauth-protected-resource/other'])
})

test('a document that speaks about another resource is not used', async () => {
  const http = createHttp({
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
      resource: 'https://another.example.com/mcp',
      authorization_servers: ['https://as.example.com'],
    },
    'https://mcp.example.com/.well-known/oauth-protected-resource': {
      resource: 'https://another.example.com/mcp',
    },
  })

  await assert.rejects(
    () => discoverProtectedResource('https://mcp.example.com/mcp', { http }),
    (error) => {
      assert.ok(error instanceof DiscoveryError)
      return true
    },
    'the metadata of another resource is refused',
  )
})

test('a document without a resource field is still used', async () => {
  const http = createHttp({
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
      authorization_servers: ['https://as.example.com'],
    },
  })

  const result = await discoverProtectedResource('https://mcp.example.com/mcp', { http })

  assert.equal(result.metadataUrl, 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp')
})

test('a missing protected-resource metadata raises a discovery error', async () => {  const http = createHttp({})

  await assert.rejects(
    () => discoverProtectedResource('https://mcp.example.com/mcp', { http }),
    (error) => {
      assert.ok(error instanceof DiscoveryError)
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('the authorization-server metadata is taken from the RFC 8414 document', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/oauth-authorization-server': {
      issuer: 'https://as.example.com',
      authorization_endpoint: 'https://as.example.com/authorize',
      token_endpoint: 'https://as.example.com/token',
    },
  })

  const result = await discoverAuthorizationServer('https://as.example.com', { http })

  assert.equal(result.metadataUrl, 'https://as.example.com/.well-known/oauth-authorization-server')
  assert.equal(result.metadata.authorization_endpoint, 'https://as.example.com/authorize')
})

test('the OpenID Connect document is the second candidate', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/openid-configuration': {
      issuer: 'https://as.example.com',
      authorization_endpoint: 'https://as.example.com/authorize',
    },
  })

  const result = await discoverAuthorizationServer('https://as.example.com/', { http })

  assert.equal(result.metadataUrl, 'https://as.example.com/.well-known/openid-configuration')
  assert.deepEqual(http.calls, [
    'https://as.example.com/.well-known/oauth-authorization-server',
    'https://as.example.com/.well-known/openid-configuration',
  ])
})

test('the RFC 8414 document of an issuer with a path is taken from the path-append form', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/oauth-authorization-server/tenant': {
      issuer: 'https://as.example.com/tenant',
      authorization_endpoint: 'https://as.example.com/tenant/authorize',
    },
  })

  const result = await discoverAuthorizationServer('https://as.example.com/tenant', { http })

  assert.equal(
    result.metadataUrl,
    'https://as.example.com/.well-known/oauth-authorization-server/tenant',
  )
  assert.deepEqual(http.calls, [
    'https://as.example.com/.well-known/oauth-authorization-server/tenant',
  ])
})

test('the OpenID Connect document of an issuer with a path is taken from the path-insert form', async () => {
  const http = createHttp({
    'https://as.example.com/tenant/.well-known/openid-configuration': {
      issuer: 'https://as.example.com/tenant',
      authorization_endpoint: 'https://as.example.com/tenant/authorize',
    },
  })

  const result = await discoverAuthorizationServer('https://as.example.com/tenant', { http })

  assert.equal(
    result.metadataUrl,
    'https://as.example.com/tenant/.well-known/openid-configuration',
  )
  assert.deepEqual(http.calls, [
    'https://as.example.com/.well-known/oauth-authorization-server/tenant',
    'https://as.example.com/tenant/.well-known/openid-configuration',
  ])
})

test('a document that declares another issuer does not stop the search', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/oauth-authorization-server/tenant': {
      issuer: 'https://other.example.com',
      authorization_endpoint: 'https://other.example.com/authorize',
    },
    'https://as.example.com/tenant/.well-known/openid-configuration': {
      issuer: 'https://as.example.com/tenant',
      authorization_endpoint: 'https://as.example.com/tenant/authorize',
    },
  })

  const result = await discoverAuthorizationServer('https://as.example.com/tenant', { http })

  assert.equal(
    result.metadataUrl,
    'https://as.example.com/tenant/.well-known/openid-configuration',
    'the document of the right issuer is used',
  )
})

test('the issuer of the table is the one the vendor publishes', () => {
  // Feishu publishes its authorization-server metadata under the RFC 8414 path
  // append form, which the plugin has to reach.
  assert.equal(
    canonicalizeIssuer('https://accounts.feishu.cn/mcp'),
    'https://accounts.feishu.cn/mcp',
  )
})

test('a metadata document that declares another issuer is refused', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/oauth-authorization-server': {
      issuer: 'https://evil.example.com',
      authorization_endpoint: 'https://evil.example.com/authorize',
    },
  })

  await assert.rejects(
    () => discoverAuthorizationServer('https://as.example.com', { http }),
    (error) => {
      assert.ok(error instanceof IssuerMismatchError)
      return true
    },
  )
})

test('a metadata document without an authorization endpoint raises a metadata error', async () => {
  const http = createHttp({
    'https://as.example.com/.well-known/oauth-authorization-server': {
      issuer: 'https://as.example.com',
    },
    'https://as.example.com/.well-known/openid-configuration': {
      issuer: 'https://as.example.com',
    },
  })

  await assert.rejects(
    () => discoverAuthorizationServer('https://as.example.com', { http }),
    (error) => {
      assert.ok(error instanceof MetadataError)
      return true
    },
  )
})

test('a missing authorization-server metadata raises a discovery error', async () => {
  const http = createHttp({})

  await assert.rejects(
    () => discoverAuthorizationServer('https://as.example.com', { http }),
    (error) => {
      assert.ok(error instanceof DiscoveryError)
      return true
    },
  )
})

test('the authorization server of a protected-resource document is read out', () => {
  assert.equal(
    extractAuthorizationServerUrl({ authorization_servers: ['https://as.example.com', 'https://other.example.com'] }),
    'https://as.example.com',
  )
  assert.equal(extractAuthorizationServerUrl({ authorization_servers: 'https://as.example.com' }), 'https://as.example.com')
  assert.equal(extractAuthorizationServerUrl({ authorization_server: 'https://as.example.com' }), 'https://as.example.com')
  assert.equal(extractAuthorizationServerUrl({}), undefined)
  assert.equal(extractAuthorizationServerUrl(undefined), undefined)
})
