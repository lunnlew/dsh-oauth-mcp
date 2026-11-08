/**
 * The `dsh_oauth_mcp_authorize` agent tool.
 *
 * The tool starts the OAuth 2.1 authorization of one MCP server and hands the
 * user the link that completes it. It never signs in as the user and it never
 * touches a token itself: the plugin stores the token when the callback
 * arrives, and the tool only reports what happened.
 *
 * The tool is built around the human part of the flow, which is where a user
 * gets stuck. Three shapes of the same operation are supported:
 *
 *   1. `server` — the id of a configured server **or** its endpoint URL. An
 *      endpoint that is not configured yet is added on the spot, so "connect
 *      Notion" is one step instead of "configure it, then authorize it".
 *   2. `callbackUrl` — the callback URL the user copied out of the browser
 *      address bar (the way back when the callback receiver could not be
 *      reached). The tool finishes the exchange; the user never has to run a
 *      command with a long URL.
 *   3. `dryRun` — the exact plan, without contacting the server.
 *
 * @module dsh-oauth-mcp/tools/authorize
 */

import { OAuthError, ERROR_CODES, describeError } from '../oauth/errors.js'
import { describeErrorCode } from '../errors-messages.js'
import { canonicalResource } from '../oauth/resource.js'
import { redactUrl } from '../util/redact.js'
import { parseManualCallback } from '../callback/manual.js'
import { matchProfileByEndpoint, deriveServerId, redirectUriForProfile } from '../profiles/known-profiles.js'
import { createTranslator, resolveLocale } from '../i18n/index.js'

/** The wire name of the tool. */
export const AUTHORIZE_TOOL_NAME = 'dsh_oauth_mcp_authorize'

/** The callback port the plugin uses when its configuration says nothing else. */
const DEFAULT_CALLBACK_PORT = 39271

/** The callback path the plugin uses when its configuration says nothing else. */
const DEFAULT_CALLBACK_PATH = '/oauth-mcp/callback'

