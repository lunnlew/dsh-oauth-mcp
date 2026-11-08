/**
 * The manual (copy and paste) OAuth callback.
 *
 * In `manual-only` mode the plugin does not listen on any port. The user
 * finishes the authorization in the browser, copies the callback URL out of
 * the address bar and pastes it back into the plugin. This module turns that
 * paste into the same result the loopback receiver would have produced.
 *
 * The pasted text may be
 *
 * * the full callback URL — `http://127.0.0.1:39271/oauth-mcp/callback?code=…&state=…`;
 * * the bare query string — `code=…&state=…`;
 * * the same query inside the fragment of the URL, which some authorization
 *   servers use with `response_mode=fragment`.
 *
 * @module dsh-oauth-mcp/callback/manual
 */

import { CallbackError, ERROR_CODES } from '../oauth/errors.js'

/**
 * Read the parameters out of a URL or a bare query string.
 *
 * @param {string} input The pasted text.
 * @returns {URLSearchParams} The parsed parameters.
 */
function readParameters(input) {
  const text = input.trim()

  if (text.includes('://')) {
    let url
    try {
      url = new URL(text)
    } catch {
      throw new CallbackError('The pasted callback URL could not be read.', {
        code: ERROR_CODES.callback_rejected,
      })
    }
    if (url.search.length > 1) return new URLSearchParams(url.search)
    const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    if (fragment.length > 0) return new URLSearchParams(fragment)
    return new URLSearchParams()
  }

  const query = text.startsWith('?') ? text.slice(1) : text
  return new URLSearchParams(query)
}

/**
 * Parse a pasted callback.
 *
 * @param {string} input The pasted callback URL or query string.
 * @returns {{ code: string, state: string, error?: string, errorDescription?: string }} The parsed parameters.
 * @throws {TypeError} When the input is not a string.
 * @throws {CallbackError} When the input carries neither a code nor an
 *   OAuth error, or when the state is missing.
 */
export function parseManualCallback(input) {
  if (typeof input !== 'string') {
    throw new TypeError('The pasted callback must be a string.')
  }
  const text = input.trim().replace(/^["']|["']$/g, '').trim()
  if (text.length === 0) {
    throw new CallbackError('The pasted callback is empty.', {
      code: ERROR_CODES.callback_rejected,
    })
  }

  const parameters = readParameters(text)
  const code = parameters.get('code') ?? ''
  const state = parameters.get('state') ?? ''
  const error = parameters.get('error') ?? ''
  const errorDescription = parameters.get('error_description') ?? ''

  if (error.length > 0) {
    if (state.length === 0) {
      throw new CallbackError('The pasted callback does not contain the state parameter.', {
        code: ERROR_CODES.callback_rejected,
      })
    }
    const result = { code: '', state, error }
    if (errorDescription.length > 0) result.errorDescription = errorDescription
    return result
  }

  if (code.length === 0) {
    throw new CallbackError('The pasted callback does not contain an authorization code.', {
      code: ERROR_CODES.callback_rejected,
    })
  }
  if (state.length === 0) {
    throw new CallbackError('The pasted callback does not contain the state parameter.', {
      code: ERROR_CODES.callback_rejected,
    })
  }

  return { code, state }
}

/**
 * Create the manual callback collector.
 *
 * The collector accepts one result — either a pasted callback or a
 * cancellation — and hands it to the caller. A second attempt is rejected,
 * because the authorization behind the first result is already settled.
 *
 * @param {object} options Collector options.
 * @param {(result: { code?: string, state?: string, error?: string, errorDescription?: string, cancelled?: boolean }) => unknown} onResult
 *   Called once with the outcome.
 * @returns {{
 *   complete: (input: string) => Promise<object>,
 *   cancel: () => Promise<{ cancelled: boolean }>,
 * }} The collector.
 * @throws {TypeError} When no `onResult` function was given.
 */
export function createManualCallback({ onResult } = {}) {
  if (typeof onResult !== 'function') {
    throw new TypeError('createManualCallback requires an onResult function.')
  }
  let settled = false

  /**
   * Hand one outcome to the caller.
   *
   * @param {object} result The outcome.
   * @returns {Promise<object>} The outcome.
   * @throws {CallbackError} When a result was already handed over.
   */
  async function deliver(result) {
    if (settled) {
      throw new CallbackError('The manual callback was already completed.', {
        code: ERROR_CODES.callback_rejected,
      })
    }
    settled = true
    await onResult(result)
    return result
  }

  /**
   * Complete the authorization with a pasted callback.
   *
   * @param {string} input The pasted callback URL or query string.
   * @returns {Promise<object>} The parsed parameters.
   * @throws {CallbackError} When the paste cannot be parsed, or when a result
   *   was already handed over.
   */
  async function complete(input) {
    const parsed = parseManualCallback(input)
    await deliver(parsed)
    return parsed
  }

  /**
   * Cancel the pending authorization.
   *
   * @returns {Promise<{ cancelled: boolean }>} The outcome.
   * @throws {CallbackError} When a result was already handed over.
   */
  async function cancel() {
    return deliver({ cancelled: true })
  }

  return { complete, cancel }
}
