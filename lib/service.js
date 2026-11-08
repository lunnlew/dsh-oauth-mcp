/**
 * The `oauthMcp` host service.
 *
 * This is the single implementation of every OAuth operation in the plugin.
 * The agent tool, the host command and the host authorization flow are all
 * callers of the methods below; none of them re-implements a flow of its own.
 * That is the "one operation, two callers" rule: the operation lives here
 * exactly once.
 *
 * @module dsh-oauth-mcp/service
 */

import { canonicalResource } from './oauth/resource.js'
import { OAuthError, ERROR_CODES, AuthorizationTimeoutError, AuthorizationCancelledError } from './oauth/errors.js'
import { toServerView, toStatusRow } from './view-model.js'
import { readConfigArray } from './util/config.js'
import { matchProfileByEndpoint, deriveServerId, findProfile, redirectUriForProfile } from './profiles/known-profiles.js'
import { buildTag } from './build-info.js'
import { createTranslator, resolveLocale } from './i18n/index.js'

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
 * @property {string} [redirectUri] The redirect URI the callback receiver uses.
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
 * @property {'ready' | 'missing' | 'unknown'} [credentialService] Whether the host exposes the credential service.
 */

/**
 * Build the `oauthMcp` service.
 *
 * @param {object} options Collaborators.
 * @param {object} options.ctx The plugin context.
 * @param {object} options.config The validated plugin config.
 * @param {{ get(id: string): any, list(): any[], upsert(server: any): Promise<any>, remove(id: string): Promise<void> }} options.servers The server list.
 * @param {{ load(id: string): Promise<any>, save(id: string, payload: any): Promise<any>, delete(id: string): Promise<void> }} options.tokens The credential-backed token store.
 * @param {{ refreshIfNeeded(id: string): Promise<any> }} options.refresher The token refresher.
 * @param {{ start(request: any): Promise<any>, complete(request: any): Promise<any>, cancel(id: string): Promise<void> }} options.authorizer The OAuth authorizer.
 * @param {{ redirectUri: string, mode: string }} options.callback The active callback mode.
 * @param {{ get(id: string): any, connect(id: string): Promise<void>, disconnect(id: string): Promise<void> }} options.connections The MCP connection manager.
 * @param {() => 'ready' | 'missing' | 'unknown'} [options.credentialStatus] Reports whether the host exposes the credential service.
 * @param {object} [options.settings] The host settings service, used to read the language of the interface.
 * @param {{ info(...args: any[]): void, warn(...args: any[]): void, error(...args: any[]): void }} options.logger Host logger.
 * @returns {object} The service instance.
 */
