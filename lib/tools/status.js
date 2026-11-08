/**
 * The `dsh_oauth_mcp_status` agent tool.
 *
 * The tool is read-only: it reports what the plugin knows about the
 * authorization state of the configured MCP servers. It never returns a token,
 * not even a prefix, and it never changes anything.
 *
 * @module dsh-oauth-mcp/tools/status
 */

import { OAuthError, ERROR_CODES, describeError } from '../oauth/errors.js'
import { describeErrorCode } from '../errors-messages.js'
import { renderScopeDetails, renderStatusTable, sortStatusRows } from '../view-model.js'
import { buildLine, buildTag } from '../build-info.js'
import { createTranslator, resolveLocale } from '../i18n/index.js'

/** The wire name of the tool. */
export const STATUS_TOOL_NAME = 'dsh_oauth_mcp_status'

/** JSON Schema of the value the tool resolves with. */
const STATUS_OUTPUT_SCHEMA = Object.freeze({
  type: 'array',
  description: 'The authorization status of the configured MCP servers, ordered by server id.',
  items: {
    type: 'object',
    properties: {
      serverId: { type: 'string', description: 'The identifier of the configured MCP server.' },
      label: { type: 'string', description: 'The human readable label of the server.' },
      authorized: { type: 'boolean', description: 'Whether a usable grant is stored.' },
      expiresAt: { type: 'number', description: 'Absolute expiry of the access token.' },
      hasRefreshToken: { type: 'boolean', description: 'Whether the stored grant can be refreshed.' },
      needsReauthorization: { type: 'boolean', description: 'Whether the user has to authorize again.' },
      connected: { type: 'boolean', description: 'Whether the MCP session is established.' },
      toolCount: { type: 'number', description: 'Number of tools the server currently exposes.' },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The public names of the tools the server exposes right now, for example "mcp_oauth__notion__search". Call a tool by that name.',
      },
      scopes: { type: 'array', items: { type: 'string' }, description: 'The granted scopes.' },
      lastError: { type: 'string', description: 'The last failure of that server, never a secret.' },
      credentialService: {
        type: 'string',
        enum: ['ready', 'missing', 'unknown'],
        description:
          'Whether the host exposes the credential service the plugin needs to store a grant. "missing" means the plugin cannot store tokens at all.',
      },
    },
    required: [
      'serverId',
      'label',
      'authorized',
      'hasRefreshToken',
      'needsReauthorization',
      'connected',
      'toolCount',
      'scopes',
    ],
  },
})

/**
 * Turn an arbitrary failure into an error the host can show.
 *
 * @param {unknown} error The thrown value.
 * @param {string} locale The locale of the message.
 * @returns {OAuthError} The error to throw.
 */
function toToolError(error, locale) {
  if (error instanceof OAuthError) {
    const message = describeErrorCode(error.code, locale)
    return new OAuthError(error.code, `${message} [${error.code}]`, {
      status: error.status,
      detail: error.detail,
      cause: error,
    })
  }
  const described = describeError(error)
  const message = describeErrorCode(described.code, locale)
  return new OAuthError(described.code, `${message} [${described.code}]`, { cause: error })
}

/**
 * Project one status row onto the fields the tool publishes.
 *
 * The projection is a whitelist: a field that the service adds later can never
 * reach the model by accident, and a token could never travel with a row.
 *
 * @param {object} row The status row of the service.
 * @returns {object} The published row.
 */
function projectRow(row) {
  const projected = {
    serverId: String(row?.serverId ?? ''),
    label: String(row?.label ?? ''),
    authorized: row?.authorized === true,
    hasRefreshToken: row?.hasRefreshToken === true,
    needsReauthorization: row?.needsReauthorization === true,
    connected: row?.connected === true,
    toolCount: typeof row?.toolCount === 'number' ? row.toolCount : 0,
    tools: Array.isArray(row?.tools) ? row.tools.map((name) => String(name)) : [],
    scopes: Array.isArray(row?.scopes) ? row.scopes.map((scope) => String(scope)) : [],
  }
  if (typeof row?.expiresAt === 'number') projected.expiresAt = row.expiresAt
  if (typeof row?.lastError === 'string' && row.lastError.length > 0) projected.lastError = row.lastError
  if (row?.credentialService === 'ready' || row?.credentialService === 'missing') {
    projected.credentialService = row.credentialService
  }
  return projected
}

