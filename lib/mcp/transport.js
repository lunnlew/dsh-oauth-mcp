/**
 * Minimal streamable-http JSON-RPC transport for the MCP client.
 *
 * The plugin deliberately does not depend on `@modelcontextprotocol/sdk`: it
 * has to own the `Authorization` header itself (the SDK would want to own the
 * whole OAuth flow), and a dependency-free client keeps the bundle small.
 * This module implements exactly the part of the MCP "Streamable HTTP"
 * transport the plugin needs:
 *
 * * `POST <url>` with `Content-Type: application/json` and
 *   `Accept: application/json, text/event-stream`;
 * * `Mcp-Session-Id` is echoed once the server assigned one;
 * * `MCP-Protocol-Version` is sent once the version has been negotiated;
 * * the answer is either one JSON-RPC message (`application/json`) or a
 *   server-sent event stream whose `data:` lines carry JSON-RPC messages.
 *
 * A notification (a JSON-RPC message without an `id`) is not an answer: the
 * transport keeps reading until a message with the matching `id` arrives.
 *
 * The module is pure: it never imports a host package and never logs. The
 * `Authorization` header is injected by the caller through the `fetchImpl`
 * it supplies (see `lib/mcp/auth-fetch.js`).
 *
 * @module dsh-oauth-mcp/mcp/transport
 */

import { ERROR_CODES, McpError, McpForbiddenError, McpUnauthorizedError } from '../oauth/errors.js'
import { redactText, redactUrl } from '../util/redact.js'
import { createTimeoutSignal } from '../http/timeout.js'

/** Default timeout applied to every MCP request, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** Content type of a JSON-RPC answer. */
const JSON_CONTENT_TYPE = 'application/json'

/** Content type of a server-sent event answer. */
const SSE_CONTENT_TYPE = 'text/event-stream'

/**
 * @typedef {object} McpTransportResponse
 * @property {number} status HTTP status code of the answer.
 * @property {Record<string, string>} headers Response headers, lower-cased keys.
 * @property {unknown[]} messages Every JSON-RPC message carried by the answer.
 * @property {object | undefined} response The message whose `id` matches the request.
 */

/**
 * Merge header maps case-insensitively.
 *
 * Later maps win. The result is a list of `[name, value]` pairs, which is the
 * shape `fetch` accepts.
 *
 * @param {...(Record<string, unknown> | undefined)} maps Header maps to merge.
 * @returns {[string, string][]} The merged header list.
 */
function mergeHeaders(...maps) {
  const store = new Map()
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue
    for (const [name, value] of Object.entries(map)) {
      if (typeof name !== 'string' || name.length === 0) continue
      if (value === undefined || value === null) continue
      store.set(name.toLowerCase(), [name, String(value)])
    }
  }
  return [...store.values()]
}

/**
 * Read one header from a `Headers`, `Map` or plain object.
 *
 * @param {unknown} headers The header container.
 * @param {string} name The header name, matched case-insensitively.
 * @returns {string | undefined} The header value, when present.
 */
function readHeader(headers, name) {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  if (typeof headers.forEach === 'function') {
    let found
    headers.forEach((value, key) => {
      if (found === undefined && String(key).toLowerCase() === wanted) found = value
    })
    return found
  }
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null ? undefined : value
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted) return value
    }
  }
  return undefined
}

/**
 * Copy the response headers into a plain, lower-cased object.
 *
 * @param {unknown} headers The header container.
 * @returns {Record<string, string>} The copied headers.
 */
function collectHeaders(headers) {
  const result = {}
  if (!headers) return result
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[String(key).toLowerCase()] = String(value)
    })
    return result
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      result[key.toLowerCase()] = String(value)
    }
  }
  return result
}

/**
 * Combine abort signals into one.
 *
 * @param {Array<AbortSignal | undefined>} signals The signals to combine.
 * @returns {AbortSignal | undefined} The combined signal, when there is one.
 */
function linkSignals(signals) {
  const active = signals.filter((signal) => signal && typeof signal.addEventListener === 'function')
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  const controller = new AbortController()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * Report whether two JSON-RPC identifiers denote the same request.
 *
 * @param {unknown} left The first identifier.
 * @param {unknown} right The second identifier.
 * @returns {boolean} Whether both identifiers match.
 */
function sameId(left, right) {
  if (left === undefined || right === undefined) return false
  if (left === right) return true
  return String(left) === String(right)
}

/**
 * Locate the blank line that terminates an SSE event block.
 *
 * @param {string} buffer The buffered text.
 * @returns {{ index: number, length: number } | undefined} The separator position.
 */
function findEventBoundary(buffer) {
  const match = /\r?\n\r?\n/.exec(buffer)
  if (!match) return undefined
  return { index: match.index, length: match[0].length }
}

/**
 * Parse one SSE event block into a JSON-RPC message.
 *
 * @param {string} raw The raw event block.
 * @returns {object | undefined} The parsed message, when the block carried one.
 */
function parseEventBlock(raw) {
  const dataLines = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return undefined
  const payload = dataLines.join('\n')
  if (payload.trim().length === 0) return undefined
  try {
    return JSON.parse(payload)
  } catch (cause) {
    throw new McpError('The MCP server sent a malformed JSON-RPC event.', {
      code: ERROR_CODES.mcp_protocol_error,
      detail: redactText(payload),
      cause,
    })
  }
}

/**
 * Parse a complete SSE body.
 *
 * @param {string} text The raw body.
 * @returns {object[]} The parsed JSON-RPC messages.
 */
function parseEventStreamText(text) {
  const messages = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const message = parseEventBlock(block)
    if (message !== undefined) messages.push(message)
  }
  return messages
}

