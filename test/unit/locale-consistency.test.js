/**
 * Tests of the locale tables.
 *
 * The plugin ships two languages, Simplified Chinese and English, in four
 * places: the server half (`lib/i18n/strings.js`), the three client modules
 * (`client/panel.js`, `client/toolview.js`, `client/commandview.js`), the
 * deployed browser copy (`client/index.js`) and the published locale files
 * (`locale/zh-CN.json`, `locale/en.json`).
 *
 * These tests keep the four places in agreement. A key that one language
 * lacks, a placeholder that one language spells differently, or a published
 * file that drifts from the table it was copied from is a defect the user
 * would see as a raw key or an empty box in the interface.
 *
 * @module dsh-oauth-mcp/test/unit/locale-consistency
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import * as serverStrings from '../../lib/i18n/strings.js'
import { PANEL_STRINGS } from '../../client/panel.js'
import { TOOLVIEW_STRINGS } from '../../client/toolview.js'
import { COMMANDVIEW_STRINGS } from '../../client/commandview.js'
import { createFakeReact } from '../support/fake-react.js'

/** The languages the plugin ships. */
const LOCALES = ['zh', 'en']

/** The published locale file of each language. */
const LOCALE_FILES = {
  zh: new URL('../../locale/zh-CN.json', import.meta.url),
  en: new URL('../../locale/en.json', import.meta.url),
}

/** The source of the deployed browser entry. */
const DEPLOYED_SOURCE = readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8')

/**
 * Collect the dictionaries a module exports.
 *
 * A dictionary is an object whose values are per-language tables of strings:
 * `{ zh: { key: text }, en: { key: text } }`. The locale lists and the key
 * lists the modules export are arrays and are therefore skipped.
 *
 * @param {object} namespace The module namespace.
 * @returns {object[]} The dictionaries, in export order.
 */
function collectDictionaries(namespace) {
  const found = []
  for (const value of Object.values(namespace)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const tables = Object.values(value)
    if (tables.length === 0) continue
    if (!tables.every((table) => table && typeof table === 'object' && !Array.isArray(table))) continue
    if (!tables.every((table) => Object.values(table).every((entry) => typeof entry === 'string'))) {
      continue
    }
    found.push(value)
  }
  return found
}

/**
 * Read the placeholders of a template.
 *
 * @param {string} template The template.
 * @returns {string[]} The placeholder names, sorted.
 */
