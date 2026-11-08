/**
 * Credential storage for OAuth grants.
 *
 * This module is the ONLY place in the plugin that handles token values. It
 * owns two things:
 *
 * 1. the write path into the host credential service — `credentials.modifyRecord`
 *    is the single serialised read-modify-write primitive the host exposes,
 *    which is what makes a token refresh safe against concurrent writers;
 * 2. a process-local mirror of the last payload this process saw, so that
 *    synchronous call sites (the MCP fetch hook) can read a token without
 *    awaiting a promise.
 *
 * Nothing else in the plugin is allowed to persist a token: config and the
 * settings document never receive one. Diagnostic output only ever mentions
 * the server id, never a token, a code or a secret, and it goes through
 * `redact()`.
 *
 * @module dsh-oauth-mcp/store/token-store
 */

import { redact } from '../util/redact.js'
import { CredentialServiceUnavailableError } from '../oauth/errors.js'
import { credentialKeyFor } from './credential-key.js'

/** How many times a missing credential service is looked up again. */
const RESOLVE_ATTEMPTS = 3

/** How long the store waits between two lookups, in milliseconds. */
const RESOLVE_DELAY_MS = 200

/**
 * Build the credential key for one server.
 *
 * The host reads every stored record as `<scope>/<id>`, so the key is built
 * by the shared helper; see `store/credential-key` for the grammar and for
 * the normalization of server ids the host would refuse.
 *
 * @param {string} serverId Plugin-local server identifier.
 * @returns {string} The credential key, `oauth-mcp/<id>`.
 * @throws {TypeError} When the server id is not a non-empty string.
 */
function credentialKey(serverId) {
  return credentialKeyFor(serverId)
}

/**
 * Report whether a credential payload looks like an OAuth grant.
 *
 * The check is deliberately structural: a record written by an older version
 * of the plugin, or by another plugin entirely, must never be mistaken for a
 * usable grant.
 *
 * @param {unknown} value The candidate payload.
 * @returns {boolean} Whether the payload can be used as a grant.
 */
function isGrantPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.serverId !== 'string' || value.serverId.length === 0) return false
  if (typeof value.clientId !== 'string' || value.clientId.length === 0) return false
  if (typeof value.accessToken !== 'string') return false
  return true
}

/**
 * Report whether a value looks like the host credential service.
 *
 * @param {unknown} value The candidate service.
 * @returns {boolean} Whether the value exposes the write path.
 */
function isCredentialService(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.modifyRecord === 'function'
}

/**
 * Create the token store.
 *
 * The credential service is resolved **per operation**, not once at startup.
 * The host only exposes a service while its provider plugin is active, and the
 * provider can become active after this plugin started — a plugin that read
 * the service once at startup would keep an undefined reference forever. The
 * `credentials` option therefore accepts either the service itself or a
 * function that returns it (or `undefined` while it is not available yet).
 *
 * @param {object} options Store options.
 * @param {{ readRecord: (key: string) => unknown, modifyRecord: (key: string, mutate: (current: unknown) => unknown) => unknown, deleteRecord: (key: string) => unknown } | (() => ({ readRecord: Function, modifyRecord: Function, deleteRecord: Function } | undefined)) | undefined} [options.credentials]
 *   The host credential service, or a resolver that returns it. It may be
 *   `undefined` when the host exposes no credential service, which disables
 *   persistence.
 * @param {{ warn?: (message: string) => void, info?: (message: string) => void, error?: (message: string) => void, debug?: (message: string) => void }} [options.logger]
 *   Diagnostic logger. Only server ids and state descriptions are ever logged.
 * @returns {{
 *   load: (serverId: string) => Promise<object | undefined>,
 *   save: (serverId: string, payload: object) => Promise<object>,
 *   delete: (serverId: string) => Promise<void>,
 *   getMemory: (serverId: string) => object | undefined,
 *   isAvailable: () => boolean,
 * }} The token store.
 */
