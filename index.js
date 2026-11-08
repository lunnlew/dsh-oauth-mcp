/**
 * dsh-oauth-mcp — a generic OAuth 2.1 client and MCP bridge for the DSH host.
 *
 * The host's own MCP client only speaks stdio and streamable-http with static
 * request headers, so it cannot talk to the OAuth-protected remote MCP servers
 * that became the norm in 2026. This plugin implements the OAuth side itself
 * (RFC 9728 / RFC 8414 discovery, RFC 7591 dynamic client registration,
 * RFC 7636 PKCE, RFC 8707 resource binding, token storage and refresh) and
 * exposes the remote tools of an authorized server as host tools.
 *
 * @module dsh-oauth-mcp
 */

import z from '@deepseek-ai/schemastery'

import { createHttpClient } from './lib/http/client.js'
import { createStateStore } from './lib/oauth/pkce.js'
import * as discovery from './lib/oauth/discovery.js'
import * as registration from './lib/oauth/registration.js'
import * as token from './lib/oauth/token.js'
import * as authorizeRequest from './lib/oauth/authorize-request.js'
import { createAuthorizer } from './lib/oauth/authorizer.js'
import { createTokenStore } from './lib/store/token-store.js'
import { credentialKeyFor } from './lib/store/credential-key.js'
import { createRefresher } from './lib/store/refresher.js'
import { createServerList } from './lib/store/server-list.js'
import { startLoopbackServer } from './lib/callback/loopback-server.js'
import { startHostWebCallback } from './lib/callback/host-web.js'
import { requiredCallbackPaths } from './lib/profiles/known-profiles.js'
import { selectCallbackMode } from './lib/callback/selector.js'
import { renderErrorPage, renderSuccessPage } from './lib/callback/pages.js'
import { createMcpTransport } from './lib/mcp/transport.js'
import { createMcpSession } from './lib/mcp/session.js'
import { createAuthFetch } from './lib/mcp/auth-fetch.js'
import { createToolRegistry } from './lib/mcp/tool-registry.js'
import { createToolExecutor } from './lib/mcp/tool-executor.js'
import { createRevealState } from './lib/mcp/reveal.js'
import { createOauthMcpService } from './lib/service.js'
import { createAuthorizeTool } from './lib/tools/authorize.js'
import { createStatusTool } from './lib/tools/status.js'
import { createRevealTool } from './lib/tools/reveal.js'
import { renderStatusTable, renderScopeDetails, renderToolTable } from './lib/view-model.js'
import { redactText } from './lib/util/redact.js'
import { readConfigArray, readConfigField } from './lib/util/config.js'
import { BUILD_STAMP, PLUGIN_ID, PLUGIN_VERSION, buildLine } from './lib/build-info.js'
import { PLUGIN_SETTINGS_NAMESPACE, createTranslator, resolveLocale } from './lib/i18n/index.js'

/** The profile entry id of this plugin; it is also the settings namespace. */
export const ENTRY_ID = PLUGIN_SETTINGS_NAMESPACE

/** The plugin name, as the host registers it. */
export const name = 'dsh-oauth-mcp'

/** Services the plugin needs. Everything else is optional and read defensively. */
export const inject = ['tools']

import { SERVER_ID_PATTERN } from './lib/util/server-id.js'

const ServerSchema = z.object({
  id: z.string().required().pattern(SERVER_ID_PATTERN),
  label: z.string().default(''),
  url: z.string().required(),
  scopes: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  profile: z.string().default(''),
  authorizationServerUrl: z.string().default(''),
  clientId: z.string().default(''),
  // The secret of a client the user created by hand. The browser half cannot
  // reach the credential service, so the value travels through the
  // configuration and is copied into the credential record at the
  // authorization.
  clientSecret: z.string().default(''),
})

/**
 * The plugin configuration.
 *
 * The host only lets the settings page write *volatile* fields, and a volatile
 * field is committed into the running plugin instead of restarting it. The
 * four fields the settings page edits — `servers`, `defaultScopes`,
 * `autoConnect` and `locale` — are therefore volatile. The remaining fields
 * change the callback receiver or the tool names, which the plugin can only
 * rebuild by starting over, so they stay ordinary: the host's plugin
 * configuration page edits them and the host restarts the plugin afterwards.
 *
 * The `locale` field carries the language of the interface. The client half
 * writes the host's active locale into it, so the server half speaks the same
 * language as the settings panel. An empty value means "follow the host".
 */
