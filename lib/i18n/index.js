/**
 * The locale of the server half, and how it is decided.
 *
 * The server runs inside the DSH host process. The host keeps the language of
 * the interface in its settings document under the `locale` namespace, and the
 * plugin reads it from there. The client half writes the host's active locale
 * into the plugin's own settings namespace, so both halves of the plugin speak
 * the language of the interface even when the host keeps its own preference
 * somewhere else.
 *
 * The decision is made once per answer — once per command invocation, once per
 * tool render — and not once at start-up. A language change in the settings
 * therefore takes effect on the next command, and one answer never mixes two
 * languages.
 *
 * @module dsh-oauth-mcp/i18n/index
 */

import { LOCALES, SERVER_STRINGS } from './strings.js'
import { readConfigField } from '../util/config.js'

/**
 * The language the plugin uses when neither the client nor the host says.
 *
 * English is the fallback of the whole system, so it is the right default here
 * too: a host that speaks another language gets its own language from the
 * client half, and a host that says nothing gets the system fallback.
 *
 * @type {string}
 */
export const DEFAULT_LOCALE = 'en'

/**
 * The settings namespace the host stores the interface language in.
 *
 * @type {string}
 */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/**
 * The field inside that namespace.
 *
 * @type {string}
 */
export const LOCALE_SETTINGS_FIELD = 'preference'

/**
 * The settings namespace of this plugin.
 *
 * It is the profile entry id of the plugin: the host stores the fields the
 * client writes — the server list, the scopes, the locale — under it.
 *
 * @type {string}
 */
export const PLUGIN_SETTINGS_NAMESPACE = 'dsh-oauth-mcp'

/**
 * The field inside the plugin's own namespace that carries the locale.
 *
 * @type {string}
 */
export const PLUGIN_SETTINGS_FIELD = 'locale'

/**
 * Bring a locale identifier into the set the plugin ships.
 *
 * The host stores a BCP 47-style tag (`zh`, `zh-CN`, `en-US`, `ja`, …). The
 * plugin ships Simplified Chinese and English. A Chinese tag of any region is
 * Simplified Chinese here; everything else the plugin does not know is served
 * in English, which is the fallback of the whole system.
 *
 * @param {unknown} value The locale identifier.
 * @returns {string} One of {@link LOCALES}.
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return DEFAULT_LOCALE
  const tag = value.trim().toLowerCase()
  if (tag === '') return DEFAULT_LOCALE
  const language = tag.split('-')[0]
  if (language === 'zh') return 'zh'
  if (language === 'en') return 'en'
  return 'en'
}

/**
 * Build a translator for one language.
 *
 * A missing key returns the key itself, so a gap shows up in the interface
 * instead of an empty box.
 *
 * @param {string} locale The locale identifier.
 * @returns {(key: string, params?: Record<string, unknown>) => string} The translator.
 */
export function createTranslator(locale) {
  const dictionary = SERVER_STRINGS[normalizeLocale(locale)] ?? SERVER_STRINGS[DEFAULT_LOCALE]
  return (key, params) => {
    const template = dictionary[key]
    if (typeof template !== 'string') return key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    )
  }
}

/**
 * Read the language of the interface from the host settings.
 *
 * The host stores it in the `locale` namespace of its settings document; the
 * settings service hands it out with the other namespaces. Anything that goes
 * wrong here (no settings service, no entry, no value) means "the host did not
 * say", and the plugin uses its own default.
 *
 * @param {object} [settings] The host settings service.
 * @returns {string | undefined} The locale identifier, when the host has one.
 */
export function readHostLocale(settings) {
  try {
    const describe = settings?.describe
    if (typeof describe !== 'function') return undefined
    const namespaces = describe.call(settings)
    if (!Array.isArray(namespaces)) return undefined
    const entry = namespaces.find((row) => row?.ns === LOCALE_SETTINGS_NAMESPACE)
    const value = entry?.value?.[LOCALE_SETTINGS_FIELD]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  } catch {
    // The settings service is not reachable from here; the default applies.
    return undefined
  }
}

/**
 * Read the locale the client half wrote into the plugin's own settings.
 *
 * The client half knows the language of the interface and writes it into the
 * plugin's own namespace. The server half reads it back, so both halves of the
 * plugin speak the same language even when the host keeps its preference in a
 * different namespace than the one the client reads.
 *
 * The value is looked up in the settings document first and in the plugin
 * configuration second: the configuration is the copy the host committed into
 * the running plugin, so it survives a host that exposes no settings service.
 *
 * @param {object} [settings] The host settings service.
 * @param {object} [config] The plugin configuration.
 * @returns {string | undefined} The locale identifier, when the client wrote one.
 */
export function readPluginLocale(settings, config) {
  try {
    const describe = settings?.describe
    if (typeof describe === 'function') {
      const namespaces = describe.call(settings)
      if (Array.isArray(namespaces)) {
        const entry = namespaces.find((row) => row?.ns === PLUGIN_SETTINGS_NAMESPACE)
        const value = entry?.value?.[PLUGIN_SETTINGS_FIELD]
        if (typeof value === 'string' && value.trim() !== '') return value
      }
    }
  } catch {
    // The settings service is not reachable from here; the configuration below
    // may still carry the locale.
  }
  try {
    // The field is declared volatile by the host, so it arrives as a stable
    // reference; `readConfigField` reads the current value out of it.
    const value = readConfigField(config?.[PLUGIN_SETTINGS_FIELD])
    if (typeof value === 'string' && value.trim() !== '') return value
  } catch {
    // A configuration field that cannot be read simply does not name a locale.
  }
  return undefined
}

/**
 * Decide the language of the server half.
 *
 * The order is fixed, so both halves of the plugin and the host always agree:
 * an explicit preference wins, then the locale the client half wrote into the
 * plugin's own namespace, then the language of the host interface, and finally
 * the plugin's own default.
 *
 * @param {object} [options] The options.
 * @param {object} [options.settings] The host settings service.
 * @param {object} [options.config] The plugin configuration.
 * @param {string} [options.preference] An explicit preference that wins over the host.
 * @returns {string} One of {@link LOCALES}.
 */
export function resolveLocale(options = {}) {
  const explicit = options.preference
  if (typeof explicit === 'string' && explicit.trim() !== '') return normalizeLocale(explicit)
  const fromPlugin = readPluginLocale(options.settings, options.config)
  if (fromPlugin !== undefined) return normalizeLocale(fromPlugin)
  const fromHost = readHostLocale(options.settings)
  if (fromHost !== undefined) return normalizeLocale(fromHost)
  return DEFAULT_LOCALE
}

/**
 * Build the translator of the language the server half speaks right now.
 *
 * The locale is resolved on every call, so a language change in the settings
 * takes effect on the next answer instead of at the next restart.
 *
 * @param {object} [options] The options of {@link resolveLocale}.
 * @returns {(key: string, params?: Record<string, unknown>) => string} The translator.
 */
export function resolveTranslator(options = {}) {
  return createTranslator(resolveLocale(options))
}

export { LOCALES, SERVER_STRINGS }
