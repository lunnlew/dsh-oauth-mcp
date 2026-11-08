/**
 * Registry that mirrors the remote MCP tools into the host tool service.
 *
 * The plugin must not collide with the host's own MCP client, which names its
 * tools `mcp__<server>__<tool>`. This registry therefore prefixes every name
 * with the configurable `toolPrefix` (default `mcp_oauth`), so the public name
 * of a remote tool is `mcp_oauth__<serverId>__<remoteToolName>`.
 *
 * The registry keeps a live view of every server it manages: `sync()` adds the
 * tools a server currently offers, replaces the ones whose definition changed
 * and unregisters the ones that disappeared — no stale registration is ever
 * left behind.
 *
 * @module dsh-oauth-mcp/mcp/tool-registry
 */

import { redactText } from '../util/redact.js'

/** Default prefix of every public tool name of this plugin. */
export const DEFAULT_TOOL_PREFIX = 'mcp_oauth'

/** Default timeout of one remote tool call, in milliseconds. */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/** JSON Schema of the value a registered tool resolves with. */
export const TOOL_OUTPUT_SCHEMA = Object.freeze({
  type: 'array',
  description: 'The content blocks returned by the remote MCP tool.',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'The block type, for example "text".' },
      text: { type: 'string', description: 'The textual content of the block.' },
    },
    required: ['type'],
  },
})

/**
 * Normalize a tool name.
 *
 * Every character outside `[a-z0-9_-]` becomes `_` and the name is
 * lower-cased, so the result is stable across servers and platforms.
 *
 * @param {string} value The raw name.
 * @returns {string} The normalized name.
 */
function normalizeToolName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
}

/**
 * Extract the content blocks of a remote tool result.
 *
 * @param {unknown} value The value the executor resolved with.
 * @returns {unknown[]} The content blocks, empty when the value carries none.
 */
function toContentBlocks(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value.content
  if (value === undefined || value === null) return []
  return [{ type: 'text', text: String(value) }]
}

/**
 * Describe the media type of an image block.
 *
 * @param {unknown} mimeType The media type reported by the server.
 * @returns {string} The media type, or a placeholder.
 */
function describeMediaType(mimeType) {
  if (typeof mimeType === 'string' && mimeType.length > 0) return mimeType
  if (mimeType && typeof mimeType === 'object' && typeof mimeType.type === 'string') return mimeType.type
  return 'unknown'
}

/**
 * Build the public description of a registered tool.
 *
 * The description tells the model when the tool applies and what to do when
 * the call fails.
 *
 * @param {string} serverId The MCP server the tool belongs to.
 * @param {string} remoteToolName The name of the remote tool.
 * @param {string} [remoteDescription] The description the server reported.
 * @returns {string} The public description.
 */
function buildDescription(serverId, remoteToolName, remoteDescription) {
  const summary =
    typeof remoteDescription === 'string' && remoteDescription.trim().length > 0
      ? remoteDescription.trim()
      : `The "${remoteToolName}" tool of the MCP server "${serverId}".`
  return [
    `[${serverId}] ${remoteToolName} — ${summary}`,
    `Use it when the task needs the "${remoteToolName}" capability of the MCP server "${serverId}".`,
    'If the call fails, report the error to the user instead of retrying it unchanged.',
  ].join(' ')
}

/**
 * Create the registry that mirrors remote MCP tools into the host.
 *
 * @param {object} options Registry options.
 * @param {object} options.tools The host tool service (`ctx.tools`).
 * @param {string} [options.toolPrefix] The prefix of every public tool name.
 * @param {object} [options.logger] The host logger; every call is optional.
 * @param {(serverId: string, remoteToolName: string, args: object, callOptions: { timeoutMs?: number, signal?: AbortSignal }) => Promise<unknown>} [options.callTool] The injected executor that performs `tools/call`.
 * @param {number} [options.timeoutMs] The timeout of one tool call, in milliseconds.
 * @returns {object} The registry: `sync`, `unregisterServer`, `dispose`, `hostToolName`.
 */