export const Config = z.object({
  callbackMode: z.string().default('dedicated-port'),
  callbackPort: z.number().default(39271),
  callbackPath: z.string().default('/oauth-mcp/callback'),
  toolPrefix: z.string().default('mcp_oauth'),
  authorizationTimeoutMs: z.number().default(300000),
  defaultScopes: z.array(z.string()).default([]).volatile(),
  autoConnect: z.boolean().default(true).volatile(),
  servers: z.array(ServerSchema).default([]).volatile(),
  locale: z.string().default('').volatile(),
  lazyTools: z.boolean().default(true).volatile(),
})

/**
 * Build the page that confirms a finished authorization.
 *
 * The page never contains the code, the token or the state.
 *
 * @param {object} [options] The page options.
 * @param {string} [options.serverLabel] The label of the authorized server.
 * @param {string} [options.serverId] The identifier of the authorized server.
 * @param {string[]} [options.scopes] The scopes the user granted.
 * @param {string} [options.locale] The language of the page.
 * @returns {string} The HTML document.
 */
function successPage(options = {}) {
  return renderSuccessPage(options)
}

/**
 * Build the page that reports a failed authorization.
 *
 * @param {string} code The OAuth error code.
 * @param {string} [description] The OAuth error description.
 * @param {object} [options] The page options.
 * @param {string} [options.serverLabel] The label of the server.
 * @param {string} [options.locale] The language of the page.
 * @returns {string} The HTML document.
 */
function errorPage(code, description, options = {}) {
  return renderErrorPage(code, description, options)
}

/**
 * Install the plugin.
 *
 * @param {object} ctx The plugin context.
 * @param {object} config The validated plugin configuration.
 * @returns {Promise<() => void>} The disposer.
 */
