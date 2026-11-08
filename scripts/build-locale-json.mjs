/**
 * Write the published locale files from the tables of the plugin.
 *
 * The host reads `meta.title` and `meta.description` from `locale/en.json` and
 * `locale/zh-CN.json`. The rest of those files is the merged dictionary of the
 * plugin: the interface copy of the browser half and the output copy of the
 * server half. That dictionary was written into the files by hand, and a hand
 * written copy drifts from the tables it was copied from, so it is generated
 * here instead. The display metadata is kept as it is: the host shows it, and
 * it is not part of the dictionary.
 *
 * Usage: `node scripts/build-locale-json.mjs`
 *
 * @module dsh-oauth-mcp/scripts/build-locale-json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COMMANDVIEW_STRINGS } from '../client/commandview.js'
import { PANEL_STRINGS } from '../client/panel.js'
import { TOOLVIEW_STRINGS } from '../client/toolview.js'
import * as serverStrings from '../lib/i18n/strings.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** The languages the plugin ships. */
const LOCALES = ['zh', 'en']

/** The published file of each language. */
const FILES = {
  zh: join(root, 'locale', 'zh-CN.json'),
  en: join(root, 'locale', 'en.json'),
}

/**
 * Collect the dictionaries of the browser half.
 *
 * @returns {object[]} The dictionaries, each with a table per language.
 */
function clientDictionaries() {
  return [PANEL_STRINGS, TOOLVIEW_STRINGS, COMMANDVIEW_STRINGS]
}

/**
 * Collect the tables of the server half.
 *
 * The server module groups its tables by language, so every table of every
 * export is one language of one dictionary. A flat dictionary of strings
 * belongs to every language.
 *
 * @param {object} namespace The module namespace of the server strings.
 * @returns {object[]} The tables, each with the language it belongs to.
 */
function serverTables(namespace) {
  const found = []
  for (const value of Object.values(namespace)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entries = Object.entries(value)
    if (entries.length === 0) continue
    const grouped = entries.every(
      ([, entry]) => entry && typeof entry === 'object' && !Array.isArray(entry),
    )
    if (grouped) {
      for (const [locale, table] of Object.entries(value)) found.push({ locale, table })
      continue
    }
    if (entries.every(([, entry]) => typeof entry === 'string')) {
      for (const locale of LOCALES) found.push({ locale, table: value })
    }
  }
  return found
}

/**
 * Merge the dictionary of one language.
 *
 * The two halves use disjoint key namespaces, so the order of the halves
 * cannot change a value.
 *
 * @param {object[]} clients The dictionaries of the browser half.
 * @param {object[]} servers The tables of the server half.
 * @param {string} locale The language.
 * @returns {Record<string, string>} The merged dictionary.
 */
function mergeDictionaries(clients, servers, locale) {
  const table = {}
  for (const dictionary of clients) {
    for (const [key, value] of Object.entries(dictionary[locale] ?? {})) table[key] = value
  }
  for (const entry of servers) {
    if (entry.locale !== locale) continue
    for (const [key, value] of Object.entries(entry.table)) table[key] = value
  }
  return table
}

const clients = clientDictionaries()
const servers = serverTables(serverStrings)

for (const locale of LOCALES) {
  const path = FILES[locale]
  const current = JSON.parse(readFileSync(path, 'utf8'))
  const meta = current.meta ?? {}
  const table = mergeDictionaries(clients, servers, locale)
  const file = { meta, ...table }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  process.stdout.write(`wrote locale file of ${locale} with ${Object.keys(table).length} keys\n`)
}
