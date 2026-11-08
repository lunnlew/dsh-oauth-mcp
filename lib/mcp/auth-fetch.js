/**
 * Authorization-aware `fetch` wrapper for MCP requests.
 *
 * The wrapper adds `Authorization: Bearer <access token>` to every request
 * that goes to the MCP origin. Two rules keep the token from leaking:
 *
 * * a redirect to another origin is followed **without** the header;
 * * the token never appears in a URL, a log line or an error.
 *
 * When the server answers `401` the wrapper refreshes the grant once and
 * replays the request exactly once. A second `401` is terminal and raises
 * `McpUnauthorizedError` (see DESIGN.md §5.4 and §6.4).
 *
 * @module dsh-oauth-mcp/mcp/auth-fetch
 */

import { ERROR_CODES, McpError, McpUnauthorizedError } from '../oauth/errors.js'

/** How many redirects are followed before the request is abandoned. */
export const MAX_REDIRECTS = 5

/** HTTP status codes that carry a redirect. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Resolve the target URL of a `fetch` call.
 *
 * @param {unknown} input The `fetch` input: a URL, a string or a `Request`.
 * @returns {string} The absolute URL.
 */
function resolveUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input && typeof input.url === 'string') return input.url
  return String(input)
}

/**
 * Read one header from any header container.
 *
 * @param {unknown} headers The header container.
 * @param {string} name The header name, matched case-insensitively.
 * @returns {string | undefined} The header value, when present.
 */
function readHeader(headers, name) {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null ? undefined : value
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && String(entry[0]).toLowerCase() === wanted) return String(entry[1])
    }
    return undefined
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted) return String(value)
    }
  }
  return undefined
}

/**
 * Report whether two URLs share an origin.
 *
 * @param {string} left The first URL.
 * @param {string} right The second URL.
 * @returns {boolean} Whether both URLs share scheme, host and port.
 */
function isSameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

/**
 * Report whether a request body can be sent twice.
 *
 * @param {unknown} body The request body.
 * @returns {boolean} Whether the body may be replayed.
 */
function isReplayable(body) {
  if (body === undefined || body === null) return true
  if (typeof body === 'string') return true
  if (body instanceof URLSearchParams) return true
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(body)) return true
  // A stream body is consumed by the first attempt and cannot be replayed.
  return false
}

/**
 * Create the `fetch` wrapper that authorizes MCP requests.
 *
 * @param {object} options Wrapper options.
 * @param {() => string | Promise<string | undefined>} options.getAccessToken Returns the current access token.
 * @param {(context: { status?: number, error?: unknown }) => void} [options.onUnauthorized] Called when the server rejected the token and the request could not be recovered.
 * @param {() => Promise<unknown>} [options.refresh] Refreshes the grant; called at most once per request.
 * @param {typeof fetch} [options.fetchImpl] The fetch implementation to wrap.
 * @returns {(input: unknown, init?: object) => Promise<Response>} The authorized fetch function.
 */
export function createAuthFetch(options = {}) {
  const { getAccessToken, onUnauthorized, refresh } = options
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createAuthFetch requires a fetch implementation.')
  }

  /**
   * Read the current access token.
   *
   * @returns {Promise<string | undefined>} The token, when one is available.
   */
  async function readToken() {
    if (typeof getAccessToken !== 'function') return undefined
    const token = await getAccessToken()
    return typeof token === 'string' && token.length > 0 ? token : undefined
  }

  /**
   * Notify the host that the grant needs a new authorization.
   *
   * @param {number | undefined} status The HTTP status of the rejected request.
   * @param {unknown} [error] The error that ended the attempt.
   * @returns {void}
   */
  function notifyUnauthorized(status, error) {
    if (typeof onUnauthorized !== 'function') return
    try {
      onUnauthorized({ status, error })
    } catch {
      // A failing notification must not mask the original failure.
    }
  }

  /**
   * Perform one request, following redirects while keeping the token on the
   * MCP origin only.
   *
   * @param {string} origin The origin of the MCP server.
   * @param {string} url The URL to request.
   * @param {object} init The fetch init.
   * @param {string | undefined} token The access token, when one is available.
   * @returns {Promise<Response>} The final answer.
   */
  async function attempt(origin, url, init, token) {
    let currentUrl = url
    let currentInit = { ...init }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = new Headers(currentInit.headers)
      if (isSameOrigin(origin, currentUrl)) {
        if (token) headers.set('Authorization', `Bearer ${token}`)
        else headers.delete('Authorization')
      } else {
        // Never carry the token to another origin.
        headers.delete('Authorization')
      }
      const response = await fetchImpl(currentUrl, {
        ...currentInit,
        headers,
        redirect: 'manual',
      })
      if (!REDIRECT_STATUSES.has(response.status)) return response
      const location = readHeader(response.headers, 'location')
      if (!location) return response
      let nextUrl
      try {
        nextUrl = new URL(location, currentUrl).toString()
      } catch {
        return response
      }
      await response.text().catch(() => '')
      currentUrl = nextUrl
    }
    throw new McpError('The MCP server redirected too many times.', {
      code: ERROR_CODES.mcp_transport_error,
    })
  }

  /**
   * Perform an authorized request.
   *
   * @param {unknown} input The `fetch` input.
   * @param {object} [init] The `fetch` init.
   * @returns {Promise<Response>} The answer of the request.
   */
  async function authFetch(input, init) {
    const url = resolveUrl(input)
    const origin = url
    const baseInit = { ...(init ?? {}) }
    if (input && typeof input === 'object' && !(input instanceof URL) && typeof input.url === 'string') {
      baseInit.method = baseInit.method ?? input.method
      if (!baseInit.headers) baseInit.headers = input.headers
    }

    const token = await readToken()
    const response = await attempt(origin, url, baseInit, token)
    if (response.status !== 401) return response

    let refreshError
    if (typeof refresh === 'function') {
      try {
        await refresh()
      } catch (error) {
        refreshError = error
      }
    }
    if (refreshError) {
      notifyUnauthorized(response.status, refreshError)
      throw new McpUnauthorizedError(
        'The MCP server rejected the access token and the grant could not be refreshed.',
        { status: 401, cause: refreshError },
      )
    }
    if (!isReplayable(baseInit.body)) {
      notifyUnauthorized(response.status)
      throw new McpUnauthorizedError('The MCP server rejected the access token.', { status: 401 })
    }

    const replayToken = await readToken()
    const replay = await attempt(origin, url, baseInit, replayToken)
    if (replay.status === 401) {
      notifyUnauthorized(replay.status)
      throw new McpUnauthorizedError('The MCP server rejected the refreshed access token.', {
        status: 401,
      })
    }
    return replay
  }

  return authFetch
}
