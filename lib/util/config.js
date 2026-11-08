/**
 * Reading plugin configuration fields.
 *
 * The host resolves a plugin Config through Schemastery. A field declared
 * `.volatile()` resolves into a stable reference instead of a plain value: the
 * host commits a later edit into that same reference, so the running plugin
 * sees the new value through `reference.get()` without being restarted. An
 * ordinary field resolves into a plain value.
 *
 * Every consumer of a configuration field therefore goes through
 * `readConfigField`, which accepts both shapes. That keeps the plugin working
 * against a host that resolves the field as a plain value, and it keeps the
 * unit tests free of host plumbing.
 *
 * @module dsh-oauth-mcp/util/config
 */

/**
 * Report whether a value is a volatile configuration reference.
 *
 * @param {unknown} value The candidate.
 * @returns {boolean} Whether the value carries a `get()` accessor.
 */
export function isVolatileReference(value) {
  return Boolean(value) && typeof value === 'object' && typeof (/** @type {{ get?: unknown }} */ (value).get) === 'function'
}

/**
 * Read one configuration field.
 *
 * @param {unknown} value The resolved field: a plain value or a volatile
 *   reference.
 * @param {unknown} [fallback] The value to use when the field is absent.
 * @returns {unknown} The current value of the field.
 */
export function readConfigField(value, fallback = undefined) {
  if (isVolatileReference(value)) {
    const current = /** @type {{ get: () => unknown }} */ (value).get()
    return current === undefined ? fallback : current
  }
  return value === undefined ? fallback : value
}

/**
 * Read one configuration field as an array.
 *
 * @param {unknown} value The resolved field.
 * @param {unknown[]} [fallback] The value to use when the field is absent or is
 *   not an array.
 * @returns {unknown[]} The current array value of the field.
 */
export function readConfigArray(value, fallback = []) {
  const current = readConfigField(value, fallback)
  return Array.isArray(current) ? current : fallback
}