/** JSON Schema of the value the tool resolves with. */
const AUTHORIZE_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  description: 'The outcome of one authorization request.',
  properties: {
    serverId: { type: 'string', description: 'The identifier of the configured MCP server.' },
    label: { type: 'string', description: 'The human readable label of the server.' },
    endpoint: { type: 'string', description: 'The MCP endpoint of the server.' },
    status: {
      type: 'string',
      enum: ['planned', 'authorized', 'awaiting_user', 'cancelled'],
      description: 'The state of the authorization.',
    },
    method: {
      type: 'string',
      enum: ['browser', 'manual'],
      description: 'How the user is expected to finish the login.',
    },
    callbackMode: { type: 'string', description: 'The callback mode in use: dedicated-port, host-web or manual-only.' },
    redirectUri: { type: 'string', description: 'The redirect URI the flow uses.' },
    scopes: { type: 'array', items: { type: 'string' }, description: 'The requested scopes.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'The ordered steps of the flow.' },
    authorizationUrl: { type: 'string', description: 'The link the user has to open.' },
    expiresAt: { type: 'number', description: 'When the pending authorization expires.' },
    registered: {
      type: 'boolean',
      description: 'True when this call added the server to the configuration because only its endpoint was known.',
    },
    nextStep: {
      type: 'string',
      description: 'The one thing the user has to do next, in one sentence.',
    },
  },
  required: ['serverId', 'label', 'status', 'method', 'callbackMode', 'redirectUri', 'scopes', 'steps', 'nextStep'],
  additionalProperties: false,
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
 * Read the callback configuration of the plugin.
 *
 * The host passes the callback state of the running plugin when it wants the
 * exact redirect URI in the plan; without it the plan describes the callback
 * mode and the redirect URI that mode implies.
 *
 * @param {object} [options] The factory options.
 * @param {{ mode?: string, redirectUri?: string }} [options.callback] The live callback state.
 * @param {{ callbackMode?: string, callbackPort?: number, callbackPath?: string }} [options.config] The plugin configuration.
 * @param {(key: string, params?: Record<string, unknown>) => string} [options.t] The translator.
 * @param {object} [view] The server view, which carries the active callback mode.
 * @returns {{ mode: string, redirectUri: string }} The callback information.
 */
function resolveCallback(options, view) {
  const { callback, config, t } = options
  const mode =
    (typeof callback?.mode === 'string' && callback.mode) ||
    (typeof view?.callbackMode === 'string' && view.callbackMode) ||
    (typeof config?.callbackMode === 'string' && config.callbackMode) ||
    'manual-only'
  // A vendor may demand a redirect path of its own; the plugin then shows and
  // sends that path instead of the configured one.
  const profile = matchProfileByEndpoint(view?.url)
  if (typeof callback?.redirectUri === 'string' && callback.redirectUri.length > 0) {
    return { mode, redirectUri: redirectUriForProfile(callback.redirectUri, profile) }
  }
  const port = typeof config?.callbackPort === 'number' ? config.callbackPort : DEFAULT_CALLBACK_PORT
  const path =
    typeof config?.callbackPath === 'string' && config.callbackPath.length > 0
      ? config.callbackPath
      : DEFAULT_CALLBACK_PATH
  if (mode === 'dedicated-port') {
    return { mode, redirectUri: `http://127.0.0.1:${port}${path}` }
  }
  if (mode === 'host-web') {
    return { mode, redirectUri: t('server.tool.authorize.redirect.host', { path }) }
  }
  return { mode: 'manual-only', redirectUri: t('server.tool.authorize.redirect.manual') }
}

/**
 * Read the scopes the flow would request.
 *
 * @param {object} view The server view.
 * @param {{ defaultScopes?: string[] }} [config] The plugin configuration.
 * @returns {string[]} The requested scopes.
 */
function resolveScopes(view, config) {
  const configured = Array.isArray(view?.scopes) ? view.scopes : []
  if (configured.length > 0) return configured
  return Array.isArray(config?.defaultScopes) ? [...config.defaultScopes] : []
}

/**
 * Describe the ordered steps of the authorization flow.
 *
 * @param {object} options The plan inputs.
 * @param {string} options.label The server label.
 * @param {string} options.url The MCP server URL.
 * @param {string} options.method How the user finishes the login.
 * @param {string} options.callbackMode The callback mode.
 * @param {string} options.redirectUri The redirect URI.
 * @param {string[]} options.scopes The requested scopes.
 * @param {boolean} [options.registered] Whether the server was added by this call.
 * @param {(key: string, params?: Record<string, unknown>) => string} options.t The translator.
 * @returns {string[]} The steps.
 */
function buildSteps(options) {
  const { label, url, method, callbackMode, redirectUri, scopes, registered, t } = options
  const resource = canonicalResource(url)
  const steps = []
  if (registered) {
    steps.push(t('server.tool.steps.registered', { label, url }))
  }
  steps.push(t('server.tool.steps.metadata', { label, url }))
  steps.push(t('server.tool.steps.server'))
  steps.push(
    t('server.tool.steps.request', {
      resource,
      scopes: scopes.length > 0 ? scopes.join(' ') : t('server.tool.authorize.none'),
    }),
  )
  steps.push(t('server.tool.steps.redirect', { redirectUri, callbackMode }))
  if (method === 'manual') {
    steps.push(t('server.tool.steps.manual'))
  } else {
    steps.push(t('server.tool.steps.browser'))
  }
  steps.push(t('server.tool.steps.exchange'))
  steps.push(t('server.tool.steps.connect'))
  return steps
}

/**
 * Create the `dsh_oauth_mcp_authorize` tool.
 *
 * @param {object} options Collaborators.
 * @param {object} options.service The `oauthMcp` host service.
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.logger] Diagnostic logger.
 * @param {{ mode?: string, redirectUri?: string }} [options.callback] The live callback state of the plugin.
 * @param {{ callbackMode?: string, callbackPort?: number, callbackPath?: string, defaultScopes?: string[] }} [options.config] The plugin configuration.
 * @param {object} [options.settings] The host settings service, used to read the language of the interface.
 * @returns {object} The tool definition.
 */
export function createAuthorizeTool(options = {}) {
  const { service, logger, callback, config, settings } = options

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
   * Describe the server the user named, without writing anything.
   *
   * A configured id is looked up; an endpoint URL that is not configured yet
   * is described from the known-vendor table, so the plan can be shown before
   * anything is added.
   *
   * @param {string} reference The server id or the endpoint URL.
   * @param {string} locale The language of the answer.
   * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
   * @returns {Promise<{ view: object, registered: boolean }>} The server view.
   */
  async function describeReference(reference, locale, t) {
    const wanted = String(reference ?? '').trim()
    if (!wanted) {
      throw new OAuthError(ERROR_CODES.server_not_found, t('server.tool.authorize.need.reference'))
    }
    try {
      return { view: await service.describeServer(wanted), registered: false }
    } catch (error) {
      if (!/^https?:\/\//i.test(wanted)) throw toToolError(error, locale)
    }
    const profile = matchProfileByEndpoint(wanted)
    const id = profile?.id ?? deriveServerId(wanted)
    if (!id) {
      throw new OAuthError(
        ERROR_CODES.server_not_found,
        t('server.tool.authorize.need.endpoint', { endpoint: wanted }),
      )
    }
    return {
      view: {
        id,
        label: profile?.label ?? id,
        url: wanted,
        scopes: profile?.defaultScopes ? [...profile.defaultScopes] : [],
        enabled: true,
      },
      registered: true,
    }
  }

  /**
   * Render the tool result.
   *
   * @param {object} args The tool arguments.
   * @param {object} value The tool result.
   * @returns {{ type: 'text', text: string }[]} The content blocks.
   */
  function render(args, value) {
    const { t } = language()
    const result = value ?? {}
    const label = String(result.label ?? result.serverId ?? t('server.tool.authorize.server'))
    if (result.status === 'awaiting_user') {
      const url = typeof result.authorizationUrl === 'string' ? result.authorizationUrl : ''
      const manual = result.method === 'manual' || result.callbackMode === 'manual-only'
      const lines = [
        t('server.tool.authorize.waiting', { label }),
        url
          ? t('server.tool.authorize.open', { url })
          : t('server.tool.authorize.nolink'),
      ]
      if (url) {
        lines.push(t('server.tool.authorize.copy', { url }))
      }
      lines.push(t('server.tool.authorize.done'))
      if (manual) {
        lines.push(t('server.tool.authorize.manual'))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }
    if (result.status === 'authorized') {
      return [{ type: 'text', text: t('server.tool.authorize.authorized', { label }) }]
    }
    if (result.status === 'cancelled') {
      return [{ type: 'text', text: t('server.tool.authorize.cancelled', { label }) }]
    }
    const plan = Array.isArray(result.steps) ? result.steps : []
    const scopes =
      Array.isArray(result.scopes) && result.scopes.length > 0
        ? result.scopes.join(' ')
        : t('server.tool.authorize.none')
    const lines = [
      t('server.tool.authorize.plan', { label, serverId: result.serverId }),
      t('server.tool.authorize.callback', {
        callbackMode: result.callbackMode,
        redirectUri: result.redirectUri,
      }),
      t('server.tool.authorize.scopes', { scopes }),
      t('server.tool.authorize.steps'),
      ...plan.map((step, index) => `${index + 1}. ${step}`),
    ]
    return [{ type: 'text', text: lines.join('\n') }]
  }

  /**
   * Run the tool.
   *
   * @param {{ server?: string, serverId?: string, callbackUrl?: string, dryRun?: boolean, method?: string }} args The tool arguments.
   * @returns {Promise<object>} The tool result.
   */
  async function execute(args = {}) {
    const { locale, t } = language()
    const reference = String(args?.server ?? args?.serverId ?? '').trim()
    const callbackUrl = typeof args?.callbackUrl === 'string' ? args.callbackUrl.trim() : ''
    const method = args?.method === 'manual' ? 'manual' : 'browser'
    const dryRun = args?.dryRun === true

    if (!reference && !callbackUrl) {
      throw new OAuthError(ERROR_CODES.server_not_found, t('server.tool.authorize.need.reference'))
    }

    // --- the user pasted the callback URL back --------------------------------
    if (callbackUrl) {
      let parsed
      try {
        parsed = parseManualCallback(callbackUrl)
      } catch (error) {
        throw toToolError(error, locale)
      }
      if (parsed.error) {
        throw new OAuthError(
          ERROR_CODES.callback_rejected,
          t('server.tool.authorize.callback.unreadable', { reason: parsed.error }),
        )
      }
      let serverId = ''
      let label = ''
      if (reference) {
        const resolved = await service.ensureServer(reference)
        serverId = resolved.server.id
        label = resolved.server.label || serverId
      } else {
        serverId = service.resolveServerByState(parsed.state) ?? ''
      }
      if (!serverId) {
        throw new OAuthError(
          ERROR_CODES.state_invalid,
          t('server.tool.authorize.callback.unmatched'),
        )
      }
      try {
        await service.completeManual(serverId, callbackUrl)
      } catch (error) {
        throw toToolError(error, locale)
      }
      const view = await service.describeServer(serverId).catch(() => undefined)
      logger?.info?.('dsh-oauth-mcp: the agent finished an authorization from a pasted callback', { serverId })
      return {
        serverId,
        label: label || view?.label || serverId,
        endpoint: view?.url ?? '',
        status: 'authorized',
        method,
        callbackMode: resolveCallback({ callback, config, t }, view).mode,
        redirectUri: resolveCallback({ callback, config, t }, view).redirectUri,
        scopes: Array.isArray(view?.scopes) ? [...view.scopes] : [],
        steps: [
          t('server.tool.steps.pasted'),
          t('server.tool.steps.exchanged'),
          t('server.tool.steps.connected'),
        ],
        nextStep: t('server.tool.authorize.next.done'),
      }
    }

    // --- the user named a server ---------------------------------------------
    const { view, registered } = await describeReference(reference, locale, t)
    const callbackInfo = resolveCallback({ callback, config, t }, view)
    const scopes = resolveScopes(view, config)

    if (dryRun) {
      return {
        serverId: view.id || reference,
        label: view.label || reference,
        endpoint: view.url ?? '',
        status: 'planned',
        method,
        callbackMode: callbackInfo.mode,
        redirectUri: callbackInfo.redirectUri,
        scopes,
        registered,
        steps: buildSteps({
          label: view.label || reference,
          url: view.url,
          method,
          callbackMode: callbackInfo.mode,
          redirectUri: callbackInfo.redirectUri,
          scopes,
          registered,
          t,
        }),
        nextStep: t('server.tool.authorize.next'),
      }
    }

    let outcome
    try {
      outcome = await service.beginAuthorization({ server: reference, source: 'agent', method })
    } catch (error) {
      throw toToolError(error, locale)
    }

    const status = outcome?.status ?? 'awaiting_user'
    const serverId = outcome?.serverId ?? view.id ?? reference
    const result = {
      serverId,
      label: view.label || reference,
      endpoint: view.url ?? '',
      status,
      method,
      callbackMode: callbackInfo.mode,
      redirectUri: callbackInfo.redirectUri,
      scopes,
      registered: outcome?.registered ?? registered,
      steps: buildSteps({
        label: view.label || reference,
        url: view.url,
        method,
        callbackMode: callbackInfo.mode,
        redirectUri: callbackInfo.redirectUri,
        scopes,
        registered: outcome?.registered ?? registered,
        t,
      }),
      nextStep: t('server.tool.authorize.next.ask'),
    }
    if (typeof outcome?.authorizationUrl === 'string' && outcome.authorizationUrl.length > 0) {
      result.authorizationUrl = outcome.authorizationUrl
    }
    if (typeof outcome?.expiresAt === 'number') result.expiresAt = outcome.expiresAt

    logger?.info?.('dsh-oauth-mcp: the agent started an authorization', {
      serverId,
      method,
      status,
      registered: result.registered,
      url: outcome?.authorizationUrl ? redactUrl(outcome.authorizationUrl) : undefined,
    })

    return result
  }

  return {
    name: AUTHORIZE_TOOL_NAME,
    description:
      'Connect one OAuth protected MCP server: add it if only its endpoint is known, start the login and hand the user the link that completes it.\n' +
      'Pass server="https://mcp.notion.com/mcp" (or the id of an already configured server) to connect a server in one step - an unknown endpoint is added to the configuration automatically.\n' +
      'When the browser could not reach the callback (callback mode manual-only, or the callback page did not load), ask the user to copy the whole address bar URL of the callback page and call this tool again with callbackUrl set to that URL; the tool then finishes the login.\n' +
      'Use dsh_oauth_mcp_status to inspect the current state instead of this tool, and never call a remote tool of the server here.\n' +
      'Pass dryRun=true to show the user the exact flow - server, callback mode, redirect URI, scopes and the ordered steps - without contacting the server.\n' +
      'The tool never signs in as the user: it returns a link that the user has to open and finish the login in. When the authorization fails, the returned message names the reason and the next step.',
    parameters: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description:
            'The id of a configured MCP server (for example "notion") or its endpoint URL (for example "https://mcp.notion.com/mcp"). An endpoint that is not configured yet is added to the configuration.',
        },
        serverId: {
          type: 'string',
          description: 'The id of a configured MCP server. Same as "server"; kept for compatibility.',
        },
        callbackUrl: {
          type: 'string',
          description:
            'The callback URL the user copied out of the browser address bar after the login. Set it to finish a login whose callback the plugin could not receive.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Describe the flow without sending any request to the server.',
        },
        method: {
          type: 'string',
          enum: ['browser', 'manual'],
          description:
            'How the user finishes the login: "browser" opens the returned link, "manual" asks the user to paste the callback URL back.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: { schema: AUTHORIZE_OUTPUT_SCHEMA, render },
    execute,
    timeoutMs: 60_000,
    isConcurrencySafe: false,
  }
}