export function createToolRegistry(options = {}) {
  const { tools, logger, callTool } = options
  const toolPrefix = typeof options.toolPrefix === 'string' && options.toolPrefix.length > 0
    ? options.toolPrefix
    : DEFAULT_TOOL_PREFIX
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS

  if (!tools || typeof tools.register !== 'function') {
    throw new TypeError('createToolRegistry requires the host tool service.')
  }

  /** Registrations per server: `serverId` → `remoteToolName` → registration. */
  const registrations = new Map()
  /** Public name → the registration that owns it. */
  const owners = new Map()

  /**
   * Log a warning through the host logger, when there is one.
   *
   * @param {string} message The message.
   * @param {unknown} [detail] Extra detail.
   * @returns {void}
   */
  function warn(message, detail) {
    try {
      logger?.warn?.(message, detail)
    } catch {
      // A failing logger must not break the registry.
    }
  }

  /**
   * Log an error through the host logger, when there is one.
   *
   * @param {string} message The message.
   * @param {unknown} [detail] Extra detail.
   * @returns {void}
   */
  function error(message, detail) {
    try {
      logger?.error?.(message, detail)
    } catch {
      // A failing logger must not break the registry.
    }
  }

  /**
   * Build the public name of a remote tool.
   *
   * @param {string} serverId The MCP server identifier.
   * @param {string} remoteToolName The name of the remote tool.
   * @returns {string} The public tool name.
   */
  function hostToolName(serverId, remoteToolName) {
    return normalizeToolName(`${toolPrefix}__${serverId}__${remoteToolName}`)
  }

  /**
   * Dispose one registration and forget it.
   *
   * @param {string} serverId The MCP server identifier.
   * @param {string} remoteToolName The name of the remote tool.
   * @returns {void}
   */
  function release(serverId, remoteToolName) {
    const server = registrations.get(serverId)
    if (!server) return
    const registration = server.get(remoteToolName)
    if (!registration) return
    server.delete(remoteToolName)
    if (server.size === 0) registrations.delete(serverId)
    if (owners.get(registration.name) === registration) owners.delete(registration.name)
    try {
      registration.dispose?.()
    } catch (disposeError) {
      error(`dsh-oauth-mcp: failed to unregister the tool "${registration.name}".`, disposeError)
    }
  }

  /**
   * Register one remote tool with the host.
   *
   * @param {string} serverId The MCP server identifier.
   * @param {object} remoteTool The remote tool descriptor.
   * @returns {void}
   */
  function register(serverId, remoteTool) {
    const remoteToolName = String(remoteTool?.name ?? '')
    if (remoteToolName.length === 0) {
      warn('dsh-oauth-mcp: skipped a remote tool without a name.')
      return
    }
    const name = hostToolName(serverId, remoteToolName)
    const owner = owners.get(name)
    if (owner && !(owner.serverId === serverId && owner.remoteToolName === remoteToolName)) {
      warn(
        `dsh-oauth-mcp: skipped the tool "${name}" of "${serverId}" because the name is already taken.`,
      )
      return
    }

    const parameters =
      remoteTool?.inputSchema && typeof remoteTool.inputSchema === 'object'
        ? structuredCloneSafe(remoteTool.inputSchema)
        : { type: 'object', properties: {} }
    const isConcurrencySafe = remoteTool?.annotations?.readOnlyHint === true

    const definition = {
      name,
      description: buildDescription(serverId, remoteToolName, remoteTool?.description),
      parameters,
      output: { schema: TOOL_OUTPUT_SCHEMA, render: renderContentBlocks },
      execute: async (args, exec) => {
        if (typeof callTool !== 'function') {
          return [
            {
              type: 'text',
              text: `The MCP executor is not available, so the tool "${remoteToolName}" of "${serverId}" could not be called.`,
            },
          ]
        }
        return callTool(serverId, remoteToolName, args ?? {}, { timeoutMs, signal: exec?.signal })
      },
      timeoutMs,
      isConcurrencySafe,
    }

    let disposer
    try {
      disposer = tools.register(definition)
    } catch (registerError) {
      error(`dsh-oauth-mcp: the host refused the tool "${name}".`, registerError)
      return
    }

    const registration = {
      name,
      serverId,
      remoteToolName,
      fingerprint: fingerprintOf(remoteTool),
      dispose: typeof disposer === 'function' ? disposer : () => {},
    }
    let server = registrations.get(serverId)
    if (!server) {
      server = new Map()
      registrations.set(serverId, server)
    }
    server.set(remoteToolName, registration)
    owners.set(name, registration)
  }

  /**
   * Mirror the tools of one MCP server into the host.
   *
   * @param {string} serverId The MCP server identifier.
   * @param {object[]} remoteTools The descriptors the server reported.
   * @returns {Promise<void>} Resolves once the host view matches the server.
   */
  async function sync(serverId, remoteTools) {
    const list = Array.isArray(remoteTools)
      ? remoteTools
      : Array.isArray(remoteTools?.tools)
        ? remoteTools.tools
        : []
    const server = registrations.get(serverId)
    const wanted = new Map()
    for (const remoteTool of list) {
      const remoteToolName = String(remoteTool?.name ?? '')
      if (remoteToolName.length === 0) continue
      wanted.set(remoteToolName, remoteTool)
    }

    if (server) {
      for (const remoteToolName of [...server.keys()]) {
        const registration = server.get(remoteToolName)
        const remoteTool = wanted.get(remoteToolName)
        const unchanged =
          remoteTool !== undefined &&
          registration.fingerprint === fingerprintOf(remoteTool) &&
          registration.name === hostToolName(serverId, remoteToolName)
        if (unchanged) {
          wanted.delete(remoteToolName)
          continue
        }
        release(serverId, remoteToolName)
      }
    }

    for (const [remoteToolName, remoteTool] of wanted) {
      register(serverId, remoteTool)
    }
  }

  /**
   * Unregister every tool of one MCP server.
   *
   * @param {string} serverId The MCP server identifier.
   * @returns {void}
   */
  function unregisterServer(serverId) {
    const server = registrations.get(serverId)
    if (!server) return
    for (const remoteToolName of [...server.keys()]) {
      release(serverId, remoteToolName)
    }
    registrations.delete(serverId)
  }

  /**
   * Unregister every tool of every server.
   *
   * @returns {void}
   */
  function dispose() {
    for (const serverId of [...registrations.keys()]) {
      unregisterServer(serverId)
    }
    owners.clear()
  }

  /**
   * The public names of the tools one server currently owns.
   *
   * The names are what the user and the agent call, so they are the handle to
   * quote when somebody asks "which tools did the authorization bring in?".
   *
   * @param {string} serverId The MCP server identifier.
   * @returns {string[]} The public tool names, sorted.
   */
  function hostToolNames(serverId) {
    const server = registrations.get(serverId)
    if (!server) return []
    return [...server.values()].map((registration) => registration.name).sort()
  }

  return {
    toolPrefix,
    sync,
    unregisterServer,
    dispose,
    hostToolName,
    hostToolNames,
    /** The public names this registry currently owns. */
    listToolNames() {
      return [...owners.keys()]
    },
  }
}

