/**
 * Metadata discovery.
 *
 * Two RFCs are implemented here:
 *
 * * RFC 9728 — the MCP server publishes its protected-resource metadata, which
 *   points at the authorization server(s) that can mint a token for it.
 * * RFC 8414 — the authorization server publishes its own metadata.
 *
 * Both directions are tried in the order the contract fixes, and every
 * failure is reported through the shared error vocabulary. No response body
 * is echoed into an error message.
 *
 * @module dsh-oauth-mcp/oauth/discovery
 */

import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  OPENID_CONFIGURATION_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
} from './types.js'
import { DiscoveryError, IssuerMismatchError, MetadataError } from './errors.js'
import { canonicalResource } from './resource.js'
import { redactUrl } from '../util/redact.js'
import { PLUGIN_ID, PLUGIN_VERSION } from '../build-info.js'

/**
 * Parse a `WWW-Authenticate` challenge header.
 *
 * Only the parameters of the first challenge are returned; the scheme is
 * reported separately so the caller can check it is `Bearer`.
 *
 * @param {unknown} header The raw header value.
 * @returns {{ scheme: string, params: Record<string, string> }} The parsed challenge.
 */
export function parseWwwAuthenticate(header) {
  if (typeof header !== 'string') return { scheme: '', params: {} }
  const trimmed = header.trim()
  if (trimmed.length === 0) return { scheme: '', params: {} }
  const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return { scheme: '', params: {} }
  const scheme = match[1]
  const rest = match[2] ?? ''
  /** @type {Record<string, string>} */
  const params = {}
  const pattern = /([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g
  let found = null
  while ((found = pattern.exec(rest)) !== null) {
    const key = found[1].toLowerCase()
    const value = found[2] !== undefined ? found[2] : found[3]
    if (key.length === 0) continue
    params[key] = value
  }
  return { scheme, params }
}

/**
 * Canonicalise an issuer identifier.
 *
 * The issuer of an authorization server is compared with the issuer it was
 * queried for, so both spellings must be normalised the same way: the scheme,
 * the host, the port and the path are kept, a trailing `/` and any query or
 * fragment are dropped.
 *
 * @param {string} url The issuer URL.
 * @returns {string} The canonical issuer.
 * @throws {TypeError} When the value is not a string or not a parsable URL.
 */
export function canonicalizeIssuer(url) {
  if (typeof url !== 'string') {
    throw new TypeError('An issuer must be a string.')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError('An issuer must be a parsable URL.')
  }
  parsed.hash = ''
  parsed.search = ''
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${path}`
}

/**
 * Build the candidate metadata URLs of a protected resource.
 *
 * @param {string} resourceUrl The MCP endpoint URL.
 * @returns {{ origin: string, path: string, candidates: string[] }} The origin, the path and the ordered candidates.
 */
function protectedResourceCandidates(resourceUrl) {
  let parsed
  try {
    parsed = new URL(resourceUrl)
  } catch {
    throw new TypeError('A resource URL must be a parsable URL.')
  }
  const origin = `${parsed.protocol}//${parsed.host}`
  const path = parsed.pathname
  const candidates = []
  if (path.length > 0 && path !== '/') {
    candidates.push(`${origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}`)
  }
  candidates.push(`${origin}${PROTECTED_RESOURCE_METADATA_PATH}`)
  return { origin, path, candidates }
}

/**
 * Fetch one metadata document.
 *
 * @param {string} url The metadata URL.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<{ ok: true, metadata: object } | { ok: false, status: number | undefined, detail: string }>} The outcome.
 */
async function fetchMetadata(url, { http, signal }) {
  try {
    const body = await http.getJson(url, { signal })
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, status: undefined, detail: 'The metadata document is not a JSON object.' }
    }
    return { ok: true, metadata: body }
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : undefined
    const detail = typeof error?.detail === 'string' ? error.detail : ''
    return { ok: false, status, detail }
  }
}