export function createTokenStore({ credentials, logger } = {}) {
  /** @type {Map<string, object>} Process-local mirror of the last payload seen. */
  const memory = new Map()

  /**
   * Emit a diagnostic line without leaking a secret.
   *
   * @param {'debug' | 'info' | 'warn' | 'error'} level Log level.
   * @param {string} message The message.
   * @returns {void}
   */
  function log(level, message) {
    const emit = logger?.[level]
    if (typeof emit !== 'function') return
    try {
      emit.call(logger, redact(String(message)))
    } catch {
      // A failing logger must never break a credential operation.
    }
  }

  /**
   * Resolve the credential service once, without waiting.
   *
   * @returns {{ readRecord: Function, modifyRecord: Function, deleteRecord: Function } | undefined} The service, or `undefined`.
   */
  function resolveService() {
    try {
      const value = typeof credentials === 'function' ? credentials() : credentials
      if (value && typeof value.then === 'function') return undefined
      return isCredentialService(value) ? value : undefined
    } catch {
      // The host context throws when a service is not reachable from here.
      return undefined
    }
  }

  /**
   * Resolve the credential service, waiting a little when it is not there yet.
   *
   * The host activates the provider plugin during startup; a grant that is
   * written a few hundred milliseconds later must still find the service.
   *
   * @returns {Promise<{ readRecord: Function, modifyRecord: Function, deleteRecord: Function } | undefined>} The service, or `undefined`.
   */
  async function resolveServiceWithRetry() {
    const immediate = resolveService()
    if (immediate) return immediate
    for (let attempt = 1; attempt < RESOLVE_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, RESOLVE_DELAY_MS)
      })
      const found = resolveService()
      if (found) return found
    }
    return undefined
  }

  /**
   * Report whether the host exposes the credential service right now.
   *
   * @returns {boolean} Whether the service is available.
   */
  function isAvailable() {
    return resolveService() !== undefined
  }

  /**
   * Read the stored grant of one server.
   *
   * A record is accepted only when it is a grant record whose payload looks
   * like a grant; anything else resolves to `undefined`. When the host has no
   * credential service the result is always `undefined`.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {Promise<object | undefined>} The stored grant payload.
   */
  async function load(serverId) {
    const key = credentialKey(serverId)
    const service = await resolveServiceWithRetry()
    if (!service || typeof service.readRecord !== 'function') return undefined

    let record
    try {
      record = await service.readRecord(key)
    } catch (error) {
      // Only the error name is logged: the message of a credential service
      // failure could echo a token.
      log('warn', `Could not read the credential record for "${serverId}": ${error?.name ?? 'unknown error'}`)
      return undefined
    }

    if (!record || typeof record !== 'object') return undefined
    if (record.kind !== 'grant') return undefined
    if (!isGrantPayload(record.payload)) return undefined

    memory.set(serverId, record.payload)
    return record.payload
  }

  /**
   * Store the grant of one server.
   *
   * The write goes through `credentials.modifyRecord`, the host's only write
   * path, so a refresh that races with another writer cannot lose the newest
   * refresh token. The in-memory mirror is updated first, so a synchronous
   * caller never observes a stale token after the write was requested.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @param {object} payload The grant payload to store.
   * @returns {Promise<object>} The stored payload.
   * @throws {CredentialServiceUnavailableError} When the host exposes no credential service.
   * @throws {TypeError} When the payload is malformed.
   */
  async function save(serverId, payload) {
    const key = credentialKey(serverId)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('The grant payload must be an object.')
    }
    if (typeof payload.accessToken !== 'string') {
      throw new TypeError('The grant payload must carry an accessToken string.')
    }
    if (payload.serverId !== undefined && payload.serverId !== serverId) {
      throw new TypeError('The grant payload serverId does not match the credential key.')
    }

    const service = await resolveServiceWithRetry()
    if (!service) {
      log('error', `The host credential service is unavailable; the grant of "${serverId}" was not stored.`)
      throw new CredentialServiceUnavailableError()
    }

    const record = { kind: 'grant', payload }
    memory.set(serverId, payload)
    await service.modifyRecord(key, async () => record)
    return payload
  }

  /**
   * Remove the stored grant of one server.
   *
   * The in-memory mirror is dropped as well, so a deleted grant can never be
   * replayed by a synchronous caller.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {Promise<void>} Resolves once the record is gone.
   */
  async function removeGrant(serverId) {
    const key = credentialKey(serverId)
    memory.delete(serverId)
    const service = resolveService()
    if (!service || typeof service.deleteRecord !== 'function') return
    try {
      await service.deleteRecord(key)
    } catch (error) {
      // Only the error name is logged: the message of a credential service
      // failure could echo a token.
      log('warn', `Could not delete the credential record for "${serverId}": ${error?.name ?? 'unknown error'}`)
    }
  }

  /**
   * Read the last payload this process saw for one server.
   *
   * @param {string} serverId Plugin-local server identifier.
   * @returns {object | undefined} The mirrored payload, or `undefined`.
   */
  function getMemory(serverId) {
    if (typeof serverId !== 'string') return undefined
    return memory.get(serverId)
  }

  return { load, save, delete: removeGrant, getMemory, isAvailable }
}
