/**
 * The list of MCP servers this plugin manages.
 *
 * The list lives in the plugin's own profile entry: it is read from the plugin
 * Config (`config.servers`) and written back through the host settings service
 * (`settings.mutate` for the volatile field, `settings.update` as fallback).
 * Two properties matter:
 *
 * * `servers` is a **volatile** Config field, so a write into the settings
 *   namespace is committed into the running plugin instead of restarting it.
 *   The host reports the change through `loader/volatile-update`, and the
 *   plugin re-reads the list when it sees that event;
 * * when the host exposes no settings service the list cannot be persisted;
 *   the reads keep working (they use the Config), and the writes fail loudly
 *   instead of pretending to have saved something.
 *
 * A server entry is `{ id, label, url, scopes?, enabled?, profile?,
 * authorizationServerUrl? }`. The id doubles as the credential key suffix and
 * as the tool-name prefix, so it is restricted to a stable, lowercase pattern.
 *
 * @module dsh-oauth-mcp/store/server-list
 */

import { parseScope } from '../oauth/types.js'
import { readConfigArray } from '../util/config.js'
import { SERVER_ID_PATTERN, isValidServerId, serverIdHint } from '../util/server-id.js'

/**
 * Validate the URL of a server.
 *
 * @param {unknown} url The candidate URL.
 * @returns {string} The validated URL.
 * @throws {TypeError} When the URL is missing or not an http(s) URL.
 */
function validateServerUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('A server entry must carry a url.')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError('A server entry must carry an absolute http(s) url.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('A server entry must carry an absolute http(s) url.')
  }
  return url
}

/**
 * Normalize the scopes of a server entry.
 *
 * @param {unknown} scopes The configured scopes.
 * @returns {string[] | undefined} The scope members, or `undefined` when the
 *   entry carries no scope field at all.
 */
function normalizeScopes(scopes) {
  if (scopes === undefined || scopes === null) return undefined
  return parseScope(scopes)
}

/**
 * Create the server list.
 *
 * @param {object} options Server-list options.
 * @param {{ servers?: Array<object> }} [options.config] The plugin Config.
 * @param {{ update: (entryId: string, patch: object) => Promise<unknown> }} [options.settings]
 *   The host settings service. Optional: without it the list can be read but
 *   not written.
 * @param {string} entryId The plugin's profile entry id, used as the settings
 *   namespace of the list.
 * @param {{ warn?: (message: string) => void, info?: (message: string) => void, error?: (message: string) => void, debug?: (message: string) => void }} [options.logger]
 *   Diagnostic logger.
 * @returns {{
 *   list: () => Array<object>,
 *   get: (id: string) => object | undefined,
 *   upsert: (server: object) => Promise<Array<object>>,
 *   remove: (id: string) => Promise<Array<object>>,
 *   refresh: () => Array<object>,
 * }} The server list.
 */
