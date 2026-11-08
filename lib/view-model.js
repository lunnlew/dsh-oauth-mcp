/**
 * The view models of the plugin.
 *
 * A view model is the only shape that leaves the host side of this plugin: the
 * agent tools, the host command and the client settings page read views, never
 * the raw grant. That keeps the access token, the refresh token and the client
 * secret out of every rendering path by construction — a view has no field that
 * could carry one.
 *
 * The module is pure: it takes a configured server and its runtime state and
 * returns plain data. It performs no network access and touches no service.
 *
 * @module dsh-oauth-mcp/view-model
 */

import { hasRefreshToken, isExpired, parseScope } from './oauth/types.js'
import { truncateDetail } from './oauth/errors.js'
import { redactText } from './util/redact.js'
import { displayWidth, padEndWidth } from './util/width.js'
import { createTranslator } from './i18n/index.js'

/**
 * @typedef {object} OAuthMcpServerView
 * @property {string} id Server identifier.
 * @property {string} label Human readable label.
 * @property {string} url MCP server endpoint.
 * @property {boolean} enabled Whether the server is enabled.
 * @property {string[]} scopes Configured scopes.
 * @property {boolean} authorized Whether a usable grant is stored.
 * @property {number} [expiresAt] Absolute expiry of the access token.
 * @property {boolean} hasRefreshToken Whether a refresh token is stored.
 * @property {boolean} needsReauthorization Whether the user must authorize again.
 * @property {boolean} connected Whether the MCP session is established.
 * @property {number} toolCount Number of tools the server currently exposes.
 * @property {string} [lastError] Last failure, never a secret.
 * @property {string} [callbackMode] Callback mode in use.
 */

/**
 * @typedef {object} OAuthMcpAuthStatus
 * @property {string} serverId Server identifier.
 * @property {string} label Human readable label.
 * @property {boolean} authorized Whether a usable grant is stored.
 * @property {number} [expiresAt] Absolute expiry of the access token.
 * @property {boolean} hasRefreshToken Whether a refresh token is stored.
 * @property {boolean} needsReauthorization Whether the user must authorize again.
 * @property {boolean} connected Whether the MCP session is established.
 * @property {number} toolCount Number of tools the server currently exposes.
 * @property {string[]} scopes Granted scopes.
 * @property {string} [lastError] Last failure, never a secret.
 */

/**
 * @typedef {object} ServerRuntimeState
 * @property {object} [server] The configured server.
 * @property {object} [grant] The stored grant payload.
 * @property {object} [session] The live MCP session, when one exists.
 * @property {number} [toolCount] Number of tools the connection exposes.
 * @property {string} [lastError] Last failure of the connection.
 * @property {string} [callbackMode] Callback mode in use.
 */

/**
 * Turn an arbitrary value into a short, secret-free line of text.
 *
 * @param {unknown} value The raw value.
 * @returns {string | undefined} The text, or `undefined` when there is nothing to show.
 */
function readErrorText(value) {
  if (value === undefined || value === null || value === '') return undefined
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value)
  const text = truncateDetail(redactText(raw)).trim()
  return text.length > 0 ? text : undefined
}

/**
 * Read the authorization facts of a stored grant.
 *
 * @param {object | undefined} grant The stored grant payload.
 * @returns {{ authorized: boolean, expired: boolean, hasRefreshToken: boolean, expiresAt: number | undefined, lastError: string | undefined }} The facts.
 */
function readGrantState(grant) {
  const authorized = typeof grant?.accessToken === 'string' && grant.accessToken.length > 0
  const expired = authorized && isExpired(grant)
  const expiresAt = typeof grant?.expiresAt === 'number' ? grant.expiresAt : undefined
  return {
    authorized,
    expired,
    hasRefreshToken: hasRefreshToken(grant),
    expiresAt,
    lastError: readErrorText(grant?.lastError),
  }
}