/**
 * Ask an MCP endpoint where its protected-resource metadata is.
 *
 * The MCP authorization profile says that a client must be able to read the
 * `WWW-Authenticate` challenge of a `401` and use the `resource_metadata` it
 * names. The plugin asks the endpoint with an unauthenticated request and
 * reads the header. An endpoint that does not answer with a challenge teaches
 * the plugin nothing, and the well-known addresses are tried then.
 *
 * @param {string} resourceUrl The MCP endpoint URL.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<string | undefined>} The metadata URL the challenge named.
 */
export async function challengeMetadataUrl(resourceUrl, { http, signal } = {}) {
  if (!http || typeof http.request !== 'function') return undefined
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: PLUGIN_ID, version: PLUGIN_VERSION },
    },
  })
  let header
  try {
    const result = await http.request(resourceUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body,
      signal,
    })
    header = result?.headers?.get?.('www-authenticate')
  } catch (error) {
    header = error?.headers?.get?.('www-authenticate')
  }
  if (typeof header !== 'string') return undefined
  const challenge = parseWwwAuthenticate(header)
  if (challenge.scheme.toLowerCase() !== 'bearer') return undefined
  const named = challenge.params.resource_metadata
  if (typeof named !== 'string' || named.length === 0) return undefined
  try {
    const parsed = new URL(named)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

/**
 * Check that a protected-resource metadata document speaks about the resource
 * the plugin asked for.
 *
 * RFC 9728 §3.3: when the `resource` of the document and the requested
 * resource differ, the document must not be used. The two are compared after
 * the same normalisation the plugin applies to every resource identifier, so
 * a trailing slash does not make a document unusable.
 *
 * @param {unknown} metadata The metadata document.
 * @param {string} resourceUrl The MCP endpoint URL.
 * @returns {boolean} Whether the document may be used.
 */
export function resourceMatches(metadata, resourceUrl) {
  const named = metadata?.resource
  // The field is required by RFC 9728. A document that leaves it out is
  // still usable: only a document that names another resource is refused.
  if (typeof named !== 'string' || named.length === 0) return true
  try {
    return canonicalResource(named) === canonicalResource(resourceUrl)
  } catch {
    return false
  }
}

/**
 * Discover the protected-resource metadata of an MCP endpoint.
 *
 * The challenge of the endpoint comes first, as the MCP authorization profile
 * asks for; the well-known addresses are the fallback.
 *
 * @param {string} resourceUrl The MCP endpoint URL.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<{ metadata: object, metadataUrl: string }>} The metadata and the URL it came from.
 * @throws {DiscoveryError} When no candidate answered with usable metadata.
 */
export async function discoverProtectedResource(resourceUrl, { http, signal } = {}) {
  if (!http || typeof http.getJson !== 'function') {
    throw new TypeError('discoverProtectedResource requires an HTTP client.')
  }
  const { candidates } = protectedResourceCandidates(resourceUrl)
  const named = await challengeMetadataUrl(resourceUrl, { http, signal })
  let lastDetail = ''
  for (const candidate of named ? [named, ...candidates] : candidates) {
    const result = await fetchMetadata(candidate, { http, signal })
    if (!result.ok) {
      lastDetail = result.detail
      continue
    }
    if (!resourceMatches(result.metadata, resourceUrl)) {
      lastDetail = 'The metadata document speaks about another resource.'
      continue
    }
    return { metadata: result.metadata, metadataUrl: candidate }
  }
  throw new DiscoveryError(
    `No protected-resource metadata was found for ${redactUrl(resourceUrl)}.`,
    { status: 404, detail: lastDetail },
  )
}

/**
 * Build the candidate metadata URLs of an authorization server.
 *
 * The two specifications place the path of an issuer differently, and a
 * vendor picks one of them:
 *
 * * RFC 8414 appends the path to the well-known segment, so the issuer
 *   `https://as.example.com/tenant` publishes its metadata at
 *   `https://as.example.com/.well-known/oauth-authorization-server/tenant`;
 * * OpenID Connect puts the path in front, so the same issuer publishes it at
 *   `https://as.example.com/tenant/.well-known/openid-configuration`.
 *
 * An issuer without a path has one address per specification, and the forms
 * without a path are tried as well, because a vendor may publish the document
 * of a tenant under the root of its host.
 *
 * @param {string} issuer The canonical issuer.
 * @returns {string[]} The candidate URLs, in order.
 */
function authorizationServerCandidates(issuer) {
  const parsed = new URL(issuer)
  const origin = `${parsed.protocol}//${parsed.host}`
  const path = parsed.pathname.replace(/\/+$/, '')
  const candidates = []
  if (path.length > 0) {
    candidates.push(`${origin}${AUTHORIZATION_SERVER_METADATA_PATH}${path}`)
    candidates.push(`${origin}${path}${OPENID_CONFIGURATION_PATH}`)
  }
  candidates.push(`${origin}${AUTHORIZATION_SERVER_METADATA_PATH}`)
  candidates.push(`${origin}${OPENID_CONFIGURATION_PATH}`)
  return [...new Set(candidates)]
}

/**
 * Discover the metadata of an authorization server.
 *
 * The RFC 8414 document is tried first, the OpenID Connect document second.
 *
 * @param {string} issuerUrl The issuer URL of the authorization server.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<{ metadata: object, metadataUrl: string }>} The metadata and the URL it came from.
 * @throws {IssuerMismatchError} When the metadata declares a different issuer.
 * @throws {MetadataError} When the metadata lacks an authorization endpoint.
 * @throws {DiscoveryError} When no candidate answered with usable metadata.
 */
export async function discoverAuthorizationServer(issuerUrl, { http, signal } = {}) {
  if (!http || typeof http.getJson !== 'function') {
    throw new TypeError('discoverAuthorizationServer requires an HTTP client.')
  }
  const issuer = canonicalizeIssuer(issuerUrl)
  const candidates = authorizationServerCandidates(issuer)
  let found = false
  let lastDetail = ''
  let mismatch = ''
  for (const candidate of candidates) {
    const result = await fetchMetadata(candidate, { http, signal })
    if (!result.ok) {
      lastDetail = result.detail
      continue
    }
    found = true
    const metadata = result.metadata
    if (typeof metadata.issuer === 'string' && metadata.issuer.length > 0) {
      let declaredIssuer
      try {
        declaredIssuer = canonicalizeIssuer(metadata.issuer)
      } catch {
        mismatch = `Declared issuer: ${redactUrl(metadata.issuer)}`
        continue
      }
      if (declaredIssuer !== issuer) {
        // Another candidate may still hold the right document, so the
        // mismatch is remembered instead of thrown right away.
        mismatch = `Declared issuer: ${redactUrl(metadata.issuer)}`
        continue
      }
    }
    if (typeof metadata.authorization_endpoint !== 'string' || metadata.authorization_endpoint.length === 0) {
      continue
    }
    return { metadata, metadataUrl: candidate }
  }
  if (mismatch !== '') {
    throw new IssuerMismatchError(
      `The authorization-server metadata declares a different issuer than ${redactUrl(issuer)}.`,
      { detail: mismatch },
    )
  }
  if (found) {
    throw new MetadataError(
      `The authorization-server metadata of ${redactUrl(issuer)} has no authorization_endpoint.`,
      { detail: lastDetail },
    )
  }
  throw new DiscoveryError(
    `No authorization-server metadata was found for ${redactUrl(issuer)}.`,
    { status: 404, detail: lastDetail },
  )
}

/**
 * Read the authorization-server URL of a protected-resource metadata document.
 *
 * @param {unknown} metadata The protected-resource metadata.
 * @returns {string | undefined} The authorization-server URL, when the document names one.
 */
export function extractAuthorizationServerUrl(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined
  const servers = metadata.authorization_servers
  if (Array.isArray(servers)) {
    const first = servers.find((entry) => typeof entry === 'string' && entry.length > 0)
    if (first) return first
  }
  if (typeof servers === 'string' && servers.length > 0) return servers
  if (typeof metadata.authorization_server === 'string' && metadata.authorization_server.length > 0) {
    return metadata.authorization_server
  }
  return undefined
}
