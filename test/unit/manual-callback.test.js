import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createManualCallback, parseManualCallback } from '../../lib/callback/manual.js'
import { CallbackError } from '../../lib/oauth/errors.js'

test('the manual callback parses a full callback URL', () => {
  const parsed = parseManualCallback(
    'http://127.0.0.1:39271/oauth-mcp/callback?code=the-code&state=the-state',
  )

  assert.equal(parsed.code, 'the-code')
  assert.equal(parsed.state, 'the-state')
  assert.equal(parsed.error, undefined)
})

test('the manual callback parses a bare query string', () => {
  const parsed = parseManualCallback('code=the-code&state=the-state')

  assert.equal(parsed.code, 'the-code')
  assert.equal(parsed.state, 'the-state')
})

test('the manual callback parses a query string with a leading question mark', () => {
  const parsed = parseManualCallback('?code=the-code&state=the-state')

  assert.equal(parsed.code, 'the-code')
  assert.equal(parsed.state, 'the-state')
})

test('the manual callback parses parameters in the fragment of the URL', () => {
  const parsed = parseManualCallback(
    'http://127.0.0.1:39271/oauth-mcp/callback#code=the-code&state=the-state',
  )

  assert.equal(parsed.code, 'the-code')
  assert.equal(parsed.state, 'the-state')
})

test('the manual callback strips quotes around the pasted text', () => {
  const parsed = parseManualCallback('"code=the-code&state=the-state"')

  assert.equal(parsed.code, 'the-code')
  assert.equal(parsed.state, 'the-state')
})

test('the manual callback rejects a paste without a code', () => {
  assert.throws(() => parseManualCallback('state=the-state'), CallbackError)
})

test('the manual callback rejects a paste without a state', () => {
  assert.throws(() => parseManualCallback('code=the-code'), CallbackError)
})

test('the manual callback rejects an empty paste', () => {
  assert.throws(() => parseManualCallback('   '), CallbackError)
})

test('the manual callback rejects a paste that is not a string', () => {
  assert.throws(() => parseManualCallback(42), TypeError)
})

test('the manual callback reports an OAuth error instead of throwing', () => {
  const parsed = parseManualCallback(
    'http://127.0.0.1:39271/oauth-mcp/callback?error=access_denied&error_description=The+user+said+no&state=the-state',
  )

  assert.equal(parsed.error, 'access_denied')
  assert.equal(parsed.errorDescription, 'The user said no')
  assert.equal(parsed.state, 'the-state')
  assert.equal(parsed.code, '')
})

test('the manual callback hands the parsed result to the caller', async () => {
  const results = []
  const manual = createManualCallback({ onResult: (result) => results.push(result) })

  const parsed = await manual.complete('code=the-code&state=the-state')

  assert.equal(parsed.code, 'the-code')
  assert.equal(results.length, 1)
  assert.equal(results[0].state, 'the-state')
})

test('the manual callback reports a cancellation', async () => {
  const results = []
  const manual = createManualCallback({ onResult: (result) => results.push(result) })

  const outcome = await manual.cancel()

  assert.deepEqual(outcome, { cancelled: true })
  assert.deepEqual(results, [{ cancelled: true }])
})

test('the manual callback accepts only one result', async () => {
  const manual = createManualCallback({ onResult: () => {} })

  await manual.complete('code=the-code&state=the-state')
  await assert.rejects(() => manual.complete('code=other&state=other'), CallbackError)
  await assert.rejects(() => manual.cancel(), CallbackError)
})

test('the manual callback needs a result callback', () => {
  assert.throws(() => createManualCallback({}), TypeError)
})
