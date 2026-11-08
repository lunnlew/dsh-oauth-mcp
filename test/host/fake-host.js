/**
 * A minimal fake of the DSH host, used by the host-integration and the smoke
 * tests. It implements only the host surface the plugin is allowed to use:
 * `ctx.tools`, `ctx.logger`, `ctx.get(...)`, `ctx.provide(...)` and the
 * optional services `credentials`, `commands`, `authorization`, `settings` and
 * `webServer`.
 */

/**
 * Wrap the volatile configuration fields into references.
 *
 * The host resolves a field declared `.volatile()` into a stable reference and
 * commits a later edit into that same reference. The fake host does the same,
 * so the plugin sees the new value without being restarted.
 *
 * @param {object} config The plain configuration.
 * @returns {object} The configuration with volatile references.
 */
export function withVolatileConfig(config = {}) {
  const values = {
    defaultScopes: Array.isArray(config.defaultScopes) ? config.defaultScopes : [],
    autoConnect: config.autoConnect !== false,
    servers: Array.isArray(config.servers) ? config.servers : [],
    locale: typeof config.locale === 'string' ? config.locale : '',
  }
  return {
    ...config,
    defaultScopes: { get: () => values.defaultScopes },
    autoConnect: { get: () => values.autoConnect },
    servers: { get: () => values.servers },
    locale: { get: () => values.locale },
    __volatileValues: values,
  }
}

/**
 * Create the fake host context.
 *
 * @param {object} [options] Fake host options.
 * @param {object} [options.config] The plugin Config the host would pass in.
 * @param {boolean} [options.withCredentials] Provide the credential service.
 * @param {boolean} [options.withCommands] Provide the commands service.
 * @param {boolean} [options.withAuthorization] Provide the authorization service.
 * @param {boolean} [options.withSettings] Provide the settings service.
 * @param {boolean} [options.withWebServer] Provide the web server service.
 * @param {string} [options.locale] The language of the interface the host reports.
 * @param {string} [options.origin] The origin the fake web server reports.
 * @returns {object} The fake context, with `__state` describing what happened.
 */
export function createFakeHost(options = {}) {
  const {
    config = {},
    withCredentials = true,
    withCommands = true,
    withAuthorization = true,
    withSettings = true,
    withWebServer = true,
    locale = '',
    origin = 'http://127.0.0.1:64188',
  } = options

  /** Every tool registration that is still alive. */
  const tools = new Map()
  /** Every command registration that is still alive. */
  const commands = new Map()
  /** Every authorization flow that is still alive. */
  const flows = new Map()
  /** Every web route that is still alive. */
  const routes = new Map()
  /** The credential records, keyed by credential key. */
  const records = new Map()
  /** The services the plugin provided. */
  const provided = new Map()
  /** The log lines the plugin wrote. */
  const logs = []

  const logger = {
    info: (message, ...rest) => logs.push(['info', message, ...rest]),
    warn: (message, ...rest) => logs.push(['warn', message, ...rest]),
    error: (message, ...rest) => logs.push(['error', message, ...rest]),
    debug: (message, ...rest) => logs.push(['debug', message, ...rest]),
  }

  const credentials = {
    readRecord: async (key) => records.get(key),
    describeRecord: async (key) => ({ key, kind: records.get(key)?.kind }),
    listRecords: async () => [...records.keys()],
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      if (next === undefined) records.delete(key)
      else records.set(key, next)
      return records.get(key)
    },
    deleteRecord: async (key) => {
      records.delete(key)
    },
  }

  const commandsService = {
    register: (definition) => {
      commands.set(definition.definitionId ?? definition.name, definition)
      return () => commands.delete(definition.definitionId ?? definition.name)
    },
  }

  const authorizationService = {
    registerFlow: (flow) => {
      if (flows.has(flow.key)) throw new Error('DUPLICATE_FLOW')
      flows.set(flow.key, flow)
      return () => flows.delete(flow.key)
    },
    list: () => [...flows.values()].map((flow) => ({ key: flow.key, label: flow.label })),
    describe: (key) => flows.get(key),
    cancel: (key) => flows.delete(key),
    begin: async () => ({ status: 'cancelled' }),
  }

  const settingsService = {
    update: async (ns, patch) => {
      settingsService.calls.push({ ns, patch })
    },
    mutate: async (ns, ops, revision) => {
      settingsService.calls.push({ ns, ops, revision })
      // The host commits a volatile change into the running plugin.
      const values = config?.__volatileValues
      if (!values) return { ok: true, value: { revision: 0 } }
      const changed = []
      for (const op of ops ?? []) {
        const field = Array.isArray(op.path) ? op.path[0] : undefined
        if (field && field in values) {
          values[field] = op.value
          changed.push(Array.isArray(op.path) ? op.path : [field])
        }
      }
      // The Loader reports the committed paths to the running plugin.
      if (changed.length > 0) emit('loader/volatile-update', changed)
      return { ok: true, value: { revision: 1 } }
    },
    // The host hands out the settings document with the other namespaces: the
    // language of the interface and the fields the plugin owns.
    describe: () => [
      {
        ns: 'locale',
        schema: {},
        revision: 0,
        applies: true,
        value: { preference: locale },
        base: {},
        user: {},
      },
      {
        ns: 'dsh-oauth-mcp',
        schema: {},
        revision: 0,
        applies: true,
        value: { ...(config?.__volatileValues ?? {}) },
        base: {},
        user: {},
      },
    ],
    calls: [],
  }

  const webServerService = {
    getOrigin: () => origin,
    register: (route) => {
      if (routes.has(route.path)) throw new Error(`DUPLICATE_ROUTE ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const services = {
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions: () => [...tools.values()],
    },
    logger,
  }
  if (withCredentials) services.credentials = credentials
  if (withCommands) services.commands = commandsService
  if (withAuthorization) services.authorization = authorizationService
  if (withSettings) services.settings = settingsService
  if (withWebServer) services.webServer = webServerService

  /** The event listeners the plugin registered, keyed by event name. */
  const listeners = new Map()

  const ctx = {
    logger,
    tools: services.tools,
    get: (key) => services[key],
    provide: (key, value) => {
      provided.set(key, value)
      return value
    },
    effect: (fn) => {
      const disposer = fn()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
  }

  /**
   * Emit one host event.
   *
   * @param {string} event The event name.
   * @param {...unknown} args The event arguments.
   * @returns {void}
   */
  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  return {
    ctx,
    config,
    tools,
    commands,
    flows,
    routes,
    records,
    provided,
    logs,
    settingsService,
    services,
    emit,
  }
}

/**
 * Collect the names of the tools that are still registered.
 *
 * @param {Map<string, object>} tools The registration map.
 * @returns {string[]} The tool names.
 */
export function toolNames(tools) {
  return [...tools.keys()].sort()
}