/**
 * Parse a JSON body that carries one JSON-RPC message (or a batch).
 *
 * @param {string} text The raw body.
 * @returns {object[]} The parsed JSON-RPC messages.
 */
function parseJsonBody(text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (cause) {
    throw new McpError('The MCP server returned a malformed JSON-RPC payload.', {
      code: ERROR_CODES.mcp_protocol_error,
      detail: redactText(trimmed),
      cause,
    })
  }
  return Array.isArray(parsed) ? parsed : [parsed]
}

/**
 * Read an SSE answer until the matching JSON-RPC message arrives.
 *
 * @param {Response} response The HTTP answer.
 * @param {{ matchId?: unknown }} options The identifier to wait for.
 * @returns {Promise<object[]>} The messages read from the stream.
 */
async function readEventStream(response, options) {
  const matchId = options.matchId
  const messages = []
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text()
    for (const message of parseEventStreamText(text)) {
      messages.push(message)
      if (matchId !== undefined && sameId(message?.id, matchId)) return messages
    }
    return messages
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let boundary = findEventBoundary(buffer)
      while (boundary) {
        const raw = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const message = parseEventBlock(raw)
        if (message !== undefined) {
          messages.push(message)
          if (matchId !== undefined && sameId(message.id, matchId)) return messages
        }
        boundary = findEventBoundary(buffer)
      }
    }
    buffer += decoder.decode()
    const tail = parseEventBlock(buffer)
    if (tail !== undefined) messages.push(tail)
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream is already closed; nothing to release.
    }
    try {
      reader.releaseLock()
    } catch {
      // The lock is released implicitly when the stream errored.
    }
  }
  return messages
}

/**
 * Extract the scopes a `WWW-Authenticate` challenge asks for.
 *
 * @param {unknown} headers The response headers.
 * @returns {string[]} The requested scopes, empty when the header names none.
 */