/**
 * Create the `dsh_oauth_mcp_status` tool.
 *
 * @param {object} options Collaborators.
 * @param {object} options.service The `oauthMcp` host service.
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.logger] Diagnostic logger.
 * @param {object} [options.settings] The host settings service, used to read the language of the interface.
 * @param {object} [options.config] The plugin configuration, used to read the locale the client half wrote.
 * @returns {object} The tool definition.
 */
export function createStatusTool(options = {}) {
  const { service, logger, settings, config } = options

  /**
   * Resolve the language of one answer.
   *
   * The language is resolved on every call and not once at start-up: a change
   * in the settings takes effect on the next answer, and one answer never
   * mixes two languages.
   *
   * @returns {{ locale: string, t: (key: string, params?: Record<string, unknown>) => string }} The language and its translator.
   */
  function language() {
    const locale = resolveLocale({ settings, config })
    return { locale, t: createTranslator(locale) }
  }

  /**
   * Render the tool result.
   *
   * @param {object} args The tool arguments.
   * @param {object[]} value The tool result.
   * @returns {{ type: 'text', text: string }[]} The content blocks.
   */
  function render(args, value) {
    const { locale, t } = language()
    const rows = Array.isArray(value) ? value : []
    if (rows.length === 0) {
      return [{ type: 'text', text: `${buildLine(locale)}\n${t('server.table.empty')}` }]
    }
    const lines = [buildLine(locale), renderStatusTable(rows, t)]
    const scopes = renderScopeDetails(rows, t)
    if (scopes.length > 0) {
      lines.push('')
      lines.push(scopes)
    }
    const withTools = rows.filter((row) => Array.isArray(row?.tools) && row.tools.length > 0)
    if (withTools.length > 0) {
      lines.push(t('server.tool.status.tools'))
      for (const row of withTools) {
        lines.push(t('server.tool.status.tools.line', { label: row.label, tools: row.tools.join(', ') }))
      }
    }
    const pending = rows.filter((row) => row?.needsReauthorization).map((row) => row.serverId)
    if (pending.length > 0) {
      lines.push(t('server.tool.status.pending', { servers: pending.join(', ') }))
    }
    if (rows.some((row) => row?.credentialService === 'missing')) {
      lines.push(t('server.tool.status.credentials'))
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }

  /**
   * Run the tool.
   *
   * @param {{ serverId?: string }} args The tool arguments.
   * @returns {Promise<object[]>} The status rows.
   */
  async function execute(args = {}) {
    const { locale, t } = language()
    const serverId = typeof args?.serverId === 'string' ? args.serverId.trim() : ''
    let rows
    try {
      rows = await service.status(serverId || undefined)
    } catch (error) {
      throw toToolError(error, locale)
    }
    if (serverId && (!Array.isArray(rows) || rows.length === 0)) {
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        `${t('server.error.unknown_server', { serverId })} ${buildTag(locale)}`,
      )
    }
    const projected = sortStatusRows(Array.isArray(rows) ? rows : []).map(projectRow)
    logger?.info?.('dsh-oauth-mcp: the agent read the authorization status', {
      serverId: serverId || undefined,
      servers: projected.length,
    })
    return projected
  }

  return {
    name: STATUS_TOOL_NAME,
    description:
      'Report the authorization state of the configured MCP servers: which one is authorized, when the access token expires, whether it can be refreshed, whether the session is connected, and which tools the server exposes right now (by their callable names).\n' +
      'Use it to find out whether a server can be used before calling its tools, to find out which server needs a new authorization, and to look up the exact name of a mirrored tool.\n' +
      'Do not use it to start an authorization (dsh_oauth_mcp_authorize does that) or to change the server list.\n' +
      'Pass serverId to report a single server; omit it to report every configured server. The report never contains an access token.',
    parameters: {
      type: 'object',
      properties: {
        serverId: {
          type: 'string',
          description: 'The id of one configured MCP server. Omit it to report every server.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: { schema: STATUS_OUTPUT_SCHEMA, render },
    execute,
    timeoutMs: 30_000,
    isConcurrencySafe: true,
  }
}