/**
 * Read the connection facts of a live MCP session.
 *
 * @param {object | undefined} session The MCP session.
 * @returns {{ connected: boolean, toolCount: number, lastError: string | undefined }} The facts.
 */
function readSessionState(session) {
  if (!session || typeof session !== 'object') {
    return { connected: false, toolCount: 0, lastError: undefined }
  }
  const closed = session.closed === true
  const connected = typeof session.connected === 'boolean' ? session.connected && !closed : !closed
  const toolCount =
    typeof session.toolCount === 'number'
      ? session.toolCount
      : Array.isArray(session.tools)
        ? session.tools.length
        : 0
  return { connected, toolCount, lastError: readErrorText(session.lastError ?? session.error) }
}

/**
 * Read the public names of the tools one server exposes.
 *
 * The names come from the host registry, so they are exactly the names the
 * user can call and the agent can pick.
 *
 * @param {object} [state] The runtime state of that server.
 * @returns {string[]} The public tool names.
 */
function readToolNames(state) {
  const candidates = [state?.toolNames, state?.session?.toolNames, state?.session?.tools]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const names = candidate.filter((name) => typeof name === 'string' && name.length > 0)
    if (names.length > 0) return names
  }
  return []
}

/**
 * Read the identifier of a configured server.
 *
 * @param {object} server The configured server.
 * @returns {string} The identifier.
 */
function readServerId(server) {
  return typeof server?.id === 'string' ? server.id : ''
}

/**
 * Read the label of a configured server, falling back to its identifier.
 *
 * @param {object} server The configured server.
 * @returns {string} The label.
 */
function readServerLabel(server) {
  if (typeof server?.label === 'string' && server.label.trim().length > 0) return server.label
  return readServerId(server)
}

/**
 * Report whether the user has to authorize the server again.
 *
 * A missing grant always needs a new authorization. An expired grant needs one
 * too, unless it carries a refresh token: the plugin can then renew the access
 * token on its own.
 *
 * @param {{ authorized: boolean, expired: boolean, hasRefreshToken: boolean }} grantState The grant facts.
 * @returns {boolean} Whether a new authorization is required.
 */
function needsReauthorization(grantState) {
  if (!grantState.authorized) return true
  return grantState.expired && !grantState.hasRefreshToken
}

/**
 * Convert a configured server and its runtime state into the server view.
 *
 * @param {object} server The configured server.
 * @param {ServerRuntimeState} [state] The runtime state of that server.
 * @returns {OAuthMcpServerView} The view.
 */
export function toServerView(server, state = {}) {
  const grantState = readGrantState(state?.grant)
  const sessionState = readSessionState(state?.session)
  const toolCount =
    typeof state?.toolCount === 'number' && Number.isFinite(state.toolCount)
      ? state.toolCount
      : sessionState.toolCount
  const lastError = sessionState.lastError ?? grantState.lastError ?? readErrorText(state?.lastError)
  const callbackMode =
    typeof state?.callbackMode === 'string' && state.callbackMode.length > 0
      ? state.callbackMode
      : typeof server?.callbackMode === 'string' && server.callbackMode.length > 0
        ? server.callbackMode
        : undefined

  const view = {
    id: readServerId(server),
    label: readServerLabel(server),
    url: typeof server?.url === 'string' ? server.url : '',
    enabled: server?.enabled !== false,
    scopes: parseScope(server?.scopes),
    authorized: grantState.authorized,
    hasRefreshToken: grantState.hasRefreshToken,
    needsReauthorization: needsReauthorization(grantState),
    connected: sessionState.connected,
    toolCount,
  }
  if (grantState.expiresAt !== undefined) view.expiresAt = grantState.expiresAt
  if (lastError !== undefined) view.lastError = lastError
  if (callbackMode !== undefined) view.callbackMode = callbackMode
  return view
}

/**
 * Convert a configured server and its runtime state into a status row.
 *
 * The status row reports the granted scopes of the stored grant; a server that
 * was never authorized reports the scopes the plugin would ask for.
 *
 * @param {object} server The configured server.
 * @param {ServerRuntimeState} [state] The runtime state of that server.
 * @returns {OAuthMcpAuthStatus} The status row.
 */
