/**
 * Tests of the redaction helpers.
 *
 * Every value that leaves the plugin passes through these helpers first, so
 * a gap in them is a leak. The helpers were untested for a long time, and
 * two of them did not agree on which names are secret: the key list held
 * `set-cookie` while the comparison normalised dashes into underscores, so
 * the value behind that key was never redacted.
 *
 * @module dsh-oauth-mcp/test/unit/redact
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REDACTED,
  isSensitiveKey,
  redact,
  redactText,
  redactUrl,
} from '../../lib/util/redact.js'

test('a key that names a secret is recognised, whatever its spelling', () => {
  assert.equal(isSensitiveKey('access_token'), true)
  assert.equal(isSensitiveKey('Access-Token'), true)
  assert.equal(isSensitiveKey('set-cookie'), true)
  assert.equal(isSensitiveKey('set_cookie'), true)
  assert.equal(isSensitiveKey('proxy-authorization'), true)
  assert.equal(isSensitiveKey('Proxy Authorization'), true)
  assert.equal(isSensitiveKey('code'), true)
  assert.equal(isSensitiveKey('state'), true)
  assert.equal(isSensitiveKey('label'), false)
  assert.equal(isSensitiveKey(''), false)
  assert.equal(isSensitiveKey(undefined), false)
})

test('the value behind a secret key is redacted', () => {
  assert.deepEqual(
    redact({ 'set-cookie': 'session=supersecret', label: 'the server' }),
    { 'set-cookie': REDACTED, label: 'the server' },
  )
  assert.deepEqual(
    redact({ code: 'the-authorization-code', state: 'the-state' }),
    { code: REDACTED, state: REDACTED },
  )
})

test('a secret in free text is redacted', () => {
  assert.equal(redactText('state=abc123XYZ&code=SECRETCODE').includes('SECRETCODE'), false)
  assert.equal(redactText('the authorization code=SECRETCODE was refused').includes('SECRETCODE'), false)
  assert.equal(redactText('access_token=the-token').includes('the-token'), false)
  assert.equal(redactText('client_secret: the-secret').includes('the-secret'), false)
  assert.equal(redactText('password=hunter2').includes('hunter2'), false)
  assert.equal(redactText('Bearer the-access-token').includes('the-access-token'), false)
})

test('a code verifier is redacted as a whole and not as a code', () => {
  const redacted = redactText('code_verifier=the-verifier-value')
  assert.equal(redacted.includes('the-verifier-value'), false)
  assert.ok(redacted.startsWith('code_verifier='), 'the name of the field survives')
})

test('a URL keeps its shape and loses its secrets', () => {
  const redacted = redactUrl('https://as.example.com/callback?code=the-code&state=the-state&scope=read')
  assert.equal(redacted.includes('the-code'), false)
  assert.equal(redacted.includes('the-state'), false)
  assert.ok(redacted.startsWith('https://as.example.com/callback?'), 'the address survives')
  assert.ok(redacted.includes('scope=read'), 'the scope is not a secret')
  assert.equal(
    redactUrl('https://user:pass@as.example.com/token'),
    'https://as.example.com/token',
  )
  assert.equal(redactUrl('not a url'), REDACTED)
})

test('text that is not a string is redacted into nothing', () => {
  assert.equal(redactText(undefined), '')
  assert.equal(redactText(''), '')
  assert.equal(redactText(42), '')
})
