import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { createPkce, createState, createStateStore, verifyState } from '../../lib/oauth/pkce.js'

/**
 * Build a deterministic random source.
 *
 * @param {number} [fill=7] The byte every position carries.
 * @returns {(size: number) => Buffer} The random source.
 */
function fixedRandom(fill = 7) {
  return (size) => Buffer.alloc(size, fill)
}

test('the code verifier is 43 base64url characters over 32 random bytes', () => {
  const pkce = createPkce(fixedRandom())

  assert.equal(pkce.codeVerifier.length, 43)
  assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]+$/)
  assert.equal(pkce.codeChallengeMethod, 'S256')
})

test('the code challenge is the base64url SHA-256 digest of the verifier', () => {
  const pkce = createPkce(fixedRandom())

  const expected = createHash('sha256').update(pkce.codeVerifier, 'utf8').digest('base64url')

  assert.equal(pkce.codeChallenge, expected)
})

test('two code verifiers differ', () => {
  const first = createPkce()
  const second = createPkce()

  assert.notEqual(first.codeVerifier, second.codeVerifier)
})

test('a state value is a base64url string', () => {
  const state = createState(fixedRandom(3))

  assert.equal(state.length, 43)
  assert.match(state, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(createState(), createState())
})

test('the state comparison accepts the same value and refuses everything else', () => {
  assert.equal(verifyState('abc', 'abc'), true)
  assert.equal(verifyState('abc', 'abd'), false)
  assert.equal(verifyState('abc', ''), false)
  assert.equal(verifyState('', ''), false)
  assert.equal(verifyState('abc', undefined), false)
  assert.equal(verifyState(undefined, undefined), false)
  assert.equal(verifyState(123, '123'), false)
})

test('the state store issues a binding that can be read back', () => {
  const store = createStateStore({ now: () => 1000 })

  const issued = store.issue('server-a', {
    redirectUri: 'http://127.0.0.1:53219/callback',
    codeVerifier: 'verifier',
    scopes: ['read'],
    resource: 'https://mcp.example.com/mcp',
  })

  assert.equal(typeof issued.state, 'string')
  assert.equal(issued.issuedAt, 1000)
  assert.equal(issued.expiresAt, 1000 + 600_000)
  const binding = store.peek('server-a', issued.state)
  assert.equal(binding.redirectUri, 'http://127.0.0.1:53219/callback')
  assert.equal(binding.codeVerifier, 'verifier')
  assert.deepEqual(binding.scopes, ['read'])
  assert.equal(binding.resource, 'https://mcp.example.com/mcp')
})

test('a state belongs to exactly one server', () => {
  const store = createStateStore()
  const issued = store.issue('server-a', { redirectUri: 'http://127.0.0.1:1/cb', codeVerifier: 'v' })

  assert.equal(store.peek('server-b', issued.state), undefined)
  assert.equal(store.consume('server-b', issued.state).ok, false)
})

test('a state can be consumed only once', () => {
  const store = createStateStore()
  const issued = store.issue('server-a', { redirectUri: 'http://127.0.0.1:1/cb', codeVerifier: 'v' })

  const first = store.consume('server-a', issued.state)
  assert.equal(first.ok, true)
  assert.equal(first.binding.codeVerifier, 'v')

  const second = store.consume('server-a', issued.state)
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'state_invalid')
})

test('an expired state is refused with the expiry reason', () => {
  let clock = 1000
  const store = createStateStore({ ttlMs: 100, now: () => clock })
  const issued = store.issue('server-a', { redirectUri: 'http://127.0.0.1:1/cb', codeVerifier: 'v' })

  clock = 1200

  const consumed = store.consume('server-a', issued.state)
  assert.equal(consumed.ok, false)
  assert.equal(consumed.reason, 'state_expired')
  assert.equal(store.peek('server-a', issued.state), undefined)
})

test('an unknown state is refused with the invalid reason', () => {
  const store = createStateStore()

  const consumed = store.consume('server-a', 'never-issued')

  assert.equal(consumed.ok, false)
  assert.equal(consumed.reason, 'state_invalid')
})

test('clearing a server drops its pending states', () => {
  const store = createStateStore()
  const issued = store.issue('server-a', { redirectUri: 'http://127.0.0.1:1/cb', codeVerifier: 'v' })

  store.clear('server-a')

  assert.equal(store.peek('server-a', issued.state), undefined)
  assert.equal(store.consume('server-a', issued.state).ok, false)
})