export function createServerList({ config, settings, entryId, logger } = {}) {
  /** @type {Array<object>} The current list; seeded from the Config. */
  let servers = readConfiguredServers(config)

  /**
   * Emit a diagnostic line.
   *
   * @param {'debug' | 'info' | 'warn' | 'error'} level Log level.
   * @param {string} message The message.
   * @returns {void}
   */
  function log(level, message) {
    const emit = logger?.[level]
    if (typeof emit !== 'function') return
    try {
      emit.call(logger, String(message))
    } catch {
      // A failing logger must never break the list.
    }
  }

  /**
   * Read the server array out of the plugin Config.
   *
   * The Config field is volatile, so the value may arrive as a reference. The
   * helper unwraps both shapes.
   *
   * @param {{ servers?: Array<object> } | undefined} source The plugin Config.
   * @returns {Array<object>} The configured servers, invalid entries dropped.
   */
  function readConfiguredServers(source) {
    const configured = readConfigArray(source?.servers, [])
    if (!Array.isArray(configured)) return []
    const result = []
    for (const entry of configured) {
      if (!entry || typeof entry !== 'object') continue
      if (!isValidServerId(entry.id)) {
        log('warn', `Ignoring a configured server with an invalid id: ${String(entry.id)}`)
        continue
      }
      result.push({ ...entry })
    }
    return result
  }

  /**
   * List the configured servers.
   *
   * @returns {Array<object>} The configured servers.
   */
  function list() {
    return servers.map((server) => ({ ...server }))
  }

  /**
   * Re-read the list from the plugin Config.
   *
   * The host commits a volatile Config change into the running plugin and
   * reports it through `loader/volatile-update`. The plugin calls this
   * afterwards so the list matches the configuration again.
   *
   * @returns {Array<object>} The refreshed list.
   */
  function refresh() {
    servers = readConfiguredServers(config)
    return list()
  }

  /**
   * Read one server by id.
   *
   * @param {string} id The server id.
   * @returns {object | undefined} The server entry, or `undefined`.
   */
  function get(id) {
    const found = servers.find((server) => server.id === id)
    return found ? { ...found } : undefined
  }

  /**
   * Write the list into the plugin's profile entry.
   *
   * The `servers` field is volatile, so the host accepts it through
   * `settings.mutate` and commits it into the running plugin without a
   * restart. Hosts without a volatile path fall back to `settings.update`,
   * which rewrites the entry and restarts the plugin.
   *
   * @param {Array<object>} next The list to persist.
   * @returns {Promise<Array<object>>} The persisted list.
   * @throws {Error} When the host exposes no settings service.
   */
  async function persist(next) {
    if (!settings) {
      throw new Error('The host settings service is unavailable.')
    }
    if (typeof settings.mutate === 'function') {
      await settings.mutate(entryId, [{ op: 'set', path: ['servers'], value: next }])
    } else if (typeof settings.update === 'function') {
      await settings.update(entryId, { servers: next })
    } else {
      throw new Error('The host settings service is unavailable.')
    }
    servers = next.map((server) => ({ ...server }))
    return list()
  }

  /**
   * Add or replace one server.
   *
   * The change is persisted into the plugin's profile entry through the host
   * settings service. The field is volatile, so the host commits the change
   * into the running plugin; the caller must treat the return value as the new
   * list.
   *
   * @param {object} server The server entry to store.
   * @returns {Promise<Array<object>>} The persisted list.
   * @throws {Error} When the host exposes no settings service.
   * @throws {TypeError} When the entry is malformed.
   */
  async function upsert(server) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
      throw new TypeError('A server entry must be an object.')
    }
    if (!isValidServerId(server.id)) {
      throw new TypeError(serverIdHint())
    }
    validateServerUrl(server.url)

    const entry = { ...server }
    entry.id = server.id
    entry.label = typeof server.label === 'string' && server.label.length > 0 ? server.label : server.id
    const scopes = normalizeScopes(server.scopes)
    if (scopes === undefined) delete entry.scopes
    else entry.scopes = scopes

    const next = servers.some((item) => item.id === entry.id)
      ? servers.map((item) => (item.id === entry.id ? entry : item))
      : [...servers, entry]

    return persist(next)
  }

  /**
   * Remove one server.
   *
   * The change is persisted into the plugin's profile entry through the host
   * settings service. The field is volatile, so the host commits the change
   * into the running plugin; the caller must treat the return value as the new
   * list.
   *
   * @param {string} id The server id.
   * @returns {Promise<Array<object>>} The persisted list.
   * @throws {Error} When the host exposes no settings service.
   * @throws {TypeError} When the id is malformed.
   */
  async function remove(id) {
    if (!isValidServerId(id)) {
      throw new TypeError(serverIdHint())
    }
    if (!servers.some((item) => item.id === id)) return list()
    const next = servers.filter((item) => item.id !== id)
    return persist(next)
  }

  return { list, get, upsert, remove, refresh }
}
