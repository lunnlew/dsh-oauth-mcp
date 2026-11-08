/**
 * The host-web OAuth callback receiver.
 *
 * When the plugin cannot own a dedicated port it registers one exact route on
 * the host's own web server and lets the host serve the callback. The host's
 * `readResource` helper checks no cookie, no `Host` header and no `Origin`
 * header, so this module performs the `Origin` check itself: a request whose
 * `Origin` differs from the origin of the bound web server is answered with
 * `403` and never reaches the OAuth handler.
 *
 * The parsed query is handed to the caller exactly like the loopback receiver
 * does it; this module never interprets an OAuth parameter itself.
 *
 * @module dsh-oauth-mcp/callback/host-web
 */

import { CallbackError, ERROR_CODES } from '../oauth/errors.js'
import { renderErrorPage } from './loopback-server.js'

/**
 * Compare two origins.
 *
 * The comparison is exact, after both sides were normalized by the URL
 * parser, so `http://127.0.0.1:64188` and `http://127.0.0.1:64188/` are the
 * same origin while a different host or port is not.
 *
 * @param {unknown} candidate The origin of the request.
 * @param {string} expected The origin of the host web server.
 * @returns {boolean} Whether the two origins match.
 */
function sameOrigin(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  try {
    return new URL(candidate).origin === new URL(expected).origin
  } catch {
    return candidate.trim() === expected.trim()
  }
}

/**
 * Normalize the callback path.
 *
 * @param {unknown} path The configured path.
 * @returns {string} The path, always starting with a slash.
 */
function normalizePath(path) {
  const text = typeof path === 'string' && path.length > 0 ? path : '/oauth-mcp/callback'
  return text.startsWith('/') ? text : `/${text}`
}

/**
 * Start the host-web callback receiver.
 *
 * @param {object} options Receiver options.
 * @param {{ register: (route: { kind: 'exact', path: string, handler: (request: unknown, response: unknown) => void }) => (() => void) | void, getOrigin: () => string }} webServer
 *   The host web service.
 * @param {string} path The path the callback is served on.
 * @param {string[]} [paths] The paths the callback is served on; a vendor may
 *   demand a path of its own, and the authorization server redirects the
 *   browser there. `path` is always served.
 * @param {(request: { query: URLSearchParams, respond: (result: { status?: number, headers?: Record<string, string>, body?: string }) => void }) => unknown} onRequest
 *   The callback handler. It receives the parsed query and a `respond`
 *   function; it must call `respond` exactly once.
 * @param {{ warn?: (message: string, meta?: object) => void, info?: (message: string, meta?: object) => void, error?: (message: string, meta?: object) => void, debug?: (message: string, meta?: object) => void }} [logger]
 *   Diagnostic logger.
 * @returns {Promise<{ url: string, origin: string, close: () => void }>} The receiver.
 * @throws {CallbackError} When the host web server is not bound, or the route
 *   could not be registered.
 * @throws {TypeError} When the arguments are malformed.
 */
