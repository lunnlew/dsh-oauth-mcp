/**
 * Tests of the language table and of the way the server half decides which
 * language it speaks.
 *
 * The table is the only place a sentence of the server half lives, and the
 * resolution order decides whether the server half and the client half speak
 * the same language. Both are pinned here: a key one language lacks shows up
 * as a raw key in the interface, and a wrong resolution order makes the two
 * halves of the plugin disagree.
 *
 * @module dsh-oauth-mcp/test/unit/locale-keys
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ERROR_CODES } from '../../lib/oauth/errors.js'
import { LOCALES, SERVER_STRINGS } from '../../lib/i18n/strings.js'
import {
  DEFAULT_LOCALE,
  LOCALE_SETTINGS_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  PLUGIN_SETTINGS_FIELD,
  PLUGIN_SETTINGS_NAMESPACE,
  createTranslator,
  normalizeLocale,
  readHostLocale,
  readPluginLocale,
  resolveLocale,
} from '../../lib/i18n/index.js'
import { ENTRY_ID } from '../../index.js'

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
 * Build a stub of the host settings service.
 *
 * @param {object[]} rows The namespaces the service describes.
 * @returns {object} The stub.
 */
function settingsWith(rows) {
  return { describe: () => rows }
}

/**
 * Build one row of the settings document.
 *
 * @param {string} ns The namespace.
 * @param {object} value The value of the namespace.
 * @returns {object} The row.
 */
function row(ns, value) {
  return { ns, schema: {}, revision: 0, applies: true, value, base: {}, user: {} }
}

test('the plugin ships exactly the two languages the host requires', () => {
  assert.deepEqual([...LOCALES], ['zh', 'en'])
})

test('the default language is the fallback of the whole system', () => {
  assert.equal(DEFAULT_LOCALE, 'en')
})

test('both languages define the same keys', () => {
  assert.deepEqual(Object.keys(SERVER_STRINGS.en).sort(), Object.keys(SERVER_STRINGS.zh).sort())
})

test('the placeholders match in both languages', () => {
  for (const key of Object.keys(SERVER_STRINGS.zh)) {
    assert.deepEqual(
      placeholders(SERVER_STRINGS.en[key]),
      placeholders(SERVER_STRINGS.zh[key]),
      `the placeholders of "${key}" match in both languages`,
    )
  }
})

test('every key belongs to one of the three namespaces', () => {
  for (const key of Object.keys(SERVER_STRINGS.zh)) {
    const namespace = key.split('.')[0]
    assert.ok(
      ['server', 'error', 'callback'].includes(namespace),
      `the key "${key}" belongs to a known namespace`,
    )
  }
})

test('every error code has a key and no other error key exists', () => {
  const known = new Set(Object.values(ERROR_CODES))
  for (const code of known) {
    assert.equal(typeof SERVER_STRINGS.zh[`error.${code}`], 'string', `the code "${code}" has chinese copy`)
    assert.equal(typeof SERVER_STRINGS.en[`error.${code}`], 'string', `the code "${code}" has english copy`)
  }
  for (const key of Object.keys(SERVER_STRINGS.zh)) {
    if (!key.startsWith('error.')) continue
    // `error.<code>.next` is the advice that belongs to a code, not a code.
    if (key.endsWith('.next')) continue
    assert.ok(known.has(key.slice('error.'.length)), `the key "${key}" names a known error code`)
  }
})

test('a chinese tag of any region is chinese and everything else is english', () => {
  assert.equal(normalizeLocale('zh'), 'zh')
  assert.equal(normalizeLocale('zh-CN'), 'zh')
  assert.equal(normalizeLocale('zh-TW'), 'zh')
  assert.equal(normalizeLocale('en'), 'en')
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('ja'), 'en')
  assert.equal(normalizeLocale(''), DEFAULT_LOCALE)
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE)
})

