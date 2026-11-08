/**
 * Token endpoint requests (RFC 6749 §4 and §6).
 *
 * The module builds the form bodies of the authorization-code and the refresh
 * grant, applies the client authentication method of the authorization
 * server and turns a refusal into a `TokenError`.
 *
 * A refusal is never echoed verbatim: only the OAuth `error` code and a
 * truncated `error_description` survive, and both are scrubbed first.
 *
 * @module dsh-oauth-mcp/oauth/token
 */

import { ERROR_CODES, TokenError } from './errors.js'
import { redactText } from '../util/redact.js'

/**
 * Encode one value for the HTTP Basic authentication header.
 *
 * RFC 6749 §2.3.1 requires the client identifier and the client secret to be
 * form-encoded before they are used as user name and password.
 *
 * @param {string} value The value to encode.
 * @returns {string} The encoded value.
 */
function formEncode(value) {
  return encodeURIComponent(value)
}

/**
 * Build the `Authorization` header of the `client_secret_basic` method.
 *
 * @param {string} clientId The client identifier.
 * @param {string} clientSecret The client secret.
 * @returns {string} The header value.
 */
export function buildAuthorizationHeader(clientId, clientSecret) {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('A client identifier is required.')
  }
  if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new TypeError('A client secret is required.')
  }
  const raw = `${formEncode(clientId)}:${formEncode(clientSecret)}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

/**
 * Build the form body and the headers of one token request.
 *
 * @param {object} params Request parameters.
 * @param {string} params.tokenEndpoint The token endpoint of the authorization server.
 * @param {string} params.grantType The grant to use, `authorization_code` or `refresh_token`.
 * @param {string} params.clientId The client identifier.
 * @param {string} [params.clientSecret] The client secret, when the server issued one.
 * @param {string} [params.code] The authorization code, for the authorization-code grant.
 * @param {string} [params.redirectUri] The redirect URI, for the authorization-code grant.
 * @param {string} [params.codeVerifier] The PKCE code verifier, for the authorization-code grant.
 * @param {string} [params.refreshToken] The refresh token, for the refresh grant.
 * @param {string} [params.resource] The RFC 8707 resource indicator.
 * @param {string} [params.tokenEndpointAuthMethod='none'] The client authentication method.
 * @returns {{ url: string, headers: Record<string, string>, body: URLSearchParams }} The request.
 */
export function buildTokenRequest({
  tokenEndpoint,
  grantType,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
  refreshToken,
  resource,
  tokenEndpointAuthMethod = 'none',
} = {}) {
  if (typeof tokenEndpoint !== 'string' || tokenEndpoint.length === 0) {
    throw new TypeError('A token endpoint is required.')
  }
  if (typeof grantType !== 'string' || grantType.length === 0) {
    throw new TypeError('A grant type is required.')
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('A client identifier is required.')
  }
  const body = new URLSearchParams()
  body.set('grant_type', grantType)
  body.set('client_id', clientId)
  if (typeof resource === 'string' && resource.length > 0) {
    body.set('resource', resource)
  }
  if (grantType === 'authorization_code') {
    if (typeof code === 'string' && code.length > 0) body.set('code', code)
    if (typeof redirectUri === 'string' && redirectUri.length > 0) body.set('redirect_uri', redirectUri)
    if (typeof codeVerifier === 'string' && codeVerifier.length > 0) body.set('code_verifier', codeVerifier)
  } else if (grantType === 'refresh_token') {
    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      body.set('refresh_token', refreshToken)
    }
  }
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (tokenEndpointAuthMethod === 'client_secret_basic') {
    headers.Authorization = buildAuthorizationHeader(clientId, clientSecret)
  } else if (tokenEndpointAuthMethod === 'client_secret_post') {
    if (typeof clientSecret === 'string' && clientSecret.length > 0) {
      body.set('client_secret', clientSecret)
    }
  }
  return { url: tokenEndpoint, headers, body }
}

/**
 * Read the OAuth error code out of a failed HTTP answer.
 *
 * The detail of an `HttpError` holds the redacted body of the answer, so the
 * error code is looked up there.
 *
 * @param {unknown} error The thrown error.
 * @returns {string} The OAuth error code, empty when the answer carried none.
 */
function readOAuthErrorCode(error) {
  const detail = typeof error?.detail === 'string' ? error.detail : ''
  if (detail.length === 0) return ''
  try {
    const parsed = JSON.parse(detail)
    if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error
  } catch {
    // The detail was truncated; fall back to a text scan.
  }
  const match = /"error"\s*:\s*"([^"]+)"/.exec(detail)
  return match ? match[1] : ''
}

/**
 * Build the detail of a refused token request.
 *
 * @param {unknown} body The parsed body of the answer.
 * @returns {string} The redacted detail.
 */
function describeRefusal(body) {
  const parts = []
  if (body && typeof body.error === 'string' && body.error.length > 0) {
    parts.push(redactText(body.error))
  }
  if (body && typeof body.error_description === 'string' && body.error_description.length > 0) {
    parts.push(redactText(body.error_description))
  }
  return parts.join(': ')
}

/**
 * Send one token request and interpret the answer.
 *
 * @param {{ url: string, headers: Record<string, string>, body: URLSearchParams }} request The request to send.
 * @param {object} http The HTTP client.
 * @param {AbortSignal} [signal] Abort signal.
 * @param {string} failureCode The error code used for a refusal that is not `invalid_grant`.
 * @returns {Promise<object>} The parsed token response.
 * @throws {TokenError} When the authorization server refused the request or answered without an access token.
 */
async function sendTokenRequest(request, http, signal, failureCode) {
  if (!http || typeof http.postForm !== 'function') {
    throw new TypeError('A token request requires an HTTP client.')
  }
  let body
  try {
    body = await http.postForm(request.url, request.body, { headers: request.headers, signal })
  } catch (error) {
    const oauthCode = readOAuthErrorCode(error)
    const status = typeof error?.status === 'number' ? error.status : undefined
    const detail = typeof error?.detail === 'string' ? error.detail : undefined
    throw new TokenError(
      'The authorization server refused the token request.',
      {
        status,
        detail,
        cause: error,
        code: oauthCode === 'invalid_grant' ? ERROR_CODES.invalid_grant : failureCode,
      },
    )
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (typeof body.error === 'string' && body.error.length > 0) {
      throw new TokenError('The authorization server refused the token request.', {
        detail: describeRefusal(body),
        code: body.error === 'invalid_grant' ? ERROR_CODES.invalid_grant : failureCode,
      })
    }
    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new TokenError('The token response carried no access token.', { code: failureCode })
    }
  } else {
    throw new TokenError('The token response carried no access token.', { code: failureCode })
  }
  return body
}

/**
 * Exchange an authorization code for a token.
 *
 * @param {object} params Request parameters, as taken by `buildTokenRequest`.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<object>} The parsed token response.
 * @throws {TokenError} When the authorization server refused the exchange.
 */
export async function exchangeAuthorizationCode(params, { http, signal } = {}) {
  const request = buildTokenRequest({ ...params, grantType: 'authorization_code' })
  return sendTokenRequest(request, http, signal, ERROR_CODES.token_exchange_failed)
}

/**
 * Refresh an access token.
 *
 * @param {object} params Request parameters, as taken by `buildTokenRequest`.
 * @param {{ http: object, signal?: AbortSignal }} context The HTTP client and the abort signal.
 * @returns {Promise<object>} The parsed token response.
 * @throws {TokenError} When the authorization server refused the refresh.
 */
export async function refreshAccessToken(params, { http, signal } = {}) {
  const request = buildTokenRequest({ ...params, grantType: 'refresh_token' })
  return sendTokenRequest(request, http, signal, ERROR_CODES.token_refresh_failed)
}
