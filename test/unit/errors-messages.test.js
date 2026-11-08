/**
 * Tests of the human readable copy of the error codes.
 *
 * The copy itself lives in the language table of the server half; this test
 * pins the relation between the stable error codes and that table.
 *
 * @module dsh-oauth-mcp/test/unit/errors-messages
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { CALLBACK_CODES, ERROR_CODES, OAUTH_SERVER_CODES, PLUGIN_CODES } from '../../lib/oauth/errors.js'
import { SERVER_STRINGS } from '../../lib/i18n/strings.js'
import { DEFAULT_LOCALE } from '../../lib/i18n/index.js'
import { describeErrorCode } from '../../lib/errors-messages.js'

const CODES = Object.values(ERROR_CODES)
const known = new Set(CODES)

/**
 * Read the copy of one error code in one language.
 *
 * @param {string} code The error code.
 * @param {string} locale The language.
 * @returns {string} The sentence.
 */
function copy(code, locale) {
  return SERVER_STRINGS[locale][`error.${code}`]
}

test('every error code has a sentence in both languages', () => {
  for (const code of CODES) {
    for (const locale of ['zh', 'en']) {
      const sentence = copy(code, locale)
      assert.equal(typeof sentence, 'string', `missing copy for ${code} in ${locale}`)
      assert.ok(sentence.trim().length > 0, `empty copy for ${code} in ${locale}`)
    }
  }
})

test('the table carries no error code the error module does not know', () => {
  const known = new Set(CODES)
  for (const key of Object.keys(SERVER_STRINGS.zh)) {
    if (!key.startsWith('error.')) continue
    // `error.<code>.next` is the advice that belongs to a code, not a code.
    if (key.endsWith('.next')) continue
    assert.ok(known.has(key.slice('error.'.length)), `unknown code in the copy table: ${key}`)
  }
})

test('the two languages say different things', () => {
  for (const code of CODES) {
    assert.notEqual(copy(code, 'zh'), copy(code, 'en'), `same copy for ${code}`)
  }
})

test('the advice of the callback page names codes of the vocabulary', () => {
  for (const locale of ['zh', 'en']) {
    for (const key of Object.keys(SERVER_STRINGS[locale])) {
      if (!key.startsWith('error.') || !key.endsWith('.next')) continue
      const code = key.slice('error.'.length, -'.next'.length)
      if (code === 'default') continue
      assert.ok(
        known.has(code),
        `the callback page advises about ${code}, which is not a code of the vocabulary`,
      )
    }
  }
})

test('the callback page can advise about every code it shows', () => {
  // The codes the callback receiver and the host raise reach the page.
  for (const code of [...OAUTH_SERVER_CODES, ...CALLBACK_CODES]) {
    assert.ok(
      typeof SERVER_STRINGS.zh[`error.${code}.next`] === 'string',
      `the callback page has no advice for ${code}`,
    )
    assert.ok(
      typeof SERVER_STRINGS.en[`error.${code}.next`] === 'string',
      `the callback page has no advice for ${code}`,
    )
  }
})

test('every code of the vocabulary has an advice', () => {
  // The callback page shows whatever code it is given, so every code of the
  // vocabulary needs a sentence that says what to do next.
  for (const code of CODES) {
    assert.equal(
      typeof SERVER_STRINGS.zh[`error.${code}.next`],
      'string',
      `the chinese advice of ${code} is missing`,
    )
    assert.equal(
      typeof SERVER_STRINGS.en[`error.${code}.next`],
      'string',
      `the english advice of ${code} is missing`,
    )
  }
})

test('the three groups of codes do not overlap', () => {
  // A code belongs to exactly one group: the plugin, the server or the
  // callback receiver.
  const groups = [PLUGIN_CODES, OAUTH_SERVER_CODES, CALLBACK_CODES]
  for (const code of CODES) {
    const owners = groups.filter((group) => group.has(code))
    assert.equal(owners.length, 1, `the code ${code} belongs to ${owners.length} groups`)
  }
  assert.equal(
    PLUGIN_CODES.size + OAUTH_SERVER_CODES.size + CALLBACK_CODES.size,
    CODES.length,
    'the three groups cover every code',
  )
})

test('describeErrorCode answers for every code of the vocabulary', () => {
  for (const code of CODES) {
    assert.notEqual(describeErrorCode(code, 'zh'), code, `no sentence for ${code}`)
  }
})

test('the copy never shows a secret', () => {
  for (const code of CODES) {
    const sentence = `${copy(code, 'zh')} ${copy(code, 'en')}`
    assert.ok(!/access_token|refresh_token|client_secret|code_verifier|Bearer /i.test(sentence), `secret in ${code}`)
  }
})

test('describeErrorCode answers in the requested locale', () => {
  const code = ERROR_CODES.network_error
  assert.equal(describeErrorCode(code, 'zh-CN'), copy(code, 'zh'))
  assert.equal(describeErrorCode(code, 'zh'), copy(code, 'zh'))
  assert.equal(describeErrorCode(code, 'zh-TW'), copy(code, 'zh'))
  assert.equal(describeErrorCode(code, 'en'), copy(code, 'en'))
  assert.equal(describeErrorCode(code, 'en-US'), copy(code, 'en'))
})

test('describeErrorCode defaults to the copy of the default locale', () => {
  const code = ERROR_CODES.state_expired
  assert.equal(describeErrorCode(code), copy(code, DEFAULT_LOCALE))
})

test('describeErrorCode falls back to the code itself', () => {
  assert.equal(describeErrorCode('not_a_real_code', 'zh-CN'), 'not_a_real_code')
  assert.equal(describeErrorCode('not_a_real_code', 'en'), 'not_a_real_code')
  assert.equal(describeErrorCode('', 'en'), '')
})
