/**
 * Outbound HTTP client for the OAuth 2.1 client.
 *
 * The DeepSeek Harness host exposes no outbound HTTP service, so this module
 * wraps the runtime global `fetch`. Every request carries a timeout, never
 * follows a redirect (a redirect could point the `Authorization` header at
 * another origin) and reports failures through `HttpError` with a redacted
 * detail.
 *
 * The module is pure: it reads no environment variable, keeps no global
 * state and accepts the `fetch` implementation as an argument so tests can
 * inject a fake.
 *
 * @module dsh-oauth-mcp/http/client
 */

import { redact, redactText, redactUrl } from '../util/redact.js'
import { truncateDetail } from '../oauth/errors.js'
import { createTimeoutSignal } from './timeout.js'

/**
 * A failed outbound HTTP request.
 *
 * The `url` and the `detail` are already redacted: they never carry a token,
 * an authorization code or a client secret.
 *
 * @extends Error
 */
export class HttpError extends Error {
  /**
   * @param {string} message Diagnostic message; must not contain secrets.
   * @param {{ status?: number, url?: string, detail?: string, cause?: unknown, headers?: Headers }} [options] Extra context.
   */
  constructor(message, { status, url, detail, cause, headers } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'HttpError'
    /** HTTP status of the answer, or `undefined` for a transport failure. */
    this.status = status
    /** The requested URL, redacted. */
    this.url = typeof url === 'string' ? url : ''
    /** The truncated, redacted response body. */
    this.detail = typeof detail === 'string' ? detail : ''
    /**
     * The headers of the answer, when there was one.
     *
     * A `401` carries the `WWW-Authenticate` challenge the MCP authorization
     * profile points at, so the caller can read it.
     */
    this.headers = headers
  }
}

/**
 * Merge default headers with caller headers.
 *
 * The caller wins for a header name that is already present, whatever its
 * casing; the header names themselves are sent as they were given.
 *
 * @param {Record<string, string>} base Default headers.
 * @param {Record<string, string>} [extra] Caller headers.
 * @returns {Record<string, string>} The merged header map.
 */
function mergeHeaders(base, extra) {
  const result = { ...base }
  const seen = new Map(Object.keys(result).map((key) => [key.toLowerCase(), key]))
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined || value === null) continue
    const existing = seen.get(key.toLowerCase())
    if (existing !== undefined) delete result[existing]
    result[key] = String(value)
    seen.set(key.toLowerCase(), key)
  }
  return result
}

/**
 * Combine several abort signals into one.
 *
 * `AbortSignal.any` is not available on every supported Node release, so the
 * combination is done by hand.
 *
 * @param {Array<AbortSignal | undefined>} signals The signals to combine.
 * @returns {{ signal: AbortSignal, dispose: () => void }} The combined signal and its cleanup.
 */
function combineSignals(signals) {
  const controller = new AbortController()
  const cleanups = []
  for (const source of signals) {
    if (!source) continue
    if (source.aborted) {
      controller.abort(source.reason)
      break
    }
    const onAbort = () => controller.abort(source.reason)
    source.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => source.removeEventListener('abort', onAbort))
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
    },
  }
}

/**
 * Build a diagnostic detail from a response body.
 *
 * A JSON body is redacted field by field, so a token echoed inside a JSON
 * object never survives; a plain-text body is scrubbed for inline
 * credentials. The result is truncated to the shared error-detail budget.
 *
 * @param {unknown} text The raw response body.
 * @returns {string} The redacted, truncated detail.
 */
function safeDetail(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  try {
    return truncateDetail(JSON.stringify(redact(JSON.parse(text))))
  } catch {
    return truncateDetail(redactText(text))
  }
}

/**
 * Create the outbound HTTP client.
 *
 * @param {object} [options] Client options.
 * @param {number} [options.timeoutMs=15000] Ceiling of one request, in milliseconds.
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch] The fetch implementation; the default is read when the client is created, not when this module is imported.
 * @param {() => number} [options.now=Date.now] Clock used to measure request duration.
 * @returns {{ getJson: Function, postForm: Function, postJson: Function, request: Function }} The HTTP client.
 */
