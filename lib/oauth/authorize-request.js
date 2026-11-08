/**
 * Authorization request builder (RFC 6749 §4.1, RFC 7636, RFC 8707).
 *
 * The request is the URL the user has to open in a browser: it carries the
 * PKCE challenge, the one-time `state` value and the RFC 8707 resource
 * indicator. The module never opens a browser itself.
 *
 * The redirect URI must be a loopback IP literal (RFC 8252 §7.3): the host
 * name `localhost` is refused, because it resolves to a non-predictable
 * address on some systems.
 *
 * @module dsh-oauth-mcp/oauth/authorize-request
 */

import { formatScope, parseScope } from './types.js'
import { canonicalResource } from './resource.js'

/**
 * Report whether a host is a loopback IP literal.
 *
 * @param {string} hostname The host of a parsed URL.
 * @returns {boolean} Whether the host is `127.0.0.0/8` or `::1`.
 */
function isLoopbackHost(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false
  if (hostname === '[::1]' || hostname === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return false
  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 127
}

/**
 * Build the authorization request of one authorization attempt.
 *
 * @param {object} request Request parameters.
 * @param {string} request.authorizationEndpoint The authorization endpoint of the authorization server.
 * @param {string} request.clientId The client identifier.
 * @param {string} request.redirectUri The loopback redirect URI.
 * @param {string[] | string} request.scopes The requested scopes.
 * @param {string} request.state The one-time state value.
 * @param {string} request.codeChallenge The PKCE code challenge.
 * @param {string} [request.resource] The RFC 8707 resource indicator.
 * @param {Record<string, string>} [request.extraParams] Extra parameters to append.
 * @returns {{ url: string, params: URLSearchParams }} The URL to open and the parameters it carries.
 * @throws {TypeError} When a required value is missing or the redirect URI is not a loopback IP literal.
 */
export function buildAuthorizeRequest({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scopes,
  state,
  codeChallenge,
  resource,
  extraParams,
} = {}) {
  if (typeof authorizationEndpoint !== 'string' || authorizationEndpoint.length === 0) {
    throw new TypeError('An authorization endpoint is required.')
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('A client identifier is required.')
  }
  if (typeof redirectUri !== 'string' || redirectUri.length === 0) {
    throw new TypeError('A redirect URI is required.')
  }
  if (typeof state !== 'string' || state.length === 0) {
    throw new TypeError('A state value is required.')
  }
  if (typeof codeChallenge !== 'string' || codeChallenge.length === 0) {
    throw new TypeError('A code challenge is required.')
  }
  let parsedRedirect
  try {
    parsedRedirect = new URL(redirectUri)
  } catch {
    throw new TypeError('The redirect URI must be a parsable URL.')
  }
  if (parsedRedirect.protocol !== 'http:' && parsedRedirect.protocol !== 'https:') {
    throw new TypeError('The redirect URI must use the http or https scheme.')
  }
  if (!isLoopbackHost(parsedRedirect.hostname)) {
    throw new TypeError('The redirect URI must use a loopback IP literal, not a host name.')
  }
  const params = new URLSearchParams()
  params.set('response_type', 'code')
  params.set('client_id', clientId)
  params.set('redirect_uri', redirectUri)
  params.set('state', state)
  params.set('code_challenge', codeChallenge)
  params.set('code_challenge_method', 'S256')
  const scope = formatScope(parseScope(scopes))
  if (scope.length > 0) {
    params.set('scope', scope)
  }
  if (typeof resource === 'string' && resource.length > 0) {
    let indicator = resource
    try {
      indicator = canonicalResource(resource)
    } catch {
      // The indicator is sent as it was given when it is not a parsable URL.
    }
    params.set('resource', indicator)
  }
  if (extraParams && typeof extraParams === 'object') {
    for (const [key, value] of Object.entries(extraParams)) {
      if (typeof key !== 'string' || key.length === 0) continue
      if (value === undefined || value === null) continue
      params.set(key, String(value))
    }
  }
  const separator = authorizationEndpoint.includes('?') ? '&' : '?'
  return { url: `${authorizationEndpoint}${separator}${params.toString()}`, params }
}