function parseChallengeScopes(headers) {
  const challenge = readHeader(headers, 'www-authenticate')
  if (typeof challenge !== 'string') return []
  const match = /scope\s*=\s*"([^"]*)"/i.exec(challenge)
  if (!match) return []
  return match[1]
    .split(/[\s+]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

/**
 * Build the error that describes a non-2xx HTTP answer.
 *
 * @param {number} status The HTTP status code.
 * @param {string} text The response body.
 * @param {unknown} headers The response headers.
 * @returns {McpError} The error to throw.
 */
function httpError(status, text, headers) {
  const detail = redactText(text)
  if (status === 401) {
    return new McpUnauthorizedError('The MCP server rejected the access token.', { status, detail })
  }
  if (status === 403) {
    return new McpForbiddenError('The MCP server denied the request.', {
      status,
      detail,
      missingScopes: parseChallengeScopes(headers),
    })
  }
  return new McpError(`The MCP server answered with HTTP ${status}.`, { status, detail })
}

/**
 * Create a minimal streamable-http JSON-RPC transport.
 *
 * @param {object} options Transport options.
 * @param {string} options.url The MCP endpoint URL.
 * @param {typeof fetch} [options.fetchImpl] The fetch implementation to use.
 * @param {Record<string, string>} [options.headers] Static headers sent with every request.
 * @param {string} [options.sessionId] A session identifier the server already assigned.
 * @param {string} [options.protocolVersion] The negotiated MCP protocol version.
 * @returns {object} The transport: `url`, `sessionId`, `protocolVersion`, `send`, `close`.
 */
export function createMcpTransport(options = {}) {
  const { url, fetchImpl = globalThis.fetch, headers = {}, sessionId, protocolVersion } = options
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('createMcpTransport requires a url.')
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createMcpTransport requires a fetch implementation.')
  }
  const baseHeaders = headers && typeof headers === 'object' ? { ...headers } : {}
  const safeUrl = redactUrl(url)
  let currentSessionId = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined
  let currentProtocolVersion =
    typeof protocolVersion === 'string' && protocolVersion.length > 0 ? protocolVersion : undefined
  let closed = false

  /**
   * Send one JSON-RPC message and wait for its answer.
   *
   * @param {object} message The JSON-RPC message to send.
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [sendOptions] Timeout and cancellation.
   * @returns {Promise<McpTransportResponse>} The answer.
   */
  async function send(message, sendOptions = {}) {
    if (closed) {
      throw new McpError('The MCP transport is closed.', { code: ERROR_CODES.mcp_protocol_error })
    }
    const timeoutMs = sendOptions.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const requestId = message && typeof message === 'object' ? message.id : undefined
    const extraHeaders = {
      'Content-Type': JSON_CONTENT_TYPE,
      Accept: `${JSON_CONTENT_TYPE}, ${SSE_CONTENT_TYPE}`,
    }
    if (currentSessionId) extraHeaders['Mcp-Session-Id'] = currentSessionId
    if (currentProtocolVersion) extraHeaders['MCP-Protocol-Version'] = currentProtocolVersion

    const timeout = createTimeoutSignal(timeoutMs, `Request timed out after ${timeoutMs}ms`)
    const signal = linkSignals([sendOptions.signal, timeout.signal])
    let response
    try {
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: mergeHeaders(baseHeaders, extraHeaders),
          body: JSON.stringify(message),
          signal,
          redirect: 'manual',
        })
      } catch (cause) {
        if (timeout.signal.aborted) {
          throw new McpError(`Request timed out after ${timeoutMs}ms`, {
            code: ERROR_CODES.mcp_transport_error,
            cause,
          })
        }
        if (sendOptions.signal?.aborted) {
          throw new McpError('The MCP request was aborted.', {
            code: ERROR_CODES.mcp_transport_error,
            cause,
          })
        }
        throw new McpError(`The MCP server at ${safeUrl} could not be reached.`, {
          code: ERROR_CODES.mcp_transport_error,
          detail: redactText(cause?.message ?? String(cause)),
          cause,
        })
      }

      const responseHeaders = response.headers
      const assignedSessionId = readHeader(responseHeaders, 'mcp-session-id')
      if (typeof assignedSessionId === 'string' && assignedSessionId.length > 0) {
        currentSessionId = assignedSessionId
      }

      const status = typeof response.status === 'number' ? response.status : 0
      if (status === 202) {
        // The server accepted a notification; there is no body to read.
        await response.text().catch(() => '')
        return { status, headers: collectHeaders(responseHeaders), messages: [], response: undefined }
      }
      if (status < 200 || status >= 300) {
        const text = await response.text().catch(() => '')
        throw httpError(status, text, responseHeaders)
      }

      const contentType = readHeader(responseHeaders, 'content-type') ?? ''
      const messages = contentType.toLowerCase().includes(SSE_CONTENT_TYPE)
        ? await readEventStream(response, { matchId: requestId })
        : parseJsonBody(await response.text())

      const matched = messages.find((message) => sameId(message?.id, requestId))
      if (requestId !== undefined && matched === undefined) {
        throw new McpError('The MCP server did not answer the request.', {
          code: ERROR_CODES.mcp_protocol_error,
          status,
        })
      }
      return { status, headers: collectHeaders(responseHeaders), messages, response: matched }
    } finally {
      // The timer is released on every path, including the failing ones: a
      // timer that outlives the request keeps the event loop alive.
      timeout.dispose()
    }
  }

  /**
   * Terminate the MCP session.
   *
   * The server may answer `405`; the failure is ignored on purpose.
   *
   * @returns {Promise<void>} Resolves once the best-effort DELETE finished.
   */
  async function close() {
    if (closed) return
    closed = true
    if (!currentSessionId) return
    const extraHeaders = { Accept: JSON_CONTENT_TYPE }
    if (currentProtocolVersion) extraHeaders['MCP-Protocol-Version'] = currentProtocolVersion
    try {
      const timeout = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
      try {
        const response = await fetchImpl(url, {
          method: 'DELETE',
          headers: mergeHeaders(baseHeaders, { ...extraHeaders, 'Mcp-Session-Id': currentSessionId }),
          signal: timeout.signal,
          redirect: 'manual',
        })
        await response.text().catch(() => '')
      } finally {
        // The timer must be released on every path, including the failing one:
        // a timer that outlives the request keeps the event loop alive.
        timeout.dispose()
      }
    } catch {
      // Terminating the session is best effort: the server may not support DELETE.
    }
    currentSessionId = undefined
  }

  return {
    url,
    get sessionId() {
      return currentSessionId
    },
    set sessionId(value) {
      currentSessionId = typeof value === 'string' && value.length > 0 ? value : undefined
    },
    get protocolVersion() {
      return currentProtocolVersion
    },
    set protocolVersion(value) {
      currentProtocolVersion = typeof value === 'string' && value.length > 0 ? value : undefined
    },
    get closed() {
      return closed
    },
    send,
    close,
  }
}