export function createOauthMcpService(options) {
  const { ctx, config, servers, tokens, refresher, authorizer, callback, connections, credentialStatus, settings, logger } = options

  /**
   * Resolve the language of one answer.
   *
   * The service is asked for the language on every call and not once at
   * start-up, so a change in the settings takes effect on the next answer.
   *
   * @returns {{ locale: string, t: (key: string, params?: Record<string, unknown>) => string }} The language and its translator.
   */
  function language() {
    const locale = resolveLocale({ settings, config })
    return { locale, t: createTranslator(locale) }
  }

  /** Pending authorization requests, keyed by server id. */
  const pending = new Map()

  /** The OAuth callback carries the state but not the server id: this index resolves it. */
  const stateIndex = new Map()

  /**
   * Load the stored grant of one server.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<object | undefined>} The stored grant payload.
   */
  async function loadGrant(serverId) {
    try {
      return await tokens.load(serverId)
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: failed to read the stored grant', { serverId, error: String(error?.message ?? error) })
      return undefined
    }
  }

  /**
   * Collect the runtime state of one configured server.
   *
   * @param {object} server The configured server.
   * @returns {Promise<{ server: object, grant: object | undefined, session: unknown, toolCount: number, toolNames: string[] }>} The state.
   */
  async function buildState(server) {
    const grant = await loadGrant(server.id)
    const connection = connections?.get?.(server.id)
    return {
      server,
      grant,
      session: connection?.session,
      toolCount: connection?.toolCount ?? 0,
      toolNames: Array.isArray(connection?.toolNames) ? [...connection.toolNames] : [],
    }
  }

  /**
   * Build the view of one configured server.
   *
   * @param {object} server The configured server.
   * @returns {Promise<OAuthMcpServerView>} The view.
   */
  async function buildView(server) {
    const state = await buildState(server)
    const view = toServerView(server, state)
    if (view && typeof view === 'object') {
      view.callbackMode = callback?.mode
      // The redirect URI is plugin level, but every server has to be authorized
      // through it, so the settings page needs to see it next to the server.
      if (callback?.redirectUri) view.redirectUri = callback.redirectUri
    }
    return view
  }

  /**
   * List every configured server.
   *
   * @returns {Promise<OAuthMcpServerView[]>} The views, ordered by server id.
   */
  async function listServers() {
    const views = []
    for (const server of servers.list()) {
      views.push(await buildView(server))
    }
    return views.sort((left, right) => left.id.localeCompare(right.id))
  }

  /**
   * Describe one configured server.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<OAuthMcpServerView>} The view.
   */
  async function describeServer(serverId) {
    const server = servers.get(serverId)
    if (!server) {
      const { locale, t } = language()
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        `${t('server.error.unknown_server', { serverId })} ${buildTag(locale)}`,
      )
    }
    return buildView(server)
  }

  /**
   * Report whether the host exposes the credential service right now.
   *
   * Without that service the plugin cannot store a grant, so every other fact
   * in the status report is secondary.
   *
   * @returns {'ready' | 'missing' | 'unknown'} The credential service state.
   */
  function credentialServiceState() {
    if (typeof credentialStatus !== 'function') return 'unknown'
    try {
      const value = credentialStatus()
      return value === 'ready' || value === 'missing' ? value : 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * Report the authorization status of every server, or of one server.
   *
   * @param {string} [serverId] Restrict the report to one server.
   * @returns {Promise<OAuthMcpAuthStatus[]>} The status rows, ordered by server id.
   */
  async function status(serverId) {
    const rows = []
    const credentialService = credentialServiceState()
    for (const server of servers.list()) {
      if (serverId && server.id !== serverId) continue
      const state = await buildState(server)
      rows.push({ ...toStatusRow(server, state), credentialService })
    }
    return rows.sort((left, right) => left.serverId.localeCompare(right.serverId))
  }

  /**
   * List the tools a server currently exposes.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<{ name: string, description: string }[]>} The tool descriptors.
   */
  async function listTools(serverId) {
    const connection = connections?.get?.(serverId)
    if (!connection?.listTools) return []
    try {
      return await connection.listTools()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: failed to list the remote tools', { serverId, error: String(error?.message ?? error) })
      return []
    }
  }

  /**
   * The public names of the tools one server currently exposes.
   *
   * These are the names the host registered, so they are exactly what the user
   * can call and the agent can pick.
   *
   * @param {string} serverId Server identifier.
   * @returns {string[]} The public tool names.
   */
  function listToolNames(serverId) {
    const connection = connections?.get?.(serverId)
    if (!connection) return []
    return Array.isArray(connection.toolNames) ? [...connection.toolNames] : []
  }

  /**
   * Fail a pending authorization request.
   *
   * @param {string} serverId Server identifier.
   * @param {Error} error The failure.
   * @returns {void}
   */
  function rejectPending(serverId, error) {
    const entry = pending.get(serverId)
    if (!entry) return
    pending.delete(serverId)
    clearTimeout(entry.timer)
    entry.reject(error)
  }

  /**
   * Resolve a pending authorization request.
   *
   * @param {string} serverId Server identifier.
   * @param {object} payload The stored grant payload.
   * @returns {void}
   */
  function resolvePending(serverId, payload) {
    const entry = pending.get(serverId)
    if (!entry) return
    pending.delete(serverId)
    clearTimeout(entry.timer)
    entry.resolve(payload)
  }

  /**
   * Find an id that is not taken yet.
   *
   * @param {string} base The wanted id.
   * @returns {string} The id, with a numeric suffix when the base is taken.
   */
  function uniqueServerId(base) {
    if (!servers.get(base)) return base
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base}-${index}`
      if (!servers.get(candidate)) return candidate
    }
    return `${base}-${Date.now()}`
  }

  /**
   * Resolve a server reference into a configured server.
   *
   * The reference is either the id of a configured server or the MCP endpoint
   * itself. An endpoint that is not configured yet is added to the list on the
   * spot: the known-vendor table supplies the label, the default scopes and the
   * published authorization server, everything else is left to the OAuth
   * discovery. This is what lets a user connect a server with a single step
   * instead of "configure it, then authorize it".
   *
   * @param {string} reference The server id or the MCP endpoint URL.
   * @returns {Promise<{ server: object, registered: boolean }>} The server and whether it was added.
   * @throws {OAuthError} When the reference is empty or cannot be turned into a server.
   */
  async function ensureServer(reference) {
    const { locale, t } = language()
    const wanted = String(reference ?? '').trim()
    if (!wanted) {
      throw new OAuthError(ERROR_CODES.server_not_found, t('server.error.server_not_given'))
    }
    const existing = servers.get(wanted)
    if (existing) return { server: existing, registered: false }

    if (!/^https?:\/\//i.test(wanted)) {
      const known = servers.list().map((server) => server.id)
      const parts = [t('server.error.unknown_server', { serverId: wanted })]
      if (known.length > 0) parts.push(t('server.error.configured_servers', { servers: known.join(', ') }))
      parts.push(t('server.error.endpoint_hint'))
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        `${parts.join(' ')} ${buildTag(locale)}`,
      )
    }

    const profile = matchProfileByEndpoint(wanted)
    const baseId = profile?.id ?? deriveServerId(wanted)
    if (!baseId) {
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        t('server.error.endpoint_not_mcp', { endpoint: wanted }),
      )
    }
    // The endpoint is the identity of a server: authorizing the same endpoint
    // twice must not create a second entry.
    const sameEndpoint = servers.list().find((server) => server.url === wanted)
    if (sameEndpoint) return { server: sameEndpoint, registered: false }
    const sameId = servers.get(baseId)
    if (sameId) return { server: sameId, registered: false }
    const id = uniqueServerId(baseId)
    const entry = {
      id,
      label: profile?.label ?? id,
      url: wanted,
      enabled: true,
    }
    if (profile?.defaultScopes?.length) entry.scopes = [...profile.defaultScopes]
    if (profile?.authorizationServerUrl) entry.authorizationServerUrl = profile.authorizationServerUrl
    if (profile) entry.profile = profile.id
    await servers.upsert(entry)
    logger?.info?.('dsh-oauth-mcp: a server was added from its endpoint', { serverId: id, url: wanted })
    return { server: { ...entry }, registered: true }
  }

  /**
   * Read the pending authorization request of one server.
   *
   * The pending record carries the link the user still has to open, so a
   * status request can repeat it instead of asking the user to start over.
   *
   * @param {string} serverId Server identifier.
   * @returns {{ authorizationUrl?: string, expiresAt?: number, method?: string } | undefined} The pending request.
   */
  function pendingAuthorization(serverId) {
    const entry = pending.get(serverId)
    if (!entry) return undefined
    return {
      authorizationUrl: entry.authorizationUrl,
      expiresAt: entry.expiresAt,
      method: entry.method,
    }
  }

  /**
   * Start an authorization request for one server.
   *
   * The method never opens a browser and never grants anything by itself: it
   * returns the URL the user has to open. A caller that owns a user-present
   * surface (`source: 'ui'`) may additionally wait for the result through the
   * returned promise-shaped `waitForCompletion` callback.
   *
   * @param {{ serverId: string, method?: 'browser' | 'manual', source?: 'ui' | 'agent', commitWith?: (record: object) => Promise<void> }} request The request.
   * @returns {Promise<{ status: 'authorized' | 'awaiting_user' | 'cancelled', authorizationUrl?: string, expiresAt?: number }>} The outcome.
   */
  async function beginAuthorization(request = {}) {
    const source = request.source ?? 'agent'
    const method = request.method === 'manual' ? 'manual' : 'browser'
    const { server, registered } = await ensureServer(request.server ?? request.serverId)
    const serverId = server.id

    // One authorization per server at a time. A second one would overwrite the
    // pending request of the first, and the callback of the first would be
    // exchanged with the request of the second.
    if (pending.has(serverId)) {
      throw new OAuthError(
        ERROR_CODES.authorization_in_flight,
        language().t('server.error.authorization_in_flight', { serverId }),
      )
    }

    const scopes = server.scopes?.length ? [...server.scopes] : [...readConfigArray(config.defaultScopes, [])]
    const resource = canonicalResource(server.url)
    const existing = await loadGrant(serverId)
    // A vendor may demand a redirect path of its own; the plugin then sends
    // that path instead of the one it is configured with.
    const profile = server.profile
      ? findProfile(server.profile)
      : matchProfileByEndpoint(server.url)
    const redirectUri = redirectUriForProfile(callback?.redirectUri, profile)

    const started = await authorizer.start({
      serverId,
      serverUrl: server.url,
      clientId: existing?.clientId ?? server.clientId,
      // A secret the user typed in the panel wins over the one of an earlier
      // grant: it is the newer value.
      clientSecret: server.clientSecret || existing?.clientSecret,
      scopes,
      redirectUri,
      resource,
      authorizationServerUrl: server.authorizationServerUrl,
    })

    const timeoutMs = config.authorizationTimeoutMs ?? 300000
    if (typeof started.state === 'string') stateIndex.set(started.state, serverId)
    let settle
    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject }
    })
    const timer = setTimeout(() => {
      // A timed out authorization is over: the state is dropped and the
      // authorizer forgets the request, so a callback that arrives late finds
      // nothing and does not redeem a stale grant.
      rejectPending(serverId, new AuthorizationTimeoutError(`The authorization request for "${serverId}" timed out.`))
      forgetStateIndex(serverId)
      void authorizer.cancel?.(serverId)
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    pending.set(serverId, {
      promise,
      resolve: settle.resolve,
      reject: settle.reject,
      timer,
      authorizationUrl: started.authorizationUrl,
      expiresAt: started.expiresAt,
      method,
    })
    promise.catch(() => {})

    // Both paths hand the URL to the user and return. The plugin never opens a
    // browser and never grants anything by itself: the grant only happens when
    // the callback arrives. The caller that owns a user-present surface awaits
    // `waitForCompletion`.
    void source
    return {
      status: 'awaiting_user',
      serverId,
      registered,
      method,
      authorizationUrl: started.authorizationUrl,
      expiresAt: started.expiresAt,
    }
  }

  /**
   * Wait for the pending authorization of one server to finish.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<object>} The stored grant payload.
   */
  function waitForCompletion(serverId) {
    const entry = pending.get(serverId)
    if (!entry) {
      return Promise.reject(
        new OAuthError(
          ERROR_CODES.authorization_cancelled,
          language().t('server.error.no_pending_authorization', { serverId }),
        ),
      )
    }
    return entry.promise
  }

  /**
   * Finish an authorization request once the callback arrived.
   *
   * @param {string} serverId Server identifier.
   * @param {string} code The authorization code.
   * @param {string} state The state value.
   * @param {{ commitWith?: (record: object) => Promise<void> }} [options] Optional writer.
   * @returns {Promise<object>} The stored grant payload.
   */
  async function completeAuthorization(serverId, code, state, options = {}) {
    const { payload } = await authorizer.complete({ serverId, code, state })
    if (typeof state === 'string') stateIndex.delete(state)
    if (options.commitWith) await options.commitWith({ kind: 'grant', payload })
    else await tokens.save(serverId, payload)
    resolvePending(serverId, payload)
    try {
      await connections?.connect?.(serverId)
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: the server did not connect after the authorization', { serverId, error: String(error?.message ?? error) })
    }
    return payload
  }

  /**
   * Finish an authorization request from a pasted callback URL.
   *
   * @param {string} serverId Server identifier.
   * @param {string} input The pasted callback URL or query string.
   * @param {{ commitWith?: (record: object) => Promise<void> }} [options] Optional writer.
   * @returns {Promise<object>} The stored grant payload.
   */
  async function completeManual(serverId, input, options = {}) {
    const { parseManualCallback } = await import('./callback/manual.js')
    const parsed = parseManualCallback(input)
    if (parsed.error) {
      throw new OAuthError(
        ERROR_CODES.callback_rejected,
        language().t('server.error.authorization_server_reported', { reason: parsed.error }),
      )
    }
    return completeAuthorization(serverId, parsed.code, parsed.state, options)
  }

  /**
   * Cancel a pending authorization request.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<{ cancelled: boolean }>} The outcome.
   */
  async function cancelAuthorization(serverId) {
    const existed = pending.has(serverId)
    rejectPending(serverId, new AuthorizationCancelledError())
    forgetStateIndex(serverId)
    await authorizer.cancel?.(serverId)
    return { cancelled: existed }
  }

  /**
   * Drop every state that belongs to one server.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {void}
   */
  function forgetStateIndex(serverId) {
    for (const [state, owner] of [...stateIndex.entries()]) {
      if (owner === serverId) stateIndex.delete(state)
    }
  }

  /**
   * Resolve the server that a callback state belongs to.
   *
   * The OAuth callback URL carries the state but not the server id, so the
   * plugin keeps this index while an authorization is pending.
   *
   * @param {string} state The state value from the callback.
   * @returns {string | undefined} The server id.
   */
  function resolveServerByState(state) {
    if (typeof state !== 'string' || !state) return undefined
    return stateIndex.get(state)
  }

  /**
   * Drop the MCP connection of one server.
   *
   * The stored grant is kept: reconnecting uses the same token.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<{ disconnected: boolean }>} The outcome.
   */
  async function disconnect(serverId) {
    await connections?.disconnect?.(serverId)
    return { disconnected: true }
  }

  /**
   * Update one configured server.
   *
   * The write goes through the host settings service, which restarts the
   * plugin so the new list is applied.
   *
   * @param {string} serverId Server identifier.
   * @param {object} patch The fields to change.
   * @returns {Promise<OAuthMcpServerView>} The updated view.
   */
  async function updateServer(serverId, patch = {}) {
    const server = servers.get(serverId)
    if (!server) {
      const { locale, t } = language()
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        `${t('server.error.unknown_server', { serverId })} ${buildTag(locale)}`,
      )
    }
    await servers.upsert({ ...server, ...patch, id: server.id })
    return describeServer(serverId)
  }

  /**
   * Report whether a server may use its stored access token right now.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<boolean>} Whether the server is authorized.
   */
  async function isAuthorized(serverId) {
    const grant = await loadGrant(serverId)
    if (!grant?.accessToken) return false
    if (!grant.expiresAt) return true
    return grant.expiresAt - 60000 > Date.now()
  }

  /**
   * Refresh the stored access token of one server when it is stale.
   *
   * @param {string} serverId Server identifier.
   * @returns {Promise<object | undefined>} The refreshed payload.
   */
  async function refreshToken(serverId) {
    const refreshed = await refresher?.refreshIfNeeded?.(serverId)
    return refreshed
  }

  return {
    listServers,
    describeServer,
    status,
    credentialServiceState,
    listTools,
    listToolNames,
    ensureServer,
    pendingAuthorization,
    beginAuthorization,
    waitForCompletion,
    completeAuthorization,
    completeManual,
    cancelAuthorization,
    resolveServerByState,
    disconnect,
    updateServer,
    isAuthorized,
    refreshToken,
    /** @internal Exposed for the host callback receiver and the host command. */
    ctx,
  }
}
