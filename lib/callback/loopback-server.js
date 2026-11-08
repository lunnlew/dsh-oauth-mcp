/**
 * The loopback OAuth callback receiver.
 *
 * The receiver is a small `node:http` server that binds the loopback
 * interface only. It exists to catch the redirect of an authorization
 * request, so it is deliberately paranoid:
 *
 * * it binds `127.0.0.1` (or `localhost`), never a routable address;
 * * it answers `405` to everything but `GET`;
 * * it accepts only the `Host` header values that belong to the loopback
 *   interface, which stops a DNS-rebinding page from posting the callback
 *   parameters to it;
 * * it never interprets the OAuth parameters itself — the parsed query is
 *   handed to the caller, which owns the state check and the code exchange;
 * * the pages it renders contain no code, no token and no state.
 *
 * @module dsh-oauth-mcp/callback/loopback-server
 */

import { createServer } from 'node:http'

import { CallbackError, ERROR_CODES } from '../oauth/errors.js'
import { renderErrorPage as renderCallbackErrorPage, renderSuccessPage as renderCallbackSuccessPage } from './pages.js'

/** The addresses the receiver is allowed to bind. */
const ALLOWED_BIND_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Build the page that confirms a finished authorization.
 *
 * The page carries no code, no token and no state — only a sentence the user
 * can read. It is the same page the host renders, so the user sees one
 * consistent answer wherever the callback lands.
 *
 * @returns {string} The HTML document.
 */
export function renderSuccessPage() {
  return renderCallbackSuccessPage()
}

/**
 * Build the page that reports a failed authorization.
 *
 * The page carries the OAuth error code and a redacted, truncated error
 * description — never a code, a token or a state.
 *
 * @param {unknown} error The OAuth error code.
 * @param {unknown} [errorDescription] The OAuth error description.
 * @returns {string} The HTML document.
 */
export function renderErrorPage(error, errorDescription) {
  return renderCallbackErrorPage(error, errorDescription)
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
 * Report whether a `Host` header belongs to the loopback interface.
 *
 * @param {unknown} hostHeader The `Host` header of the request.
 * @param {number} port The port the receiver listens on.
 * @returns {boolean} Whether the header is acceptable.
 */
function isAllowedHost(hostHeader, port) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false
  const host = hostHeader.trim().toLowerCase()
  const allowed = new Set([
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${port}`,
    `localhost:${port}`,
  ])
  return allowed.has(host)
}

/**
 * Start the loopback callback receiver.
 *
 * @param {object} options Receiver options.
 * @param {number} port The TCP port to listen on. `0` asks the operating
 *   system for a free port.
 * @param {string} path The path the callback is served on.
 * @param {string[]} [paths] The paths the callback is served on; a vendor may
 *   demand a path of its own, and the authorization server redirects the
 *   browser there. `path` is always served.
 * @param {string} [host] The address to bind; only `127.0.0.1` and
 *   `localhost` are accepted.
 * @param {(request: { query: URLSearchParams, respond: (result: { status?: number, headers?: Record<string, string>, body?: string }) => void }) => unknown} onRequest
 *   The callback handler. It receives the parsed query and a `respond`
 *   function; it must call `respond` exactly once.
 * @param {{ warn?: (message: string, meta?: object) => void, info?: (message: string, meta?: object) => void, error?: (message: string, meta?: object) => void, debug?: (message: string, meta?: object) => void }} [logger]
 *   Diagnostic logger.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>} The receiver.
 * @throws {CallbackError} When the port is already taken (`callback_conflict`).
 * @throws {TypeError} When the arguments are malformed.
 */
export async function startLoopbackServer({ port, path, paths, host = '127.0.0.1', onRequest, logger } = {}) {
  if (typeof onRequest !== 'function') {
    throw new TypeError('startLoopbackServer requires an onRequest function.')
  }
  const bindHost = String(host ?? '127.0.0.1').toLowerCase()
  if (!ALLOWED_BIND_HOSTS.has(bindHost)) {
    throw new TypeError('The loopback callback receiver may only bind 127.0.0.1 or localhost.')
  }
  const callbackPaths = new Set(
    (Array.isArray(paths) ? paths : [path])
      .map((value) => normalizePath(value))
      .filter((value) => value.length > 0),
  )
  if (callbackPaths.size === 0) callbackPaths.add('/')
  const requestedPort = Number(port)
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new TypeError('The loopback callback receiver requires a valid TCP port.')
  }

  const server = createServer()

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
    if (response.writableEnded || response.headersSent) return
    try {
      response.writeHead(status, headers)
      response.end(body)
    } catch {
      // The client is gone; nothing else can be done.
    }
  }

  /**
   * Serve one request.
   *
   * @param {import('node:http').IncomingMessage} request The request.
   * @param {import('node:http').ServerResponse} response The response.
   * @param {number} listeningPort The port the receiver listens on.
   * @returns {Promise<void>} Resolves when the request was handled.
   */
  async function serve(request, response, listeningPort) {
    if (request.method !== 'GET') {
      writeResponse(
        response,
        405,
        { 'content-type': 'text/html; charset=utf-8', allow: 'GET', 'cache-control': 'no-store' },
        renderErrorPage('callback_method_not_allowed', 'The callback receiver only answers GET requests.'),
      )
      return
    }

    if (!isAllowedHost(request.headers.host, listeningPort)) {
      log('warn', 'dsh-oauth-mcp: rejected a callback request with an unexpected Host header')
      writeResponse(
        response,
        400,
        { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        renderErrorPage('callback_invalid_host', 'The callback request did not come from the loopback interface.'),
      )
      return
    }

    const separator = request.url?.indexOf('?') ?? -1
    const pathname = separator >= 0 ? request.url.slice(0, separator) : request.url ?? '/'
    if (!callbackPaths.has(pathname)) {
      writeResponse(
        response,
        404,
        { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        renderErrorPage('callback_path_not_found', 'The callback path does not exist.'),
      )
      return
    }

    const search = separator >= 0 ? request.url.slice(separator + 1) : ''
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

  server.on('request', (request, response) => {
    const address = server.address()
    const listeningPort = typeof address === 'object' && address ? address.port : requestedPort
    void serve(request, response, listeningPort)
  })

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(requestedPort, bindHost)
    })
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw new CallbackError('The loopback callback port is already in use.', {
        code: ERROR_CODES.callback_conflict,
        cause: error,
      })
    }
    throw error
  }

  const address = server.address()
  const listeningPort = typeof address === 'object' && address ? address.port : requestedPort
  const callbackPath = normalizePath(path)
  const url = `http://${bindHost}:${listeningPort}${callbackPath}`
  let closed = false

  /**
   * Stop the receiver.
   *
   * @returns {Promise<void>} Resolves when the socket is closed.
   */
  async function close() {
    if (closed) return
    closed = true
    await new Promise((resolve) => {
      try {
        server.close(() => resolve())
        server.closeAllConnections?.()
      } catch {
        resolve()
      }
    })
  }

  log('info', 'dsh-oauth-mcp: the loopback callback receiver is listening', {
    port: listeningPort,
    path: callbackPath,
    paths: [...callbackPaths],
  })

  return { url, port: listeningPort, close }
}
