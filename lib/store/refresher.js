/**
 * Access-token refresh with single-flight semantics.
 *
 * The refresher is the only module that turns a stale grant into a fresh one.
 * It owns three rules from the design:
 *
 * * a grant is refreshed 60 seconds before its recorded expiry, so a token
 *   cannot expire while the request is on the wire;
 * * only one refresh per server may be in flight — every other caller awaits
 *   the same flight instead of starting a second token request, which is what
 *   keeps a rotating refresh token from being overwritten twice;
 * * a refresh token that the authorization server rejects (`invalid_grant`)
 *   clears the stored grant, so the caller asks the user for a new
 *   authorization instead of retrying a dead grant.
 *
 * The module never logs a token, a refresh token or a client secret, and it
 * never puts one into an error message or an error detail.
 *
 * @module dsh-oauth-mcp/store/refresher
 */

import { DEFAULT_REFRESH_SKEW_MS, hasRefreshToken, isExpired, mergeTokenResponse } from '../oauth/types.js'
import { ERROR_CODES, TokenError, truncateDetail } from '../oauth/errors.js'
import { REDACTED, redactText } from '../util/redact.js'

/** Message used when the authorization server rejected the refresh token. */
const REAUTHORIZATION_MESSAGE =
  'The authorization server rejected the refresh token; a new authorization is required.'

/**
 * Build the form body of a refresh-token request.
 *
 * @param {object} payload The stored grant.
 * @returns {URLSearchParams} The request body.
 */
function buildRefreshForm(payload) {
  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('refresh_token', payload.refreshToken)
  form.set('client_id', payload.clientId)
  if (typeof payload.resource === 'string' && payload.resource.length > 0) {
    form.set('resource', payload.resource)
  }
  return form
}

/**
 * Build the request headers of a refresh-token request.
 *
 * A grant that carries a client secret authenticates with
 * `client_secret_basic`; a public client sends no secret at all.
 *
 * @param {object} payload The stored grant.
 * @returns {Record<string, string>} The request headers.
 */
function buildRefreshHeaders(payload) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  }
  if (typeof payload.clientSecret === 'string' && payload.clientSecret.length > 0) {
    const raw = `${encodeURIComponent(payload.clientId)}:${encodeURIComponent(payload.clientSecret)}`
    headers.authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
  }
  return headers
}

/**
 * Collect the secret values of a grant that must never reach an error.
 *
 * @param {object | undefined} payload The stored grant.
 * @returns {string[]} The secret values of the grant.
 */
function collectSecrets(payload) {
  if (!payload || typeof payload !== 'object') return []
  const candidates = [
    payload.accessToken,
    payload.refreshToken,
    payload.clientSecret,
    payload.codeVerifier,
  ]
  return candidates.filter((value) => typeof value === 'string' && value.length >= 4)
}

/**
 * Scrub a remote detail so it can be attached to an error.
 *
 * The answer of the authorization server is untrusted: it may echo the refresh
 * token inside `error_description`. The known secrets of the grant are
 * therefore replaced before the text is shortened, so that no token survives
 * into an error detail.
 *
 * @param {unknown} value The raw detail.
 * @param {object | undefined} [payload] The grant whose secrets are removed.
 * @returns {string} The redacted, truncated detail.
 */
function safeDetail(value, payload) {
  if (typeof value !== 'string' || value.length === 0) return ''
  let text = redactText(value)
  for (const secret of collectSecrets(payload)) {
    text = text.split(secret).join(REDACTED)
  }
  return truncateDetail(text)
}

/**
 * Create the refresher.
 *
 * @param {object} options Refresher options.
 * @param {{ load: (serverId: string) => Promise<object | undefined>, save: (serverId: string, payload: object) => Promise<object>, delete: (serverId: string) => Promise<void> }} options.tokenStore
 *   The token store that owns the persisted grant.
 * @param {{ postForm?: (url: string, form: URLSearchParams, options?: object) => Promise<unknown>, request?: (url: string, options?: object) => Promise<object> }} options.http
 *   The outbound HTTP client. `postForm` is preferred; `request` is used as a
 *   fallback so the refresher also works with a thinner client.
 * @param {() => number} [now] Clock used for expiry bookkeeping.
 * @param {number} [skewMs] How long before the expiry a refresh is started.
 * @returns {{
 *   needsRefresh: (payload: object | undefined) => boolean,
 *   refreshIfNeeded: (serverId: string) => Promise<object | undefined>,
 *   refresh: (serverId: string) => Promise<object | undefined>,
 * }} The refresher.
 */
