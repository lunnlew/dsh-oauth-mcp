/**
 * The callback mode selector.
 *
 * The plugin can receive the OAuth redirect in three ways:
 *
 * * `dedicated-port` — a loopback server of its own, the default;
 * * `host-web` — one exact route on the host's web server;
 * * `manual-only` — no listener at all, the user pastes the callback back.
 *
 * The selector starts the configured mode and degrades when it cannot:
 * a busy loopback port falls back to `host-web` and then to `manual-only`,
 * and a host web server that is not bound falls back to `manual-only`. The
 * mode and the redirect URI it returns describe what actually started, so the
 * caller can show both to the user.
 *
 * @module dsh-oauth-mcp/callback/selector
 */

import { ERROR_CODES } from '../oauth/errors.js'

/** The modes the selector knows. */
const MODES = new Set(['dedicated-port', 'host-web', 'manual-only'])

/**
 * Report whether an error means "the port is already taken".
 *
 * @param {unknown} error The error of the failed start.
 * @returns {boolean} Whether the loopback port was busy.
 */
function isPortConflict(error) {
  if (!error || typeof error !== 'object') return false
  if (error.code === 'EADDRINUSE') return true
  if (error.code === ERROR_CODES.callback_conflict) return true
  if (error?.cause?.code === 'EADDRINUSE') return true
  return /EADDRINUSE/i.test(String(error.message ?? ''))
}

/**
 * Choose the callback mode and start it.
 *
 * @param {object} options Selector options.
 * @param {string} [configuredMode] The configured mode: `dedicated-port`,
 *   `host-web` or `manual-only`.
 * @param {() => Promise<{ url?: string, close?: () => unknown }>} [startLoopback]
 *   Starts the loopback receiver.
 * @param {() => Promise<{ url?: string, close?: () => unknown }>} [startHostWeb]
 *   Starts the host-web receiver.
 * @param {{ warn?: (message: string, meta?: object) => void, info?: (message: string, meta?: object) => void, error?: (message: string, meta?: object) => void, debug?: (message: string, meta?: object) => void }} [logger]
 *   Diagnostic logger.
 * @returns {Promise<{
 *   mode: 'dedicated-port' | 'host-web' | 'manual-only',
 *   redirectUri: string,
 *   start: () => Promise<{ mode: string, redirectUri: string }>,
 *   stop: () => Promise<void>,
 * }>} The selector.
 * @throws {TypeError} When the arguments are malformed.
 */
export async function selectCallbackMode({ configuredMode, startLoopback, startHostWeb, logger } = {}) {
  const requested = typeof configuredMode === 'string' ? configuredMode.trim() : ''
  const mode = MODES.has(requested) ? requested : 'dedicated-port'

  /**
   * Emit a diagnostic line.
   *
   * @param {'debug' | 'info' | 'warn' | 'error'} level Log level.
   * @param {string} message The message.
   * @param {object} [meta] Extra context; never contains secrets.
   * @returns {void}
   */
  function log(level, message, meta) {
    const emit = logger?.[level]
    if (typeof emit !== 'function') return
    try {
      emit.call(logger, message, meta)
    } catch {
      // A failing logger must never break the selector.
    }
  }

  /** @type {{ mode: string, redirectUri: string, handle: { url?: string, close?: () => unknown } | null } | null} */
  let active = null

  /**
   * Start one factory and describe what it produced.
   *
   * @param {(() => Promise<object>) | undefined} factory The factory.
   * @param {string} candidateMode The mode the factory implements.
   * @returns {Promise<{ mode: string, redirectUri: string, handle: object }>} The started mode.
   */
  async function startWith(factory, candidateMode) {
    if (typeof factory !== 'function') {
      throw new TypeError(`The ${candidateMode} callback mode is not available.`)
    }
    const handle = await factory()
    const redirectUri = typeof handle?.url === 'string' ? handle.url : ''
    return { mode: candidateMode, redirectUri, handle }
  }

  /**
   * Run the start sequence of the configured mode.
   *
   * @returns {Promise<void>} Resolves once a mode is active.
   */
  async function runStart() {
    if (mode === 'manual-only') {
      active = { mode: 'manual-only', redirectUri: '', handle: null }
      log('info', 'dsh-oauth-mcp: the callback receiver runs in manual-only mode')
      return
    }

    if (mode === 'host-web') {
      try {
        active = await startWith(startHostWeb, 'host-web')
      } catch (error) {
        log('warn', 'dsh-oauth-mcp: the host-web callback receiver is unavailable; falling back to manual-only', {
          error: String(error?.name ?? 'Error'),
          code: error?.code,
        })
        active = { mode: 'manual-only', redirectUri: '', handle: null }
      }
      return
    }

    try {
      active = await startWith(startLoopback, 'dedicated-port')
    } catch (error) {
      if (!isPortConflict(error)) throw error
      log('warn', 'dsh-oauth-mcp: the loopback callback port is busy; falling back to host-web')
      try {
        active = await startWith(startHostWeb, 'host-web')
      } catch (hostWebError) {
        log('warn', 'dsh-oauth-mcp: the host-web callback receiver is unavailable; falling back to manual-only', {
          error: String(hostWebError?.name ?? 'Error'),
          code: hostWebError?.code,
        })
        active = { mode: 'manual-only', redirectUri: '', handle: null }
      }
    }
  }

  await runStart()

  return {
    /** The mode that actually started. */
    mode: active.mode,
    /** The redirect URI of the mode that actually started; empty for manual-only. */
    redirectUri: active.redirectUri,

    /**
     * Report the mode that is running; it restarts the receiver after a
     * `stop()`.
     *
     * @returns {Promise<{ mode: string, redirectUri: string }>} The running mode.
     */
    async start() {
      if (!active) await runStart()
      return { mode: active.mode, redirectUri: active.redirectUri }
    },

    /**
     * Stop the running receiver.
     *
     * @returns {Promise<void>} Resolves when the receiver is closed.
     */
    async stop() {
      const handle = active?.handle
      active = null
      if (!handle || typeof handle.close !== 'function') return
      try {
        await handle.close()
      } catch (error) {
        log('warn', 'dsh-oauth-mcp: the callback receiver could not be closed', {
          error: String(error?.name ?? 'Error'),
          code: error?.code,
        })
      }
    },
  }
}