export function toStatusRow(server, state = {}) {
  const grantState = readGrantState(state?.grant)
  const sessionState = readSessionState(state?.session)
  const toolCount =
    typeof state?.toolCount === 'number' && Number.isFinite(state.toolCount)
      ? state.toolCount
      : sessionState.toolCount
  const grantedScopes = parseScope(state?.grant?.scopes)
  const scopes = grantedScopes.length > 0 ? grantedScopes : parseScope(server?.scopes)
  const lastError = sessionState.lastError ?? grantState.lastError ?? readErrorText(state?.lastError)

  const row = {
    serverId: readServerId(server),
    label: readServerLabel(server),
    authorized: grantState.authorized,
    hasRefreshToken: grantState.hasRefreshToken,
    needsReauthorization: needsReauthorization(grantState),
    connected: sessionState.connected,
    toolCount,
    scopes,
    tools: readToolNames(state),
  }
  if (grantState.expiresAt !== undefined) row.expiresAt = grantState.expiresAt
  if (lastError !== undefined) row.lastError = lastError
  return row
}

/**
 * Sort status rows by their server identifier.
 *
 * @param {OAuthMcpAuthStatus[]} rows The rows.
 * @returns {OAuthMcpAuthStatus[]} A new, sorted array.
 */
export function sortStatusRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) =>
    String(left?.serverId ?? '').localeCompare(String(right?.serverId ?? '')),
  )
}

/**
 * Describe the authorization state of one status row.
 *
 * @param {OAuthMcpAuthStatus} row The row.
 * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
 * @returns {string} The state.
 */
function describeState(row, t) {
  if (!row?.authorized) return t('server.state.unauthorized')
  if (row?.needsReauthorization) return t('server.state.needsReauthorization')
  return t('server.state.authorized')
}

/**
 * Format an expiry timestamp.
 *
 * The exact timestamp stays in the structured status row; the table only shows
 * how long the grant is still good, which keeps the columns narrow.
 *
 * @param {number | undefined} expiresAt The absolute expiry.
 * @param {number} [now] The current timestamp.
 * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
 * @returns {string} The short description, or a placeholder.
 */
