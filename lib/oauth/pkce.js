/**
 * PKCE (RFC 7636) and `state` handling.
 *
 * The module owns the one-time secrets of an authorization request: the
 * `code_verifier` and the `state` value. Both stay in memory; the state store
 * binds a state to one server, one redirect URI and one code verifier and
 * expires it after ten minutes.
 *
 * The module is pure: the random source and the clock are injected so the
 * behaviour is deterministic under test.
 *
 * @module dsh-oauth-mcp/oauth/pkce
 */

import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto'
import { STATE_TTL_MS } from './types.js'

/** Number of random bytes behind a code verifier and behind a state value. */
const RANDOM_BYTES = 32

/**
 * Default random source: the runtime CSPRNG.
 *
 * @param {number} size Number of bytes to read.
 * @returns {Buffer} The random bytes.
 */
function defaultRandomBytes(size) {
  return cryptoRandomBytes(size)
}

/**
 * Encode bytes as base64url without padding.
 *
 * @param {Uint8Array | Buffer} bytes The bytes to encode.
 * @returns {string} The base64url text.
 */
function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Create a PKCE code verifier and its S256 challenge.
 *
 * The verifier is 43 base64url characters over 32 random bytes, which sits
 * inside the 43–128 character range of RFC 7636 §4.1.
 *
 * @param {(size: number) => Uint8Array} [randomBytes=defaultRandomBytes] Random source.
 * @returns {{ codeVerifier: string, codeChallenge: string, codeChallengeMethod: 'S256' }} The PKCE triple.
 */
export function createPkce(randomBytes = defaultRandomBytes) {
  if (typeof randomBytes !== 'function') {
    throw new TypeError('createPkce requires a random byte source.')
  }
  const codeVerifier = base64url(randomBytes(RANDOM_BYTES))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier, 'utf8').digest())
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' }
}

/**
 * Create a one-time `state` value.
 *
 * @param {(size: number) => Uint8Array} [randomBytes=defaultRandomBytes] Random source.
 * @returns {string} The state value.
 */
export function createState(randomBytes = defaultRandomBytes) {
  if (typeof randomBytes !== 'function') {
    throw new TypeError('createState requires a random byte source.')
  }
  return base64url(randomBytes(RANDOM_BYTES))
}

/**
 * Compare two state values without leaking their contents through timing.
 *
 * The values are hashed first, so the comparison stays constant time even
 * when the two strings have a different length.
 *
 * @param {unknown} expected The expected state value.
 * @param {unknown} received The state value that came back.
 * @returns {boolean} Whether the two values are identical.
 */
export function verifyState(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  if (expected.length === 0 || received.length === 0) return false
  const left = createHash('sha256').update(expected, 'utf8').digest()
  const right = createHash('sha256').update(received, 'utf8').digest()
  return timingSafeEqual(left, right)
}

/**
 * Create the in-memory store of pending authorization requests.
 *
 * Every server owns its own table of pending states; a state may be consumed
 * once only and dies with its TTL.
 *
 * @param {object} [options] Store options.
 * @param {number} [options.ttlMs=STATE_TTL_MS] Lifetime of a state value.
 * @param {() => number} [options.now=Date.now] Clock used for the issue and the expiry stamps.
 * @returns {{ issue: Function, consume: Function, peek: Function, clear: Function }} The state store.
 */
export function createStateStore({ ttlMs = STATE_TTL_MS, now = Date.now } = {}) {
  /** @type {Map<string, Map<string, object>>} Pending states, per server. */
  const pending = new Map()

  /**
   * Issue a state value and bind it to one server.
   *
   * @param {string} serverId The server the state belongs to.
   * @param {object} binding The values bound to the state.
   * @param {string} binding.redirectUri The redirect URI of the request.
   * @param {string} binding.codeVerifier The PKCE code verifier of the request.
   * @param {string[]} [binding.scopes] The requested scopes.
   * @param {string} [binding.resource] The canonical resource indicator.
   * @returns {{ state: string, issuedAt: number, expiresAt: number }} The issued state and its stamps.
   */
  function issue(serverId, { redirectUri, codeVerifier, scopes, resource } = {}) {
    const state = createState()
    const issuedAt = now()
    const expiresAt = issuedAt + ttlMs
    const entry = {
      redirectUri,
      codeVerifier,
      scopes: Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === 'string' && scope.length > 0) : [],
      resource,
      issuedAt,
      expiresAt,
    }
    let entries = pending.get(serverId)
    if (!entries) {
      entries = new Map()
      pending.set(serverId, entries)
    }
    entries.set(state, entry)
    return { state, issuedAt, expiresAt }
  }

  /**
   * Look up a state without consuming it.
   *
   * @param {string} serverId The server the state must belong to.
   * @param {unknown} state The state value.
   * @returns {object | undefined} The binding, or `undefined` when it is unknown or expired.
   */
  function peek(serverId, state) {
    const entries = pending.get(serverId)
    if (!entries || typeof state !== 'string' || state.length === 0) return undefined
    const entry = entries.get(state)
    if (!entry) return undefined
    if (now() >= entry.expiresAt) {
      entries.delete(state)
      if (entries.size === 0) pending.delete(serverId)
      return undefined
    }
    return entry
  }

  /**
   * Consume a state value.
   *
   * @param {string} serverId The server the state must belong to.
   * @param {unknown} state The state value.
   * @returns {{ ok: true, binding: object } | { ok: false, reason: 'state_invalid' | 'state_expired' }} The outcome.
   */
  function consume(serverId, state) {
    const entries = pending.get(serverId)
    if (!entries || typeof state !== 'string' || state.length === 0) {
      return { ok: false, reason: 'state_invalid' }
    }
    const entry = entries.get(state)
    if (!entry) {
      return { ok: false, reason: 'state_invalid' }
    }
    entries.delete(state)
    if (entries.size === 0) pending.delete(serverId)
    if (now() >= entry.expiresAt) {
      return { ok: false, reason: 'state_expired' }
    }
    return { ok: true, binding: entry }
  }

  /**
   * Drop every pending state of one server.
   *
   * @param {string} serverId The server to forget.
   * @returns {void} Nothing.
   */
  function clear(serverId) {
    pending.delete(serverId)
  }

  return { issue, consume, peek, clear }
}