export async function apply(ctx, config) {
  const logger = ctx.logger
  const disposers = []
  const dispose = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer)
  }

  // The host exposes a service only while its provider plugin is active, and
  // that provider can become active after this plugin started. The credential
  // service is therefore resolved per operation instead of once here: a plugin
  // that captured it at startup would keep an undefined reference forever and
  // could never store a grant.
  const credentialService = () => {
    try {
      const direct = ctx.credentials
      if (direct && typeof direct.modifyRecord === 'function') return direct
    } catch {
      // The context throws when the service is not reachable from here.
    }
    try {
      const found = ctx.get?.('credentials')
      if (found && typeof found.modifyRecord === 'function') return found
    } catch {
      // A service that is not there yet is not an error at this point.
    }
    return undefined
  }

  // The host loads a plugin once per process: a linked source directory is not
  // hot-reloaded. The build stamp in the log tells the two versions apart.
  logger?.info?.('dsh-oauth-mcp: started', {
    version: PLUGIN_VERSION,
    build: BUILD_STAMP,
    credentialService: credentialService() ? 'ready' : 'missing',
  })

  const settings = ctx.get?.('settings')
  const authorization = ctx.get?.('authorization')
  const webServer = ctx.get?.('webServer')
  const commands = ctx.get?.('commands')

  /**
   * Resolve the language of one answer.
   *
   * The language is resolved on every call and not once at start-up: a change
   * in the settings takes effect on the next command, and one answer never
   * mixes two languages.
   *
   * @returns {{ locale: string, t: (key: string, params?: Record<string, unknown>) => string }} The language and its translator.
   */
  function language() {
    const locale = resolveLocale({ settings, config })
    return { locale, t: createTranslator(locale) }
  }

  const http = createHttpClient({ timeoutMs: 15000 })

  const stateStore = createStateStore()
  const authorizer = createAuthorizer({
    http,
    stateStore,
    discovery: {
      discoverProtectedResource: discovery.discoverProtectedResource,
      discoverAuthorizationServer: discovery.discoverAuthorizationServer,
      extractAuthorizationServerUrl: discovery.extractAuthorizationServerUrl,
      canonicalizeIssuer: discovery.canonicalizeIssuer,
    },
    register: { registerClient: registration.registerClient },
    buildAuthorizeRequest: { buildAuthorizeRequest: authorizeRequest.buildAuthorizeRequest },
    token: {
      exchangeAuthorizationCode: token.exchangeAuthorizationCode,
      refreshAccessToken: token.refreshAccessToken,
    },
    now: Date.now,
  })

  const tokens = createTokenStore({ credentials: credentialService, logger })
  const refresher = createRefresher({ tokenStore: tokens, http })
  const servers = createServerList({ config, settings, entryId: ENTRY_ID, logger })

  // Let the host settings service describe this plugin's namespace, so the
  // settings page of the client can edit the server list.
  if (settings?.configure) {
    try {
      dispose(settings.configure({ auto: true }))
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: the settings service did not accept the policy', {
        error: String(error?.message ?? error),
      })
    }
  }

  /** Live MCP sessions, keyed by server id. */
  const connectionMap = new Map()

  /** The active callback mode; the service reads it when it builds a redirect URI. */
  const callbackState = { redirectUri: '', mode: 'manual-only' }

  const connections = {
    get: (serverId) => connectionMap.get(serverId),
    connect: (serverId) => connectServer(serverId),
    disconnect: (serverId) => disconnectServer(serverId),
  }

  // The lazy exposure state. While it is on, the remote tools are only offered
  // to the model after the model asked for them through the entry tool.
  const reveal = createRevealState({
    enabled: config.lazyTools !== false,
    toolPrefix: config.toolPrefix,
  })

  const toolRegistry = createToolRegistry({
    tools: ctx.tools,
    toolPrefix: config.toolPrefix,
    logger,
    admissionFor: (serverId) => reveal.admission(serverId),
    callTool: async (serverId, remoteToolName, args, options) => {
      const connection = connectionMap.get(serverId)
      if (!connection?.executor) {
        throw new Error(language().t('server.error.not_connected', { serverId }))
      }
      return connection.executor.callTool(serverId, remoteToolName, args, options)
    },
  })

  const service = createOauthMcpService({
    ctx,
    config,
    servers,
    tokens,
    refresher,
    authorizer,
    callback: callbackState,
    connections,
    credentialStatus: () => (credentialService() ? 'ready' : 'missing'),
    settings,
    logger,
  })

  if (typeof ctx.provide === 'function') {
    ctx.provide('oauthMcp', service)
  }

  /**
   * Open the MCP session of one server and register its tools.
   *
   * @param {string} serverId The server id.
   * @returns {Promise<void>} Resolves when the tools are registered.
   */
  async function connectServer(serverId) {
    const server = servers.get(serverId)
    if (!server) {
      throw new Error(language().t('server.error.unknown_server', { serverId }))
    }
    await disconnectServer(serverId)

    const grant = await tokens.load(serverId)
    if (!grant?.accessToken) {
      throw new Error(language().t('server.error.not_authorized_yet', { serverId }))
    }

    const authFetch = createAuthFetch({
      getAccessToken: async () => (await tokens.load(serverId))?.accessToken,
      refresh: async () => {
        // The server refused the token, so the grant is refreshed whether the
        // token was due or not; a token that is not due may be revoked.
        await refresher.refresh(serverId)
      },
    })

    const transport = createMcpTransport({ url: server.url, fetchImpl: authFetch })
    const session = await createMcpSession({
      url: server.url,
      transport,
      clientInfo: { name: PLUGIN_ID, version: PLUGIN_VERSION },
      protocolVersion: '2025-06-18',
    })
    const executor = createToolExecutor({ session })

    connectionMap.set(serverId, {
      session,
      executor,
      toolCount: 0,
      toolNames: [],
      listTools: () => executor.listTools(serverId),
    })
    const remoteTools = await executor.listTools(serverId)
    await toolRegistry.sync(serverId, remoteTools)
    const connection = connectionMap.get(serverId)
    if (connection) {
      connection.toolCount = remoteTools.length
      connection.toolNames = toolRegistry.hostToolNames(serverId)
    }
  }

  /**
   * Close the MCP session of one server and drop its tools.
   *
   * @param {string} serverId The server id.
   * @returns {Promise<void>} Resolves when the session is closed.
   */
  async function disconnectServer(serverId) {
    const connection = connectionMap.get(serverId)
    if (!connection) return
    connectionMap.delete(serverId)
    try {
      await connection.session?.close?.()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: failed to close the MCP session', { serverId, error: String(error?.message ?? error) })
    }
    await toolRegistry.unregisterServer(serverId)
  }

  /**
   * Handle one OAuth callback request.
   *
   * @param {{ query: URLSearchParams, respond: (result: object) => void }} request The callback request.
   * @returns {Promise<void>} Resolves when the response was written.
   */
  async function handleCallbackRequest(request) {
    const { query, respond } = request
    const { locale, t } = language()
    const state = query.get('state') ?? ''
    const code = query.get('code') ?? ''
    const oauthError = query.get('error')
    const oauthErrorDescription = query.get('error_description')

    if (oauthError) {
      respond({ status: 400, body: errorPage(oauthError, oauthErrorDescription, { locale }) })
      logger?.warn?.('dsh-oauth-mcp: the authorization server reported an error', { error: oauthError })
      return
    }

    const serverId = service.resolveServerByState(state)
    if (!serverId) {
      respond({
        status: 400,
        body: errorPage('state_invalid', t('server.error.state_mismatch'), { locale }),
      })
      return
    }

    const view = await service.describeServer(serverId).catch(() => null)
    const pageOptions = { serverLabel: view?.label, serverId, locale }

    try {
      await service.completeAuthorization(serverId, code, state)
      respond({ status: 200, body: successPage({ ...pageOptions, scopes: view?.scopes }) })
      logger?.info?.('dsh-oauth-mcp: the authorization completed', { serverId })
    } catch (error) {
      respond({ status: 400, body: errorPage(error?.code ?? 'authorization_failed', error?.message, pageOptions) })
      logger?.warn?.('dsh-oauth-mcp: the authorization failed', { serverId, error: String(error?.message ?? error) })
    }
  }

  // --- the callback receiver -------------------------------------------------
  // A vendor may demand a redirect path of its own, so the receiver serves the
  // configured path and every path the vendor table names.
  const callbackPaths = requiredCallbackPaths(config.callbackPath)
  const selector = await selectCallbackMode({
    configuredMode: config.callbackMode,
    startLoopback: async () => {
      const server = await startLoopbackServer({
        port: config.callbackPort,
        path: config.callbackPath,
        paths: callbackPaths,
        onRequest: handleCallbackRequest,
        logger,
      })
      return { url: server.url, close: () => server.close() }
    },
    startHostWeb: async () => {
      if (!webServer) throw new Error(language().t('server.error.web_unavailable'))
      const result = await startHostWebCallback({
        webServer,
        path: config.callbackPath,
        paths: callbackPaths,
        onRequest: handleCallbackRequest,
        logger,
      })
      return { url: result.url, close: () => result.close() }
    },
    logger,
  })
  const started = typeof selector?.start === 'function' ? await selector.start() : selector
  const callbackMode = started?.mode ?? selector?.mode ?? 'manual-only'
  let redirectUri = started?.redirectUri ?? selector?.redirectUri ?? ''
  if (callbackMode === 'manual-only' && !redirectUri) {
    // No listener is running, but the authorization server still needs a
    // redirect URI it can send the browser to. The dedicated loopback URI stays
    // the registered one: the browser simply fails to connect and the user
    // copies the address bar URL back into the plugin.
    redirectUri = `http://127.0.0.1:${config.callbackPort}${config.callbackPath}`
  }
  callbackState.redirectUri = redirectUri
  callbackState.mode = callbackMode
  callbackState.manual = callbackMode === 'manual-only'
  logger?.info?.('dsh-oauth-mcp: the OAuth callback receiver is ready', { mode: callbackMode, redirectUri })

  // --- the agent tools -------------------------------------------------------
  // The authorize tool needs the live callback state so that its plan shows the
  // redirect URI the plugin really uses, and the plugin configuration so that
  // the fallback plan is still correct. Both tools read the settings service
  // and the configuration to learn the language of the interface.
  dispose(
    ctx.tools.register(createAuthorizeTool({ service, logger, callback: callbackState, config, settings })),
  )
  dispose(ctx.tools.register(createStatusTool({ service, logger, config, settings })))

  // --- the lazy exposure -----------------------------------------------------
  // While the lazy exposure is on, the remote tools are not in the model's
  // tool table until the model asks for them through the `mcp_oauth` entry
  // tool. The entry tool itself is always in the table: it is the only hint
  // the model gets that the remote tools exist.
  dispose(ctx.tools.register(createRevealTool({ reveal, service, locale: () => config.locale })))

  // A model may remember a tool name from an earlier step and call it even
  // though the tool is not in this step's table. The guard turns that call
  // into an explanation instead of an opaque failure.
  if (typeof ctx.tools.guard === 'function') {
    try {
      dispose(ctx.tools.guard((exec) => reveal.guardFor(exec)))
    } catch (guardError) {
      logger?.warn?.('dsh-oauth-mcp: the tool guard did not register', {
        error: String(guardError?.message ?? guardError),
      })
    }
  }

  // --- the host command ------------------------------------------------------
  if (commands?.register) {
    dispose(
      commands.register({
        definitionId: 'oauth-mcp',
        name: 'oauth-mcp',
        description:
          'Connect, authorize, inspect and disconnect the OAuth protected MCP servers of this profile. ' +
          'The authorize action also accepts an endpoint URL and adds the server on the spot.',
        input: {
          hint:
            'oauth-mcp status [serverId] | oauth-mcp authorize <serverId | url> | oauth-mcp complete <serverId> <callback url> | oauth-mcp tools <serverId> | oauth-mcp disconnect <serverId> | oauth-mcp help',
        },
        handler: async (invocation) => handleCommand(invocation),
      }),
    )
  }

  /**
   * Build the text that tells the user how to finish an authorization.
   *
   * The link is printed twice on purpose: as a clickable markdown link and as
   * a plain line that can be copied into a browser that refuses to open links.
   *
   * @param {string} label The server label.
   * @param {string} url The authorization URL.
   * @param {string} mode The callback mode in use.
   * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
   * @returns {string[]} The lines of the answer.
   */
  function authorizationInstructions(label, url, mode, t) {
    const lines = [
      t('server.authorize.open', { label }),
      t('server.authorize.link', { url }),
      t('server.authorize.copy'),
      url,
      t('server.authorize.done', { mode }),
      t('server.authorize.status'),
    ]
    if (mode === 'manual-only') {
      lines.push(t('server.authorize.manual'))
    }
    return lines
  }

  /**
   * Run the `/oauth-mcp` command.
   *
   * @param {object} invocation The command invocation.
   * @returns {Promise<object>} The command result.
   */
  async function handleCommand(invocation) {
    const { locale, t } = language()
    try {
      return await answer(invocation, locale, t)
    } catch (error) {
      const lines = [redactText(String(error?.message ?? error))]
      // The server of the vendor often says more than the plugin does, and
      // that is usually the part that tells the operator what to change.
      const detail = typeof error?.detail === 'string' ? error.detail.trim() : ''
      if (detail.length > 0) lines.push(t('server.error.detail', { detail: redactText(detail) }))
      return { kind: 'error', text: lines.join('\n') }
    }
  }

  /**
   * Build the answer of one command.
   *
   * Every string of the answer comes from the translator, so the whole answer
   * is written in one language.
   *
   * @param {object} invocation The command invocation.
   * @param {string} locale The language of the answer.
   * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
   * @returns {Promise<object>} The command result.
   */
  async function answer(invocation, locale, t) {
    const raw = String(invocation?.rawInput ?? '')
      .trim()
      .replace(/^\/?oauth-mcp\b/i, '')
      .trim()
    const [action = 'status', ...rest] = raw.split(/\s+/).filter(Boolean)

    if (action === 'help' || action === '?') {
      return {
        kind: 'success',
        text: [
          buildLine(locale),
          t('server.help.heading'),
          t('server.help.status'),
          t('server.help.tools'),
          t('server.help.authorize'),
          t('server.help.complete'),
          t('server.help.disconnect'),
          t('server.help.cancel'),
          '',
          t('server.help.example'),
        ].join('\n'),
      }
    }

    if (action === 'status') {
      const rows = await service.status(rest[0] || undefined)
      if (rows.length === 0) {
        return {
          kind: 'success',
          text: [
            buildLine(locale),
            t('server.status.empty'),
            t('server.status.empty.hint'),
            t('server.example.authorize'),
            t('server.status.empty.vendors'),
          ].join('\n'),
        }
      }
      const lines = [buildLine(locale), renderStatusTable(rows, t)]
      const scopes = renderScopeDetails(rows, t)
      if (scopes.length > 0) {
        lines.push('')
        lines.push(scopes)
      }
      if (service.credentialServiceState?.() === 'missing') {
        lines.push('')
        lines.push(t('server.status.credentials.warning'))
        lines.push(t('server.status.credentials.restart'))
      }
      const waiting = rows.filter((row) => !row.authorized)
      if (waiting.length > 0) {
        lines.push('')
        lines.push(t('server.status.next'))
        for (const row of waiting) {
          const pending = service.pendingAuthorization(row.serverId)
          if (pending?.authorizationUrl) {
            lines.push(t('server.status.pending', { label: row.label, url: pending.authorizationUrl }))
          } else {
            lines.push(t('server.status.authorize', { label: row.label, serverId: row.serverId }))
          }
        }
      }
      return { kind: 'success', text: lines.join('\n') }
    }

    if (action === 'tools') {
      const rows = await service.status(rest[0] || undefined)
      if (rows.length === 0) {
        return {
          kind: 'success',
          text: [
            buildLine(locale),
            rest[0] ? t('server.tools.notfound', { serverId: rest[0] }) : t('server.tools.empty'),
            t('server.tools.hint'),
            t('server.example.authorize'),
          ].join('\n'),
        }
      }
      const groups = []
      for (const row of rows) {
        const remote = await service.listTools(row.serverId)
        const tools = remote.map((tool) => ({
          name: toolRegistry.hostToolName(row.serverId, tool?.name ?? ''),
          remoteName: String(tool?.name ?? ''),
          description: tool?.description ?? '',
        }))
        if (tools.length === 0) {
          const names = service.listToolNames?.(row.serverId) ?? []
          for (const name of names) {
            tools.push({ name, remoteName: '', description: '' })
          }
        }
        groups.push({
          serverId: row.serverId,
          label: row.label,
          connected: row.connected,
          authorized: row.authorized,
          tools,
        })
      }
      const lines = [buildLine(locale), renderToolTable(groups, t), '']
      lines.push(t('server.tools.usage'))
      lines.push(t('server.tools.usage.1'))
      lines.push(t('server.tools.usage.2'))
      lines.push(t('server.tools.usage.3'))
      return { kind: 'success', text: lines.join('\n') }
    }

    if (action === 'authorize') {
      const reference = rest[0]
      if (!reference) {
        return { kind: 'error', text: t('server.authorize.usage') }
      }
      const result = await service.beginAuthorization({ server: reference, source: 'ui' })
      const server = servers.get(result.serverId ?? reference)
      const label = server?.label || result.serverId || reference
      if (result.status === 'awaiting_user' && result.authorizationUrl) {
        const lines = []
        if (result.registered) {
          lines.push(t('server.authorize.added', { label, url: server?.url ?? reference }))
        }
        lines.push(
          ...authorizationInstructions(label, result.authorizationUrl, callbackState.mode ?? 'manual-only', t),
        )
        return { kind: 'success', text: lines.join('\n') }
      }
      return { kind: 'success', text: t('server.authorize.state', { label, status: result.status }) }
    }

    if (action === 'complete') {
      const serverId = rest[0]
      const pasted = rest.slice(1).join(' ').trim()
      if (!serverId || !pasted) {
        return { kind: 'error', text: t('server.complete.usage') }
      }
      await service.completeManual(serverId, pasted)
      const server = servers.get(serverId)
      return {
        kind: 'success',
        text: t('server.complete.done', { label: server?.label || serverId }),
      }
    }

    if (action === 'disconnect') {
      const serverId = rest[0]
      if (!serverId) return { kind: 'error', text: t('server.disconnect.usage') }
      await service.disconnect(serverId)
      return { kind: 'success', text: t('server.disconnect.done', { serverId }) }
    }

    if (action === 'cancel') {
      const serverId = rest[0]
      if (!serverId) return { kind: 'error', text: t('server.cancel.usage') }
      const outcome = await service.cancelAuthorization(serverId)
      return {
        kind: 'success',
        text: outcome.cancelled
          ? t('server.cancel.done', { serverId })
          : t('server.cancel.none', { serverId }),
      }
    }

    return { kind: 'error', text: t('server.unknown', { action }) }
  }

  // --- the host authorization flow -------------------------------------------
  /** Disposers of the registered authorization flows, keyed by server id. */
  const flowDisposers = new Map()

  /**
   * Register the authorization flow of one server.
   *
   * @param {object} server The server entry.
   * @returns {void}
   */
  function registerAuthorizationFlow(server) {
    if (!authorization?.registerFlow) return
    const serverId = server.id
    try {
      const disposer = authorization.registerFlow({
        key: credentialKeyFor(serverId),
        label: server.label || serverId,
        methods: [{ id: 'authorize', label: 'Browser authorization' }],
        run: async (session) => {
          const result = await service.beginAuthorization({ serverId, source: 'ui' })
          if (!result.authorizationUrl) {
            throw new Error(language().t('server.error.no_authorization_url'))
          }
          session.notify({
            message: language().t('server.authorize.notice', { label: server.label || serverId }),
            url: result.authorizationUrl,
          })
          const payload = await service.waitForCompletion(serverId)
          await session.commit({ kind: 'grant', payload })
        },
      })
      flowDisposers.set(serverId, disposer)
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: failed to register the authorization flow', { serverId, error: String(error?.message ?? error) })
    }
  }

  /**
   * Drop the authorization flow of one server.
   *
   * @param {string} serverId The server id.
   * @returns {void}
   */
  function unregisterAuthorizationFlow(serverId) {
    const disposer = flowDisposers.get(serverId)
    if (!disposer) return
    flowDisposers.delete(serverId)
    try {
      disposer()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: failed to release an authorization flow', { serverId, error: String(error?.message ?? error) })
    }
  }

  for (const server of servers.list()) {
    registerAuthorizationFlow(server)
  }

  /**
   * Bring the plugin in line with the configured server list.
   *
   * The host commits a volatile `servers` change into the running plugin and
   * reports it through `loader/volatile-update`. The plugin then drops the
   * flows and sessions of the servers that vanished and opens the sessions of
   * the servers that appeared.
   *
   * @returns {Promise<void>} Resolves when the plugin caught up.
   */
  async function syncServers() {
    servers.refresh()
    const configured = servers.list()
    const known = new Set(configured.map((server) => server.id))

    for (const serverId of [...flowDisposers.keys()]) {
      if (!known.has(serverId)) unregisterAuthorizationFlow(serverId)
    }
    for (const server of configured) {
      if (!flowDisposers.has(server.id)) registerAuthorizationFlow(server)
    }

    for (const serverId of [...connectionMap.keys()]) {
      const server = servers.get(serverId)
      if (!server || server.enabled === false) await disconnectServer(serverId)
    }
    if (readConfigField(config.autoConnect, true) !== false) {
      for (const server of configured) {
        if (server.enabled === false) continue
        if (connectionMap.has(server.id)) continue
        connectServer(server.id).catch((error) => {
          logger?.info?.('dsh-oauth-mcp: the server was not connected yet', { serverId: server.id, error: String(error?.message ?? error) })
        })
      }
    }
  }

  // The host commits a volatile Config change into the running plugin and
  // reports the changed paths. Only `servers` needs a reaction; `defaultScopes`
  // and `autoConnect` are read when they are used.
  dispose(
    ctx.on('loader/volatile-update', (paths) => {
      const touched = (Array.isArray(paths) ? paths : []).map((path) => (Array.isArray(path) ? path.join('.') : String(path)))
      if (!touched.includes('servers')) return
      syncServers().catch((error) => {
        logger?.warn?.('dsh-oauth-mcp: the server list did not sync', { error: String(error?.message ?? error) })
      })
    }),
  )

  // --- connect the enabled servers -------------------------------------------
  if (readConfigField(config.autoConnect, true) !== false) {
    for (const server of servers.list()) {
      if (server.enabled === false) continue
      connectServer(server.id).catch((error) => {
        logger?.info?.('dsh-oauth-mcp: the server was not connected yet', { serverId: server.id, error: String(error?.message ?? error) })
      })
    }
  }

  return () => {
    for (const disposer of disposers.reverse()) {
      try {
        disposer()
      } catch (error) {
        logger?.warn?.('dsh-oauth-mcp: a disposer failed', { error: String(error?.message ?? error) })
      }
    }
    for (const serverId of [...flowDisposers.keys()]) {
      unregisterAuthorizationFlow(serverId)
    }
    try {
      selector?.stop?.()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: the callback receiver did not stop cleanly', { error: String(error?.message ?? error) })
    }
    for (const serverId of [...connectionMap.keys()]) {
      const connection = connectionMap.get(serverId)
      connectionMap.delete(serverId)
      try {
        connection?.session?.close?.()
      } catch {
        // The session is already gone.
      }
    }
    try {
      toolRegistry.dispose?.()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: the tool registry did not dispose cleanly', { error: String(error?.message ?? error) })
    }
    try {
      // The pending authorizations hold a ref'd timer; they must be given up
      // when the plugin goes away, or the timer keeps the process alive.
      service.dispose()
    } catch (error) {
      logger?.warn?.('dsh-oauth-mcp: the pending authorizations did not release cleanly', { error: String(error?.message ?? error) })
    }
  }
}
