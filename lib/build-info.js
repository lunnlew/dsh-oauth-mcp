/**
 * Build stamp of the plugin.
 *
 * The host loads a plugin into the running process once; a linked source
 * directory does not hot-reload. When a user reports behaviour that the current
 * source does not have, the stamp tells the two apart: the stamp printed by
 * `/oauth-mcp status` is the one the *running* host actually executes.
 */
import { createTranslator } from './i18n/index.js'

/** The name of the plugin. It names the client in every OAuth request. */
export const PLUGIN_ID = 'dsh-oauth-mcp'

/** The version of the plugin. It is reported to every server it talks to. */
export const PLUGIN_VERSION = '0.0.2'

/**
 * Short marker of the current source revision. Bump it whenever the behaviour
 * of the user facing surfaces (commands, tools, panel, callback pages) changes.
 */
export const BUILD_STAMP = '2026-11-08-release-timer-fix'

/**
 * One line that names the version and the build of the running code.
 *
 * @param {string} [locale] The locale of the line.
 * @returns {string} The build line.
 */
export function buildLine(locale) {
  const t = createTranslator(locale)
  return t('server.build.line', { version: PLUGIN_VERSION, build: BUILD_STAMP })
}

/**
 * A short tag that fits into an error message.
 *
 * @param {string} [locale] The locale of the tag.
 * @returns {string} The build tag.
 */
export function buildTag(locale) {
  const t = createTranslator(locale)
  return t('server.build.tag', { build: BUILD_STAMP })
}
