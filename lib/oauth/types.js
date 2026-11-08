/**
 * Shared value shapes for the OAuth 2.1 client.
 *
 * This module is pure: it holds constants, small parsers and the payload
 * factory used by the token store. It never touches the network and never
 * imports a host package, so it can be unit-tested without a DSH runtime.
 *
 * @module dsh-oauth-mcp/oauth/types
 */

import { PLUGIN_ID, PLUGIN_VERSION } from '../build-info.js'

/** Client name sent to an authorization server during dynamic registration. */
export const CLIENT_NAME = `DSH (${PLUGIN_ID})`

/** Software identifier sent during dynamic registration (RFC 7591). */
export const SOFTWARE_ID = PLUGIN_ID

/** Software version sent during dynamic registration (RFC 7591). */
export const SOFTWARE_VERSION = PLUGIN_VERSION

/** RFC 9728 protected-resource metadata path. */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

/** RFC 8414 authorization-server metadata path. */
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'

/** OpenID Connect discovery path, used as an extra fallback for RFC 8414. */
export const OPENID_CONFIGURATION_PATH = '/.well-known/openid-configuration'

/** Refresh this many milliseconds before the recorded expiry. */
export const DEFAULT_REFRESH_SKEW_MS = 60_000

/** Lifetime of an authorization `state` value. */
export const STATE_TTL_MS = 10 * 60 * 1000

/** Default ceiling for a pending authorization request. */
export const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 300_000

/** Client authentication methods this plugin supports (RFC 7591 / RFC 6749). */
export const TOKEN_ENDPOINT_AUTH_METHODS = Object.freeze([
  'none',
  'client_secret_basic',
  'client_secret_post',
])

/** Grant types this plugin requests. */
export const SUPPORTED_GRANT_TYPES = Object.freeze(['authorization_code', 'refresh_token'])

/** Response types this plugin requests. */
export const SUPPORTED_RESPONSE_TYPES = Object.freeze(['code'])

/**
 * The credential payload stored for one MCP server.
 *
 * The whole payload lives inside one `GrantRecord` in the host credential
 * store (`{ kind: 'grant', payload }`), so access tokens, refresh tokens and
 * the client secret never reach plugin config or the settings document.
 *
 * @typedef {object} OAuthMcpGrantPayload
 * @property {string} serverId Plugin-local identifier of the MCP server.
 * @property {string} serverUrl The MCP server endpoint the grant belongs to.
 * @property {string} resource Canonical RFC 8707 resource indicator.
 * @property {string} [issuer] Issuer of the authorization server that granted the token.
 * @property {string} [authorizationEndpoint] Authorization endpoint used for the flow.
 * @property {string} [tokenEndpoint] Token endpoint used for the flow.
 * @property {string} [registrationEndpoint] Dynamic client registration endpoint.
 * @property {string} clientId The OAuth client identifier.
 * @property {string} [clientSecret] The OAuth client secret, when the server issued one.
 * @property {string} redirectUri The redirect URI bound to this grant.
 * @property {string[]} scopes Scopes granted to this client.
 * @property {string} accessToken The current access token.
 * @property {string} [refreshToken] The current refresh token, when the server issued one.
 * @property {string} tokenType Token type, always `Bearer` in this plugin.
 * @property {number} [expiresAt] Absolute expiry in epoch milliseconds.
 * @property {number} obtainedAt Epoch milliseconds when the token was issued.
 * @property {string} [lastError] Short description of the last failure, never a secret.
 */

/**
 * Split an OAuth scope string into its members.
 *
 * @param {unknown} value A space-delimited scope string, or an array of scopes.
 * @returns {string[]} The scope members, empty when the input carries none.
 */
export function parseScope(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.length > 0)
  if (typeof value !== 'string') return []
  return value.split(/[\s+]+/).map((item) => item.trim()).filter(Boolean)
}

/**
 * Join scope members into the space-delimited form used on the wire.
 *
 * @param {unknown} scopes Scope members.
 * @returns {string} The space-delimited scope string.
 */
export function formatScope(scopes) {
  return Array.isArray(scopes) ? scopes.filter((item) => typeof item === 'string' && item.length > 0).join(' ') : ''
}

/**
 * Convert an `expires_in` value into an absolute expiry timestamp.
 *
 * @param {unknown} expiresIn Lifetime in seconds, as reported by the server.
 * @param {number} [obtainedAt] Epoch milliseconds the token was issued.
 * @returns {number | undefined} Absolute expiry, or `undefined` for a non-expiring token.
 */
export function computeExpiresAt(expiresIn, obtainedAt = Date.now()) {
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) return undefined
  return obtainedAt + Math.max(0, expiresIn) * 1000
}

