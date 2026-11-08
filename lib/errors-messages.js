/**
 * Human-readable copy for every stable error code of the plugin.
 *
 * The copy itself lives in `lib/i18n/strings.js`, under the `error.*` keys of
 * the language table: an error code becomes a sentence a user can act on, and
 * that sentence exists exactly once, in every language the plugin ships. This
 * module only turns a code into a sentence.
 *
 * The sentences never mention a token, a code verifier, an authorization code
 * or a state value — they only explain what happened and what the user should
 * do next.
 *
 * @module dsh-oauth-mcp/errors-messages
 */

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js'

/**
 * The prefix of the keys that carry the copy of an error code.
 *
 * The key is named after the code itself, so a code without copy shows up as a
 * missing key instead of a silent fallback.
 *
 * @type {string}
 */
export const ERROR_KEY_PREFIX = 'error.'

/**
 * Describe an error code in the requested locale.
 *
 * @param {string} code A stable error code from `ERROR_CODES`.
 * @param {string} [locale] Locale identifier; `zh*` locales get the Chinese copy.
 * @returns {string} The localized sentence, or the code itself when unknown.
 */
export function describeErrorCode(code, locale = DEFAULT_LOCALE) {
  const key = `${ERROR_KEY_PREFIX}${String(code ?? '')}`
  const sentence = createTranslator(locale)(key)
  if (sentence === key) return String(code)
  return sentence
}