/**
 * Clone a JSON Schema without relying on `structuredClone` being present.
 *
 * @param {unknown} value The value to clone.
 * @returns {unknown} The cloned value.
 */
function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // Fall through to the JSON clone below.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

/**
 * Build a comparable fingerprint of a remote tool descriptor.
 *
 * @param {object} remoteTool The descriptor.
 * @returns {string} The fingerprint.
 */
function fingerprintOf(remoteTool) {
  try {
    return JSON.stringify({
      name: remoteTool?.name ?? null,
      description: remoteTool?.description ?? null,
      inputSchema: remoteTool?.inputSchema ?? null,
      annotations: remoteTool?.annotations ?? null,
    })
  } catch {
    return String(remoteTool?.name ?? '')
  }
}

/**
 * Map the content blocks of a remote tool result to host content blocks.
 *
 * A `text` block becomes a host text block, an `image` block becomes a
 * diagnostic text block naming the media type (this plugin never uploads
 * images) and every other block type becomes a diagnostic text block naming
 * the type.
 *
 * @param {unknown} args The arguments the tool was called with.
 * @param {unknown} value The value the tool resolved with.
 * @returns {{ type: 'text', text: string }[]} The host content blocks.
 */
export function renderContentBlocks(args, value) {
  void args
  return toContentBlocks(value).map((block) => {
    const type = block && typeof block === 'object' ? block.type : undefined
    if (type === 'text') {
      const text = typeof block.text === 'string' ? block.text : ''
      return { type: 'text', text: redactText(text) }
    }
    if (type === 'image') {
      return {
        type: 'text',
        text: `[image omitted: the remote tool returned ${describeMediaType(block.mimeType ?? block.mediaType)}]`,
      }
    }
    return {
      type: 'text',
      text: `[unsupported content block: ${typeof type === 'string' && type.length > 0 ? type : 'unknown'}]`,
    }
  })
}
