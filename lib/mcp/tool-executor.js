/**
 * Executor that turns remote MCP tool calls into host tool results.
 *
 * The executor is the bridge between the host tool registry and one MCP
 * session: `tools/call` becomes the content blocks the host renders, and
 * `tools/list` becomes the tool descriptors the registry mirrors.
 *
 * @module dsh-oauth-mcp/mcp/tool-executor
 */

import { ERROR_CODES, McpError } from '../oauth/errors.js'

/** Default timeout of one MCP request, in milliseconds. */
export const DEFAULT_EXECUTOR_TIMEOUT_MS = 60_000

/** How many `tools/list` pages are read before the listing is cut short. */
export const MAX_LIST_PAGES = 20

/**
 * Extract the content blocks of a `tools/call` result.
 *
 * @param {unknown} result The JSON-RPC result.
 * @returns {unknown[]} The content blocks, empty when the result carries none.
 */
function toContentBlocks(result) {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object' && Array.isArray(result.content)) return result.content
  return []
}

/**
 * Create the executor of remote MCP tools.
 *
 * @param {object} options Executor options.
 * @param {object} options.session The MCP session, a map of sessions per server or a factory that returns one.
 * @param {number} [options.timeoutMs] The default timeout of one request, in milliseconds.
 * @returns {{ callTool: Function, listTools: Function }} The executor.
 */
export function createToolExecutor(options = {}) {
  const { session } = options
  const defaultTimeoutMs =
    typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_EXECUTOR_TIMEOUT_MS

  /**
   * Resolve the session that serves one MCP server.
   *
   * @param {string} serverId The MCP server identifier.
   * @returns {{ request: Function }} The session.
   */
  function resolveSession(serverId) {
    let candidate = session
    if (typeof candidate === 'function') {
      candidate = candidate(serverId)
    } else if (candidate && typeof candidate.get === 'function' && typeof candidate.request !== 'function') {
      candidate = candidate.get(serverId)
    }
    if (!candidate || typeof candidate.request !== 'function') {
      throw new McpError(`No MCP session is available for the server "${serverId}".`, {
        code: ERROR_CODES.server_not_found,
      })
    }
    return candidate
  }

  /**
   * Call a remote MCP tool.
   *
   * @param {string} serverId The MCP server identifier.
   * @param {string} remoteToolName The name of the remote tool.
   * @param {object} [args] The arguments of the call.
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [callOptions] Per-call options.
   * @returns {Promise<unknown[]>} The content blocks the remote tool returned.
   */
  async function callTool(serverId, remoteToolName, args, callOptions = {}) {
    const active = resolveSession(serverId)
    const timeoutMs = typeof callOptions.timeoutMs === 'number' ? callOptions.timeoutMs : defaultTimeoutMs
    const result = await active.request(
      'tools/call',
      { name: remoteToolName, arguments: args ?? {} },
      { timeoutMs, signal: callOptions.signal },
    )
    return toContentBlocks(result)
  }

  /**
   * List the tools of an MCP server.
   *
   * @param {string} serverId The MCP server identifier.
   * @returns {Promise<object[]>} The remote tool descriptors.
   */
  async function listTools(serverId) {
    const active = resolveSession(serverId)
    const descriptors = []
    let cursor
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await active.request(
        'tools/list',
        cursor ? { cursor } : {},
        { timeoutMs: defaultTimeoutMs },
      )
      const list = Array.isArray(result?.tools) ? result.tools : []
      descriptors.push(...list)
      cursor =
        typeof result?.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
      if (!cursor) break
    }
    return descriptors
  }

  return { callTool, listTools }
}
