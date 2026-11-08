/**
 * MCP session: the JSON-RPC lifecycle of one MCP server.
 *
 * A session owns the handshake (`initialize` → `notifications/initialized`),
 * the session identifier the server assigned and the protocol version that
 * was negotiated. Business requests go through `request()`.
 *
 * Two failure modes are handled here (see DESIGN.md §6.4):
 *
 * * `404` — the server forgot the session. The session identifier is dropped
 *   and the handshake is performed again exactly once. The failed business
 *   request is **not** replayed: the original failure is rethrown so the
 *   caller can decide what to do.
 * * `401` — the access token was rejected. The failure is passed through
 *   untouched; the refresh-and-replay logic lives in the fetch layer
 *   (`lib/mcp/auth-fetch.js`).
 *
 * @module dsh-oauth-mcp/mcp/session
 */

import { ERROR_CODES, McpError, McpForbiddenError, McpUnauthorizedError } from '../oauth/errors.js'
import { redactText } from '../util/redact.js'
import { createMcpTransport } from './transport.js'
import { PLUGIN_ID, PLUGIN_VERSION } from '../build-info.js'

/** Protocol version used when the caller does not request one. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

/** Protocol versions this client is able to fall back to. */
export const KNOWN_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26'])

/** Default timeout of a single MCP request, in milliseconds. */
export const DEFAULT_SESSION_TIMEOUT_MS = 60_000

/** JSON-RPC error code the MCP specification reserves for "unauthorized". */
const JSONRPC_UNAUTHORIZED = -32001

/** JSON-RPC error code the MCP specification reserves for "resource not found". */
const JSONRPC_RESOURCE_NOT_FOUND = -32002

/**
 * Report whether a failure describes a protocol-version mismatch.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} Whether the server rejected the negotiated protocol version.
 */
function isProtocolVersionMismatch(error) {
  if (!(error instanceof McpError)) return false
  const haystack = `${error.message ?? ''} ${error.detail ?? ''}`
  return /protocol[\s_-]?version/i.test(haystack)
}

/**
 * Report whether a failure describes an expired MCP session.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} Whether the server answered `404`.
 */
function isSessionExpired(error) {
  return error instanceof McpError && error.status === 404
}

/**
 * Convert a JSON-RPC error object into the matching error class.
 *
 * @param {{ code?: number, message?: string, data?: unknown }} payload The JSON-RPC error.
 * @returns {McpError} The error to throw.
 */
function toMcpError(payload) {
  const code = typeof payload?.code === 'number' ? payload.code : undefined
  const message = typeof payload?.message === 'string' ? payload.message : 'The MCP server reported an error.'
  const detail = redactText(
    typeof payload?.data === 'string' ? payload.data : payload?.data === undefined ? '' : JSON.stringify(payload.data),
  )
  if (code === JSONRPC_UNAUTHORIZED) {
    return new McpUnauthorizedError(message, { detail })
  }
  if (code === JSONRPC_RESOURCE_NOT_FOUND) {
    return new McpError(message, { detail, code: ERROR_CODES.server_not_found })
  }
  if (/forbidden|not permitted|insufficient scope/i.test(message)) {
    return new McpForbiddenError(message, { detail })
  }
  return new McpError(message, { detail })
}

/**
 * Assign a value to a transport property, ignoring transports that do not
 * expose a setter for it.
 *
 * @param {object} transport The transport.
 * @param {string} key The property name.
 * @param {unknown} value The value to assign.
 * @returns {void}
 */
function assignQuietly(transport, key, value) {
  try {
    transport[key] = value
  } catch {
    // The transport does not allow writing this property; the session keeps its own copy.
  }
}

/**
 * Create and initialize an MCP session.
 *
 * @param {object} options Session options.
 * @param {string} [options.url] The MCP endpoint URL; used when no transport is given.
 * @param {object} [options.transport] An existing transport to use.
 * @param {object} [options.clientInfo] The client description sent with `initialize`.
 * @param {string} [options.protocolVersion] The protocol version to request.
 * @param {number} [options.timeoutMs] The default timeout of a request, in milliseconds.
 * @returns {Promise<object>} The initialized session.
 */