export function createHttpClient({ timeoutMs = 15_000, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createHttpClient requires a fetch implementation.')
  }

  /**
   * Perform one request.
   *
   * @param {string} url The absolute URL to request.
   * @param {object} [options] Request options.
   * @param {string} [options.method='GET'] The HTTP method.
   * @param {Record<string, string>} [options.headers] Headers sent as given.
   * @param {string} [options.body] The request body.
   * @param {AbortSignal} [options.signal] Caller abort signal.
   * @param {string} [options.accept='application/json'] The `Accept` header.
   * @returns {Promise<{ status: number, headers: Headers, body: unknown, text: string }>} The raw answer.
   */
  async function request(url, { method = 'GET', headers, body, signal, accept } = {}) {
    const target = String(url)
    const safeUrl = redactUrl(target)
    const requestHeaders = mergeHeaders({ Accept: accept ?? 'application/json' }, headers)
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? createTimeoutSignal(timeoutMs, `Request timed out after ${timeoutMs}ms`)
      : undefined
    const combined = combineSignals([signal, timeout?.signal])
    const startedAt = now()
    let response
    try {
      try {
        response = await fetchImpl(target, {
          method,
          headers: requestHeaders,
          body,
          redirect: 'manual',
          signal: combined.signal,
        })
      } catch (error) {
        const durationMs = now() - startedAt
        if (timeout?.signal.aborted || error?.name === 'TimeoutError') {
          const timeoutError = new HttpError(`Request timed out after ${timeoutMs}ms`, {
            url: safeUrl,
            cause: error,
          })
          timeoutError.durationMs = durationMs
          throw timeoutError
        }
        if (signal?.aborted) {
          const abortError = new HttpError('Request was aborted.', { url: safeUrl, cause: error })
          abortError.durationMs = durationMs
          throw abortError
        }
        const networkError = new HttpError(`Request to ${safeUrl} failed.`, {
          url: safeUrl,
          detail: truncateDetail(redactText(error?.message ?? '')),
          cause: error,
        })
        networkError.durationMs = durationMs
        throw networkError
      }

      let text = ''
      try {
        text = await response.text()
      } catch {
        text = ''
      }
      const status = response.status
      if (status >= 300 && status < 400) {
        throw new HttpError(`Cross-origin redirect is not allowed: ${safeUrl}`, {
          status,
          url: safeUrl,
          detail: safeDetail(text),
        })
      }
      if (status < 200 || status >= 300) {
        throw new HttpError(`Request to ${safeUrl} failed with status ${status}.`, {
          status,
          url: safeUrl,
          detail: safeDetail(text),
          headers: response.headers,
        })
      }
      let parsed
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
      }
      return { status, headers: response.headers, body: parsed, text }
    } finally {
      // The timeout and the combined signal are released on every path,
      // including the failing ones: a timer that outlives the request keeps
      // the event loop alive.
      combined.dispose()
      timeout?.dispose()
    }
  }

  /**
   * Ensure that a raw answer carried a JSON body.
   *
   * @param {string} url The requested URL.
   * @param {{ status: number, body: unknown }} result The raw answer.
   * @returns {unknown} The parsed JSON body.
   */
  function requireJson(url, result) {
    if (result.body === undefined) {
      throw new HttpError(`Expected a JSON response from ${redactUrl(url)}`, {
        status: result.status,
        url: redactUrl(url),
      })
    }
    return result.body
  }

  /**
   * GET a JSON document.
   *
   * @param {string} url The absolute URL to request.
   * @param {{ headers?: Record<string, string>, signal?: AbortSignal, accept?: string }} [options] Request options.
   * @returns {Promise<unknown>} The parsed JSON body.
   */
  async function getJson(url, { headers, signal, accept } = {}) {
    const result = await request(url, { method: 'GET', headers, signal, accept })
    return requireJson(url, result)
  }

  /**
   * POST a form-encoded body and parse the JSON answer.
   *
   * @param {string} url The absolute URL to request.
   * @param {URLSearchParams | Record<string, string>} form The form body.
   * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options] Request options.
   * @returns {Promise<unknown>} The parsed JSON body.
   */
  async function postForm(url, form, { headers, signal } = {}) {
    const body = form instanceof URLSearchParams ? form : new URLSearchParams(form ?? {})
    const result = await request(url, {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers),
      body: body.toString(),
      signal,
    })
    return requireJson(url, result)
  }

  /**
   * POST a JSON body and parse the JSON answer.
   *
   * @param {string} url The absolute URL to request.
   * @param {unknown} body The JSON body.
   * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options] Request options.
   * @returns {Promise<unknown>} The parsed JSON body.
   */
  async function postJson(url, body, { headers, signal } = {}) {
    const result = await request(url, {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body ?? {}),
      signal,
    })
    return requireJson(url, result)
  }

  return { getJson, postForm, postJson, request }
}