export async function startHostWebCallback({ webServer, path, paths, onRequest, logger } = {}) {
  if (!webServer || typeof webServer.register !== 'function') {
    throw new TypeError('startHostWebCallback requires the host web server.')
  }
  if (typeof onRequest !== 'function') {
    throw new TypeError('startHostWebCallback requires an onRequest function.')
  }

  /**
   * Emit a diagnostic line.
   *
   * @param {'debug' | 'info' | 'warn' | 'error'} level Log level.
   * @param {string} message The message.
   * @param {object} [meta] Extra context; never contains secrets.
   * @returns {void}
   */
  function log(level, message, meta) {
    const emit = logger?.[level]
    if (typeof emit !== 'function') return
    try {
      emit.call(logger, message, meta)
    } catch {
      // A failing logger must never break the receiver.
    }
  }

  let origin
  try {
    origin = webServer.getOrigin()
  } catch (error) {
    throw new CallbackError('The host web server is not bound, so host-web mode is unavailable.', {
      code: ERROR_CODES.callback_rejected,
      cause: error,
    })
  }
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new CallbackError('The host web server did not report an origin, so host-web mode is unavailable.', {
      code: ERROR_CODES.callback_rejected,
    })
  }

  const callbackPath = normalizePath(path)
  const callbackPaths = new Set(
    (Array.isArray(paths) ? paths : [path])
      .map((value) => normalizePath(value))
      .filter((value) => value.length > 0),
  )
  if (callbackPaths.size === 0) callbackPaths.add(callbackPath)

  /**
   * Write an HTTP response.
   *
   * @param {import('node:http').ServerResponse} response The response.
   * @param {number} status The status code.
   * @param {Record<string, string>} headers The response headers.
   * @param {string} body The response body.
   * @returns {void}
   */
  function writeResponse(response, status, headers, body) {
    if (!response || response.writableEnded || response.headersSent) return
    try {
      response.writeHead(status, headers)
      response.end(body)
    } catch {
      // The client is gone; nothing else can be done.
    }
  }

  /**
   * Serve one callback request.
   *
   * @param {import('node:http').IncomingMessage} request The request.
   * @param {import('node:http').ServerResponse} response The response.
   * @returns {Promise<void>} Resolves when the request was handled.
   */
  async function handler(request, response) {
    if (request?.method !== 'GET') {
      writeResponse(
        response,
        405,
        { 'content-type': 'text/html; charset=utf-8', allow: 'GET', 'cache-control': 'no-store' },
        renderErrorPage('callback_method_not_allowed', 'The callback receiver only answers GET requests.'),
      )
      return
    }

    const requestOrigin = request?.headers?.origin
    if (!sameOrigin(requestOrigin, origin)) {
      log('warn', 'dsh-oauth-mcp: rejected a callback request with an unexpected Origin header')
      writeResponse(
        response,
        403,
        { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        renderErrorPage('callback_forbidden', 'The callback request did not come from the host web page.'),
      )
      return
    }

    const url = typeof request?.url === 'string' ? request.url : ''
    const separator = url.indexOf('?')
    const search = separator >= 0 ? url.slice(separator + 1) : ''
    const query = new URLSearchParams(search)
    let answered = false

    /**
     * Write the answer of the callback handler.
     *
     * @param {{ status?: number, headers?: Record<string, string>, body?: string }} result The answer.
     * @returns {void}
     */
    const respond = (result = {}) => {
      if (answered) {
        log('warn', 'dsh-oauth-mcp: the callback handler answered twice; the second answer was dropped')
        return
      }
      answered = true
      const status = Number.isInteger(result.status) ? result.status : 200
      const headers = {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...(result.headers && typeof result.headers === 'object' ? result.headers : {}),
      }
      writeResponse(response, status, headers, typeof result.body === 'string' ? result.body : '')
    }

    try {
      await onRequest({ query, respond })
    } catch (error) {
      // Only the error name is logged: the message of a failed handler could
      // echo an authorization code or a token.
      log('warn', 'dsh-oauth-mcp: the callback handler failed', { error: String(error?.name ?? 'Error') })
      if (!answered) {
        answered = true
        writeResponse(
          response,
          500,
          { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          renderErrorPage('callback_failed', 'The callback could not be processed.'),
        )
      }
    }
  }

  let disposers = []
  try {
    for (const callbackPath of callbackPaths) {
      disposers.push(webServer.register({ kind: 'exact', path: callbackPath, handler }))
    }
  } catch (error) {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // The route that failed to register is already gone.
      }
    }
    throw new CallbackError('The host web server refused the callback route.', {
      code: ERROR_CODES.callback_rejected,
      cause: error,
    })
  }

  const url = `${origin.replace(/\/+$/, '')}${callbackPath}`

  /**
   * Remove the callback routes again.
   *
   * @returns {void}
   */
  function close() {
    for (const dispose of disposers) {
      if (typeof dispose !== 'function') continue
      try {
        dispose()
      } catch (error) {
        log('warn', 'dsh-oauth-mcp: the callback route could not be removed', { error: String(error?.message ?? error) })
      }
    }
  }

  log('info', 'dsh-oauth-mcp: the host-web callback receiver is ready', {
    path: callbackPath,
    paths: [...callbackPaths],
  })

  return { url, origin, close }
}