export function createRefresher({
  tokenStore,
  http,
  now = Date.now,
  skewMs = DEFAULT_REFRESH_SKEW_MS,
} = {}) {
  /** @type {Map<string, Promise<object | undefined>>} In-flight refreshes, one per server. */
  const flights = new Map()

  /**
   * Report whether a grant is due for a refresh.
   *
   * @param {object | undefined} payload The stored grant.
   * @returns {boolean} Whether the access token should be refreshed.
   */
  function needsRefresh(payload) {
    return isExpired(payload, { skewMs, now: now() })
  }

  /**
   * Start a refresh flight, or join the one already running.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @param {() => Promise<object | undefined>} task The refresh work.
   * @returns {Promise<object | undefined>} The flight promise.
   */
  function startFlight(serverId, task) {
    const existing = flights.get(serverId)
    if (existing) return existing
    const flight = (async () => task())().finally(() => {
      flights.delete(serverId)
    })
    flights.set(serverId, flight)
    return flight
  }

  /**
   * Send the refresh-token request.
   *
   * @param {string} url The token endpoint.
   * @param {URLSearchParams} form The request body.
   * @param {Record<string, string>} headers The request headers.
   * @param {object | undefined} payload The stored grant, used to scrub secrets
   *   out of a remote error answer.
   * @returns {Promise<unknown>} The parsed response body.
   * @throws {TokenError} When the request failed or the answer is not usable.
   */
  async function postRefreshForm(url, form, headers, payload) {
    if (http && typeof http.postForm === 'function') {
      return await http.postForm(url, form, { headers })
    }
    if (http && typeof http.request === 'function') {
      const response = await http.request(url, {
        method: 'POST',
        headers,
        body: form.toString(),
      })
      const status = response?.status
      if (typeof status !== 'number' || status < 200 || status >= 300) {
        throw new TokenError('The authorization server rejected the refresh request.', {
          status,
          detail: safeDetail(response?.text ?? response?.detail, payload),
        })
      }
      return response?.body
    }
    throw new TypeError('The refresher requires an HTTP client with a postForm() method.')
  }

  /**
   * Perform one refresh of one server.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @param {{ required?: boolean }} [options] When `required`, a missing grant
       or a missing refresh token is an error instead of a no-op.
   * @returns {Promise<object | undefined>} The refreshed grant.
   * @throws {TokenError} When the refresh failed.
   */
  async function performRefresh(serverId, options = {}) {
    const payload = await tokenStore.load(serverId)
    if (!payload) {
      if (options.required) {
        throw new TokenError('There is no stored grant to refresh.', { code: ERROR_CODES.not_authorized })
      }
      return undefined
    }
    if (!hasRefreshToken(payload)) {
      if (options.required) {
        throw new TokenError('The stored grant has no refresh token; a new authorization is required.', {
          code: ERROR_CODES.not_authorized,
        })
      }
      return payload
    }
    if (typeof payload.tokenEndpoint !== 'string' || payload.tokenEndpoint.length === 0) {
      throw new TokenError('The stored grant has no token endpoint.', { code: ERROR_CODES.token_refresh_failed })
    }

    const form = buildRefreshForm(payload)
    const headers = buildRefreshHeaders(payload)

    let body
    try {
      body = await postRefreshForm(payload.tokenEndpoint, form, headers, payload)
    } catch (error) {
      if (error instanceof TokenError) throw error
      throw new TokenError('The refresh request failed.', {
        code: ERROR_CODES.token_refresh_failed,
        status: typeof error?.status === 'number' ? error.status : undefined,
        detail: safeDetail(error?.detail ?? error?.message, payload),
        cause: error,
      })
    }

    if (!body || typeof body !== 'object') {
      throw new TokenError('The authorization server returned an unreadable refresh response.', {
        code: ERROR_CODES.token_refresh_failed,
      })
    }

    if (typeof body.error === 'string' && body.error.length > 0) {
      const detail = safeDetail(body.error_description ?? body.error, payload)
      if (body.error === 'invalid_grant' || body.error === 'invalid_token') {
        await markAndClear(serverId, payload)
        throw new TokenError(REAUTHORIZATION_MESSAGE, {
          code: ERROR_CODES.invalid_grant,
          detail: detail || undefined,
        })
      }
      throw new TokenError('The authorization server rejected the refresh request.', {
        code: ERROR_CODES.token_refresh_failed,
        detail: detail || undefined,
      })
    }

    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new TokenError('The refresh response did not contain an access token.', {
        code: ERROR_CODES.token_refresh_failed,
        detail: safeDetail(body.error_description, payload),
      })
    }

    const merged = mergeTokenResponse(payload, body, { now: now() })
    await tokenStore.save(serverId, merged)
    return merged
  }

  /**
   * Record the failure and drop the dead grant.
   *
   * The failure marker is written first so the write path records why the
   * grant went away; the record is then removed, because a rejected refresh
   * token means the stored grant can no longer be used.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @param {object} payload The stored grant.
   * @returns {Promise<void>} Resolves once the grant is gone.
   */
  async function markAndClear(serverId, payload) {
    try {
      await tokenStore.save(serverId, { ...payload, lastError: REAUTHORIZATION_MESSAGE })
    } catch {
      // The marker is best effort; the grant is cleared below either way.
    }
    await tokenStore.delete(serverId)
  }

  /**
   * Refresh the grant of one server when it is due.
   *
   * A fresh grant is returned unchanged, a missing grant resolves to
   * `undefined`, and a grant without a refresh token is returned unchanged so
   * the caller can start a new authorization. Concurrent calls for the same
   * server share one refresh request.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {Promise<object | undefined>} The (possibly refreshed) grant.
   */
  async function refreshIfNeeded(serverId) {
    const existing = flights.get(serverId)
    if (existing) return existing

    const payload = await tokenStore.load(serverId)
    if (!payload) return undefined
    if (!needsRefresh(payload)) return payload
    if (!hasRefreshToken(payload)) return payload

    return startFlight(serverId, () => performRefresh(serverId))
  }

  /**
   * Force one refresh of the grant of one server.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {Promise<object | undefined>} The refreshed grant.
   * @throws {TokenError} When there is nothing to refresh, or the refresh failed.
   */
  async function refresh(serverId) {
    return startFlight(serverId, () => performRefresh(serverId, { required: true }))
  }

  return { needsRefresh, refreshIfNeeded, refresh }
}
