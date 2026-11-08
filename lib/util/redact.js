/**
 * Redaction helpers.
 *
 * Every value that leaves this plugin — tool output, tool view text, log
 * lines, error messages — passes through these helpers first. The plugin
 * stores secrets in the host credential store and never in config, but a
 * token can still leak through a URL, a request body echo or a remote error
 * message; redaction is the second line of defence.
 *
 * @module dsh-oauth-mcp/util/redact
 */

/** Placeholder written in place of a redacted value. */
export const REDACTED = '[REDACTED]'

/**
 * Object keys whose values are always redacted.
 *
 * The names are written in the normalised form: a key is compared after its
 * dashes and spaces became underscores, so the list holds underscores too.
 *
 * @type {ReadonlyArray<string>}
 */
export const SENSITIVE_KEYS = Object.freeze([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'code_verifier',
  'code_challenge',
  'assertion',
  'password',
  'authorization',
  'proxy_authorization',
  'cookie',
  'set_cookie',
  'secret',
  'code',
  'state',
  'session_state',
  'token',
])

/**
 * The keys that name a secret, as one pattern.
 *
 * Every helper uses this pattern, so a name that is redacted in an object is
 * also redacted in a URL and in free text.
 */
const SENSITIVE_NAME_PATTERN = new RegExp(`^(?:${SENSITIVE_KEYS.join('|')})$`, 'i')

/**
 * The same names, as a pattern for `key=value` pairs in free text.
 *
 * The longer names come first, so `code_verifier` is matched as a whole and
 * not as `code` followed by something else.
 */
const SENSITIVE_TEXT_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEYS.slice().sort((a, b) => b.length - a.length).join('|')})\\s*[=:]\\s*"?[^\\s",&}]+"?`,
  'gi',
)

/**
 * Report whether a key names a secret.
 *
 * @param {unknown} key The object key.
 * @returns {boolean} Whether the value behind the key must be redacted.
 */
export function isSensitiveKey(key) {
  if (typeof key !== 'string') return false
  const normalized = key.toLowerCase().replace(/[-\s]/g, '_')
  return SENSITIVE_NAME_PATTERN.test(normalized)
}

const SENSITIVE_PARAM_PATTERN = SENSITIVE_NAME_PATTERN

/**
 * Strip secrets from a URL.
 *
 * Removes user information and every sensitive query parameter, and reports a
 * malformed URL as a fixed placeholder rather than echoing it back.
 *
 * @param {unknown} url The URL to redact.
 * @returns {string} The redacted URL.
 */
export function redactUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return ''
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return REDACTED
  }
  parsed.username = ''
  parsed.password = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_PARAM_PATTERN.test(key)) parsed.searchParams.set(key, REDACTED)
  }
  if (parsed.hash.length > 0) parsed.hash = ''
  return parsed.toString()
}

/**
 * Strip secrets from free text.
 *
 * Removes `Bearer`/`Basic` credentials, `key=value` pairs naming a secret,
 * and JSON-ish token fields.
 *
 * @param {unknown} text The text to redact.
 * @returns {string} The redacted text.
 */
export function redactText(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  let output = text
  output = output.replace(/\b(Bearer|Basic|DPoP)\s+[A-Za-z0-9\-._~+/=]+/gi, `$1 ${REDACTED}`)
  output = output.replace(SENSITIVE_TEXT_PATTERN, `$1=${REDACTED}`)
  return output
}

/**
 * Redact an arbitrary value.
 *
 * Objects are copied field by field: a field whose key names a secret is
 * replaced wholesale, every other string is scrubbed for inline credentials.
 *
 * @param {unknown} value The value to redact.
 * @param {{ key?: string, depth?: number }} [options] The key the value was found under.
 * @returns {unknown} The redacted value.
 */
export function redact(value, options = {}) {
  const depth = options.depth ?? 0
  if (depth > 8) return REDACTED
  if (options.key !== undefined && isSensitiveKey(options.key)) return REDACTED
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redact(item, { depth: depth + 1 }))
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redact(item, { key, depth: depth + 1 })
    }
    return result
  }
  return value
}

/**
 * Redact a URL for display without changing its shape.
 *
 * @param {unknown} url The URL.
 * @returns {string} The redacted URL.
 */
export function redactUrlForDisplay(url) {
  return redactUrl(url)
}