test('the plugin namespace is the entry id of the plugin', () => {
  assert.equal(PLUGIN_SETTINGS_NAMESPACE, ENTRY_ID)
  assert.equal(PLUGIN_SETTINGS_FIELD, 'locale')
  assert.equal(LOCALE_SETTINGS_NAMESPACE, 'locale')
  assert.equal(LOCALE_SETTINGS_FIELD, 'preference')
})

test('the host keeps the language of the interface in its own namespace', () => {
  const settings = settingsWith([row(LOCALE_SETTINGS_NAMESPACE, { preference: 'zh-CN' })])
  assert.equal(readHostLocale(settings), 'zh-CN')
  assert.equal(readHostLocale(settingsWith([])), undefined)
  assert.equal(readHostLocale(undefined), undefined)
})

test('the client writes the locale into the namespace of the plugin', () => {
  const settings = settingsWith([row(PLUGIN_SETTINGS_NAMESPACE, { locale: 'zh-CN' })])
  assert.equal(readPluginLocale(settings), 'zh-CN')
  assert.equal(readPluginLocale(settingsWith([row(PLUGIN_SETTINGS_NAMESPACE, { locale: '' })])), undefined)
  assert.equal(readPluginLocale(settingsWith([])), undefined)
})

test('the configuration is the second source of the locale of the plugin', () => {
  assert.equal(readPluginLocale(undefined, { locale: 'zh-CN' }), 'zh-CN')
  assert.equal(readPluginLocale(undefined, { locale: '' }), undefined)
  assert.equal(readPluginLocale(settingsWith([]), { locale: 'zh' }), 'zh')
})

test('a volatile configuration field carries the locale of the client', () => {
  // The host commits a volatile field into a stable reference, so the plugin
  // has to read the value out of the reference and not out of the field.
  const volatile = { get: () => 'zh-CN' }
  assert.equal(readPluginLocale(undefined, { locale: volatile }), 'zh-CN')
  assert.equal(readPluginLocale(settingsWith([]), { locale: volatile }), 'zh-CN')
  assert.equal(resolveLocale({ config: { locale: volatile } }), 'zh')
})

test('an explicit preference wins over everything else', () => {
  const settings = settingsWith([
    row(PLUGIN_SETTINGS_NAMESPACE, { locale: 'en' }),
    row(LOCALE_SETTINGS_NAMESPACE, { preference: 'en' }),
  ])
  assert.equal(resolveLocale({ preference: 'zh-CN', settings }), 'zh')
})

test('the locale of the plugin wins over the language of the interface', () => {
  const settings = settingsWith([
    row(PLUGIN_SETTINGS_NAMESPACE, { locale: 'zh-CN' }),
    row(LOCALE_SETTINGS_NAMESPACE, { preference: 'en-US' }),
  ])
  assert.equal(resolveLocale({ settings }), 'zh')
})

test('the language of the interface is used when the client wrote nothing', () => {
  const settings = settingsWith([row(LOCALE_SETTINGS_NAMESPACE, { preference: 'zh-CN' })])
  assert.equal(resolveLocale({ settings }), 'zh')
})

test('the default is used when nobody says anything', () => {
  assert.equal(resolveLocale({}), DEFAULT_LOCALE)
  assert.equal(resolveLocale({ settings: settingsWith([]) }), DEFAULT_LOCALE)
  assert.equal(resolveLocale({ settings: undefined }), DEFAULT_LOCALE)
})

test('the translator falls back to the key itself when a key is missing', () => {
  const t = createTranslator('en')
  assert.equal(t('server.does.not.exist'), 'server.does.not.exist')
  assert.equal(t('server.build.line', { version: '1', build: '2' }), 'Plugin version 1 (build 2)')
})

test('the translator fills the placeholders of the language it was built for', () => {
  const zh = createTranslator('zh')
  const en = createTranslator('en')
  assert.ok(zh('server.authorize.open', { label: 'Notion' }).includes('Notion'))
  assert.ok(en('server.authorize.open', { label: 'Notion' }).includes('Notion'))
  assert.notEqual(zh('server.authorize.open', { label: 'Notion' }), en('server.authorize.open', { label: 'Notion' }))
})