export async function createMcpSession(options = {}) {
  const {
    url,
    transport: providedTransport,
    clientInfo = { name: PLUGIN_ID, version: PLUGIN_VERSION },
    protocolVersion = DEFAULT_PROTOCOL_VERSION,
    timeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
  } = options

  const transport =
    providedTransport ?? createMcpTransport({ url, fetchImpl: options.fetchImpl, headers: options.headers })

  let nextRequestId = 1
  let negotiatedVersion = protocolVersion
  let serverInfo
  let closed = false

  /**
   * Build the ordered list of protocol versions to try.
   *
   * @returns {string[]} The candidate versions.
   */
  function versionCandidates() {
    const candidates = []
    if (typeof protocolVersion === 'string' && protocolVersion.length > 0) candidates.push(protocolVersion)
    for (const known of KNOWN_PROTOCOL_VERSIONS) {
      if (!candidates.includes(known)) candidates.push(known)
    }
    return candidates
  }

  /**
   * Send one JSON-RPC message and unwrap its result.
   *
   * @param {string} method The JSON-RPC method.
   * @param {unknown} params The JSON-RPC params.
   * @param {{ timeoutMs?: number, signal?: AbortSignal, id?: number }} [requestOptions] Per-call options.
   * @returns {Promise<unknown>} The `result` member of the answer.
   */
  async function sendRaw(method, params, requestOptions = {}) {
    const isNotification = requestOptions.id === undefined
    const message = isNotification
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', id: requestOptions.id, method }
    if (params !== undefined) message.params = params
    const answer = await transport.send(message, {
      timeoutMs: requestOptions.timeoutMs ?? timeoutMs,
      signal: requestOptions.signal,
    })
    const payload = answer?.response
    if (!isNotification && payload && payload.error) throw toMcpError(payload.error)
    return payload?.result
  }

  /**
   * Perform the MCP handshake.
   *
   * @returns {Promise<unknown>} The `initialize` result.
   */
  async function initialize() {
    let lastError
    for (const candidate of versionCandidates()) {
      try {
        const result = await sendRaw(
          'initialize',
          { protocolVersion: candidate, capabilities: {}, clientInfo },
          { id: nextRequestId++ },
        )
        const reported =
          result && typeof result.protocolVersion === 'string' && result.protocolVersion.length > 0
            ? result.protocolVersion
            : candidate
        negotiatedVersion = reported
        assignQuietly(transport, 'protocolVersion', reported)
        serverInfo = result?.serverInfo
        await sendRaw('notifications/initialized', {})
        return result
      } catch (error) {
        lastError = error
        if (!isProtocolVersionMismatch(error)) throw error
      }
    }
    throw (
      lastError ??
      new McpError('The MCP server rejected every supported protocol version.', {
        code: ERROR_CODES.mcp_protocol_error,
      })
    )
  }

  await initialize()

  /**
   * Call one JSON-RPC method on the server.
   *
   * A `404` answer means the server forgot the session: the session
   * identifier is dropped and the handshake is repeated once. The failed
   * request itself is never replayed — the original failure is rethrown.
   *
   * @param {string} method The JSON-RPC method, e.g. `tools/call`.
   * @param {unknown} [params] The JSON-RPC params.
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [requestOptions] Per-call options.
   * @returns {Promise<unknown>} The `result` member of the answer.
   */
  async function request(method, params, requestOptions = {}) {
    if (closed) {
      throw new McpError('The MCP session is closed.', { code: ERROR_CODES.mcp_protocol_error })
    }
    try {
      return await sendRaw(method, params, { ...requestOptions, id: nextRequestId++ })
    } catch (error) {
      if (isSessionExpired(error)) {
        assignQuietly(transport, 'sessionId', undefined)
        try {
          await initialize()
        } catch (reinitializeError) {
          if (error.cause === undefined) error.cause = reinitializeError
        }
      }
      throw error
    }
  }

  /**
   * Send a JSON-RPC notification.
   *
   * @param {string} method The JSON-RPC method.
   * @param {unknown} [params] The JSON-RRPC params.
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [requestOptions] Per-call options.
   * @returns {Promise<void>} Resolves once the notification was accepted.
   */
  async function notify(method, params, requestOptions = {}) {
    await sendRaw(method, params, requestOptions)
  }

  /**
   * Terminate the session.
   *
   * @returns {Promise<void>} Resolves once the transport was closed.
   */
  async function close() {
    closed = true
    await transport.close?.()
  }

  return {
    url: transport.url ?? url,
    clientInfo,
    get serverInfo() {
      return serverInfo
    },
    get sessionId() {
      return transport.sessionId
    },
    get protocolVersion() {
      return negotiatedVersion
    },
    get closed() {
      return closed
    },
    request,
    notify,
    close,
  }
}