/**
 * Report whether a stored grant needs a refresh.
 *
 * A grant without `expiresAt` is treated as non-expiring: the server did not
 * declare a lifetime, so the plugin keeps using it until the server rejects
 * it with `401`.
 *
 * @param {OAuthMcpGrantPayload | undefined} payload The stored grant.
 * @param {{ skewMs?: number, now?: number }} [options] Refresh skew and clock.
 * @returns {boolean} Whether the access token should be refreshed.
 */
export function isExpired(payload, options = {}) {
  if (!payload || typeof payload.expiresAt !== 'number') return false
  const skewMs = options.skewMs ?? DEFAULT_REFRESH_SKEW_MS
  const now = options.now ?? Date.now()
  return payload.expiresAt - skewMs <= now
}

/**
 * Report whether a stored grant carries a refresh token.
 *
 * @param {OAuthMcpGrantPayload | undefined} payload The stored grant.
 * @returns {boolean} Whether a refresh token is available.
 */
export function hasRefreshToken(payload) {
  return typeof payload?.refreshToken === 'string' && payload.refreshToken.length > 0
}

/**
 * Build the credential payload for one server.
 *
 * @param {object} input Grant inputs.
 * @param {string} input.serverId Plugin-local server identifier.
 * @param {string} input.serverUrl MCP server endpoint.
 * @param {string} input.resource Canonical resource indicator.
 * @param {string} input.clientId OAuth client identifier.
 * @param {string} input.accessToken Access token.
 * @param {string} [input.clientSecret] Client secret, when issued.
 * @param {string} [input.redirectUri] Redirect URI bound to this grant.
 * @param {string[]} [input.scopes] Granted scopes.
 * @param {string} [input.refreshToken] Refresh token.
 * @param {string} [input.issuer] Authorization server issuer.
 * @param {string} [input.authorizationEndpoint] Authorization endpoint.
 * @param {string} [input.tokenEndpoint] Token endpoint.
 * @param {string} [input.registrationEndpoint] Registration endpoint.
 * @param {number} [input.expiresIn] Access-token lifetime in seconds.
 * @param {number} [input.obtainedAt] Epoch milliseconds the token was issued.
 * @returns {OAuthMcpGrantPayload} The payload to store in the credential record.
 */
export function createGrantPayload(input) {
  const obtainedAt = input.obtainedAt ?? Date.now()
  return {
    serverId: input.serverId,
    serverUrl: input.serverUrl,
    resource: input.resource,
    clientId: input.clientId,
    accessToken: input.accessToken,
    tokenType: 'Bearer',
    redirectUri: input.redirectUri,
    scopes: input.scopes ? parseScope(input.scopes) : [],
    obtainedAt,
    ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
    ...(input.issuer ? { issuer: input.issuer } : {}),
    ...(input.authorizationEndpoint ? { authorizationEndpoint: input.authorizationEndpoint } : {}),
    ...(input.tokenEndpoint ? { tokenEndpoint: input.tokenEndpoint } : {}),
    ...(input.registrationEndpoint ? { registrationEndpoint: input.registrationEndpoint } : {}),
    ...(computeExpiresAt(input.expiresIn, obtainedAt) === undefined
      ? {}
      : { expiresAt: computeExpiresAt(input.expiresIn, obtainedAt) }),
  }
}

/**
 * Merge a token response into an existing grant payload.
 *
 * A refresh response that omits `refresh_token` keeps the previous refresh
 * token; a response that omits `scope` keeps the previously granted scopes.
 *
 * @param {OAuthMcpGrantPayload} payload The stored grant.
 * @param {object} response The token response body.
 * @param {{ now?: number }} [options] Clock override.
 * @returns {OAuthMcpGrantPayload} The updated payload.
 */
export function mergeTokenResponse(payload, response, options = {}) {
  const now = options.now ?? Date.now()
  const next = { ...payload }
  if (typeof response?.access_token === 'string' && response.access_token.length > 0) {
    next.accessToken = response.access_token
  }
  if (typeof response?.refresh_token === 'string' && response.refresh_token.length > 0) {
    next.refreshToken = response.refresh_token
  }
  if (typeof response?.token_type === 'string' && response.token_type.length > 0) {
    next.tokenType = response.token_type
  }
  if (typeof response?.scope === 'string' && response.scope.length > 0) {
    next.scopes = parseScope(response.scope)
  }
  next.obtainedAt = now
  const expiresAt = computeExpiresAt(response?.expires_in, now)
  if (expiresAt === undefined) delete next.expiresAt
  else next.expiresAt = expiresAt
  delete next.lastError
  return next
}