function placeholders(template) {
  return [...String(template).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

/**
 * Merge the dictionaries of one language.
 *
 * @param {object[]} dictionaries The dictionaries.
 * @param {string} locale The language.
 * @returns {Record<string, string>} The merged table.
 */
function merged(dictionaries, locale) {
  const table = {}
  for (const dictionary of dictionaries) {
    for (const [key, value] of Object.entries(dictionary[locale] ?? {})) table[key] = value
  }
  return table
}

/**
 * Read the dictionaries the deployed browser entry registers.
 *
 * The deployed copy is a classic script, so it is evaluated the way the
 * browser evaluates it: the locale service captures the dictionaries the
 * entry registers.
 *
 * @returns {object[]} The captured dictionaries.
 */
function deployedDictionaries() {
  const manifests = []
  const evaluate = new Function('window', DEPLOYED_SOURCE)
  evaluate({ __ModuleLoader__: { load: (manifest) => manifests.push(manifest) } })
  assert.equal(manifests.length, 1, 'the entry registers exactly one module')

  const captured = []
  const module = manifests[0].factory((name) => {
    if (name === 'react') return createFakeReact()
    throw new Error(`unexpected require: ${name}`)
  })
  const services = {
    slots: { inject: () => {}, register: () => {} },
    configForms: { get: () => undefined },
    locale: {
      register: (_namespace, dictionaries) => {
        captured.push(dictionaries)
        return () => {}
      },
      bind: () => (key) => key,
    },
  }
  const ctx = {
    get: (name) => services[name],
    effect: (factory) => {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on: () => () => {},
    ...services,
  }
  module.apply(ctx)
  return captured
}

/** Every table the plugin owns, split into the server half and the client half. */
const CLIENT_DICTIONARIES = [PANEL_STRINGS, TOOLVIEW_STRINGS, COMMANDVIEW_STRINGS]
const SERVER_DICTIONARIES = collectDictionaries(serverStrings)
const ALL_DICTIONARIES = [...SERVER_DICTIONARIES, ...CLIENT_DICTIONARIES]

/**
 * Find the keys an object literal declares twice.
 *
 * The deployed copy is a classic script, so a duplicate key inside one object
 * literal is silently collapsed by JavaScript: the later value wins and the
 * earlier one disappears without a warning. Only the source shows it. The scan
 * walks the braces, reads every quoted string and records the ones that are
 * followed by a colon, per object literal, so a key that two different
 * dictionaries share is not reported.
 *
 * @param {string} source The source to scan.
 * @returns {string[]} The duplicated keys.
 */
function findDuplicateKeys(source) {
  const duplicates = new Set()
  const scopes = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === '{') {
      scopes.push(new Set())
      index += 1
      continue
    }
    if (character === '}') {
      scopes.pop()
      index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      let end = index + 1
      while (end < source.length && source[end] !== quote) {
        end += source[end] === '\\' ? 2 : 1
      }
      const text = source.slice(index + 1, end)
      let after = end + 1
      while (after < source.length && /\s/.test(source[after])) after += 1
      if (source[after] === ':' && scopes.length > 0) {
        const scope = scopes[scopes.length - 1]
        if (scope.has(text)) duplicates.add(text)
        scope.add(text)
      }
      index = end + 1
      continue
    }
    index += 1
  }
  return [...duplicates]
}

describe('the locale tables', () => {
  it('ships exactly the two languages the host requires', () => {
    assert.deepEqual(LOCALES, ['zh', 'en'])
  })

  it('defines every dictionary in both languages', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      for (const locale of LOCALES) {
        assert.equal(typeof dictionary[locale], 'object', `the dictionary has a ${locale} table`)
        assert.ok(Object.keys(dictionary[locale]).length > 0, `the ${locale} table is not empty`)
      }
    }
  })

  it('defines the same keys in both languages', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      const chinese = Object.keys(dictionary.zh).sort()
      const english = Object.keys(dictionary.en).sort()
      assert.deepEqual(
        english,
        chinese,
        'both languages define the same keys, so no interface shows a raw key',
      )
    }
  })

  it('spells every placeholder the same way in both languages', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      for (const key of Object.keys(dictionary.zh)) {
        assert.deepEqual(
          placeholders(dictionary.en[key]),
          placeholders(dictionary.zh[key]),
          `the placeholders of "${key}" match in both languages`,
        )
      }
    }
  })

  it('uses distinct keys across the server half and the client half', () => {
    const server = new Set(Object.keys(merged(SERVER_DICTIONARIES, 'zh')))
    const client = new Set(Object.keys(merged(CLIENT_DICTIONARIES, 'zh')))
    for (const key of server) {
      assert.ok(!client.has(key), `the key "${key}" belongs to one half only`)
    }
  })
})

describe('the published locale files', () => {
  it('carry the display metadata the host reads', () => {
    for (const locale of LOCALES) {
      const file = JSON.parse(readFileSync(LOCALE_FILES[locale], 'utf8'))
      assert.equal(typeof file.meta?.title, 'string', `the ${locale} file names a title`)
      assert.ok(file.meta.title.length > 0, `the ${locale} title is not empty`)
      assert.equal(
        typeof file.meta?.description,
        'string',
        `the ${locale} file carries a description`,
      )
      assert.ok(file.meta.description.length > 0, `the ${locale} description is not empty`)
    }
  })

  it('carry the whole merged table of their language', () => {
    for (const locale of LOCALES) {
      const file = JSON.parse(readFileSync(LOCALE_FILES[locale], 'utf8'))
      const expected = merged(ALL_DICTIONARIES, locale)
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(
          file[key],
          value,
          `the ${locale} file carries the current text of "${key}"`,
        )
      }
    }
  })

  it('carry no key the tables do not know', () => {
    const known = new Set(Object.keys(merged(ALL_DICTIONARIES, 'zh')))
    for (const locale of LOCALES) {
      const file = JSON.parse(readFileSync(LOCALE_FILES[locale], 'utf8'))
      for (const key of Object.keys(file)) {
        if (key === 'meta') continue
        assert.ok(known.has(key), `the ${locale} file carries only known keys ("${key}")`)
      }
    }
  })
})

describe('the deployed browser copy', () => {
  it('registers the same dictionary as the client modules', () => {
    const captured = deployedDictionaries()
    assert.equal(captured.length, 1, 'the entry registers one locale namespace')
    const [dictionaries] = captured
    for (const locale of LOCALES) {
      const expected = merged(CLIENT_DICTIONARIES, locale)
      const actual = dictionaries[locale] ?? {}
      assert.deepEqual(
        Object.keys(actual).sort(),
        Object.keys(expected).sort(),
        `the deployed ${locale} dictionary holds the same keys as the client modules`,
      )
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(actual[key], value, `the deployed ${locale} text of "${key}" matches`)
      }
    }
  })

  it('declares every key only once', () => {
    const duplicates = findDuplicateKeys(DEPLOYED_SOURCE)
    assert.deepEqual(duplicates, [], 'no object literal declares a key twice')
  })
})