function formatExpiry(expiresAt, now = Date.now(), t = createTranslator()) {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return '-'
  const remaining = expiresAt - now
  if (remaining <= 0) return t('server.expiry.expired')
  const minutes = Math.floor(remaining / 60_000)
  if (minutes < 60) return t('server.expiry.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return t('server.expiry.hours', { hours })
  return t('server.expiry.days', { days: Math.floor(hours / 24) })
}

/**
 * Render the status rows as a compact table.
 *
 * The table is plain text so that it can be printed by the host command, shown
 * in a tool result and read by an agent. It never contains a token. The cells
 * are padded by their display width, so a Chinese label does not push the next
 * column out of line.
 *
 * @param {OAuthMcpAuthStatus[]} rows The status rows.
 * @param {(key: string, params?: Record<string, unknown>) => string} [t] The translator of the answer.
 * @returns {string} The table.
 */
export function renderStatusTable(rows, t = createTranslator()) {
  const list = sortStatusRows(rows)
  if (list.length === 0) return t('server.table.empty')

  const header = [
    t('server.table.server'),
    t('server.table.label'),
    t('server.table.state'),
    t('server.table.expires'),
    t('server.table.scopes'),
    t('server.table.tools'),
    t('server.table.connected'),
    t('server.table.reauthorize'),
  ]
  const body = list.map((row) => [
    String(row?.serverId ?? ''),
    String(row?.label ?? ''),
    describeState(row, t),
    formatExpiry(row?.expiresAt, Date.now(), t),
    // The scopes themselves are far too long for a table cell: a vendor may
    // publish fifty of them. The cell carries the count, and the list is
    // printed below the table.
    String(Array.isArray(row?.scopes) ? row.scopes.length : 0),
    String(typeof row?.toolCount === 'number' ? row.toolCount : 0),
    row?.connected ? t('server.yes') : t('server.no'),
    row?.needsReauthorization ? t('server.yes') : t('server.no'),
  ])

  const widths = header.map((title, column) =>
    body.reduce((width, cells) => Math.max(width, displayWidth(cells[column])), displayWidth(title)),
  )
  const line = (cells) => cells.map((cell, column) => padEndWidth(cell, widths[column])).join('  ').trimEnd()

  return [line(header), ...body.map((cells) => line(cells))].join('\n')
}

/**
 * Render the scopes of every server as plain text lines.
 *
 * The table only carries the number of scopes, because a cell cannot hold a
 * list of fifty names. The list itself is printed here, one server per line.
 *
 * @param {OAuthMcpAuthStatus[]} rows The status rows.
 * @param {(key: string, params?: Record<string, unknown>) => string} [t] The translator of the answer.
 * @returns {string} The lines, or an empty string when no server has scopes.
 */
export function renderScopeDetails(rows, t = createTranslator()) {
  const list = sortStatusRows(rows).filter(
    (row) => Array.isArray(row?.scopes) && row.scopes.length > 0,
  )
  if (list.length === 0) return ''
  const lines = [t('server.table.scopeList')]
  for (const row of list) {
    lines.push(
      t('server.table.scopeLine', {
        label: String(row?.label || row?.serverId || ''),
        scopes: row.scopes.join(', '),
      }),
    )
  }
  return lines.join('\n')
}

/**
 * Render the mirrored tools of every server as plain text tables.
 *
 * The table lists the name the host registered (the name the agent calls), the
 * name the remote server uses and a short description. The cells are padded by
 * their display width, so a Chinese label does not push the next column out of
 * line.
 *
 * @param {{ serverId?: string, label?: string, connected?: boolean, authorized?: boolean, tools?: { name?: string, remoteName?: string, description?: string }[] }[]} groups The tools per server.
 * @param {(key: string, params?: Record<string, unknown>) => string} [t] The translator of the answer.
 * @returns {string} The rendered tables.
 */
export function renderToolTable(groups, t = createTranslator()) {
  const list = Array.isArray(groups) ? groups : []
  const blocks = []

  for (const group of list) {
    const tools = Array.isArray(group?.tools) ? group.tools : []
    const label = String(group?.label ?? group?.serverId ?? '')
    const state = group?.connected
      ? t('server.tooltable.state.connected')
      : group?.authorized
        ? t('server.tooltable.state.authorized')
        : t('server.tooltable.state.unauthorized')
    if (tools.length === 0) {
      blocks.push(t('server.tooltable.empty', { label, state }))
      continue
    }
    const header = [
      t('server.tooltable.tool'),
      t('server.tooltable.remote'),
      t('server.tooltable.description'),
    ]
    const body = tools.map((tool) => [
      String(tool?.name ?? ''),
      String(tool?.remoteName ?? ''),
      summarizeDescription(tool?.description),
    ])
    const widths = header.map((title, column) =>
      body.reduce((width, cells) => Math.max(width, displayWidth(cells[column])), displayWidth(title)),
    )
    const line = (cells) => cells.map((cell, column) => padEndWidth(cell, widths[column])).join('  ').trimEnd()
    blocks.push(
      [
        t('server.tooltable.caption', { label, state, count: tools.length }),
        line(header),
        ...body.map((cells) => line(cells)),
      ].join('\n'),
    )
  }

  return blocks.join('\n\n')
}

/**
 * Shorten a remote tool description to one table cell.
 *
 * @param {unknown} description The description the remote server reported.
 * @returns {string} The one line summary.
 */
function summarizeDescription(description) {
  if (typeof description !== 'string') return '-'
  const text = redactText(description.replace(/\s+/g, ' ').trim())
  if (text.length === 0) return '-'
  const limit = 72
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
