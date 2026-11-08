/**
 * Tests for the credential key builder.
 *
 * The host reads every stored credential record as `<scope>/<id>`, where each
 * half is a lowercase, hyphen separated identifier that starts with a letter.
 * A record written under any other shape is refused when the credential
 * document is read again, which takes the `credentials` plugin — and with it
 * the whole desktop host — down. These tests pin the grammar down.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { CREDENTIAL_SCOPE, credentialIdFor, credentialKeyFor } from '../../lib/store/credential-key.js'

/** The grammar the host enforces on one half of a credential key. */
const SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

test('the credential key builder', async (t) => {
  await t.test('builds the key the host grammar demands', () => {
    const key = credentialKeyFor('notion')
    assert.equal(key, 'oauth-mcp/notion')
    const [scope, id] = key.split('/')
    assert.equal(scope, CREDENTIAL_SCOPE)
    assert.equal(SEGMENT_PATTERN.test(scope), true)
    assert.equal(SEGMENT_PATTERN.test(id), true)
  })

  await t.test('never emits the colon form the host refuses', () => {
    for (const serverId of ['notion', 'mock', 'alpha', 'my_server', '2fast', 'a.b']) {
      assert.equal(credentialKeyFor(serverId).includes(':'), false)
      assert.equal(credentialKeyFor(serverId).split('/').length, 2)
    }
  })

  await t.test('keeps a server id that is already a valid segment', () => {
    assert.equal(credentialIdFor('notion'), 'notion')
    assert.equal(credentialIdFor('my-server'), 'my-server')
    assert.equal(credentialIdFor('a1'), 'a1')
  })

  await t.test('normalizes a server id the host would refuse', () => {
    for (const serverId of ['my_server', '2fast', 'a.b', 'UPPER', 'with space']) {
      const id = credentialIdFor(serverId)
      assert.equal(SEGMENT_PATTERN.test(id), true, `"${serverId}" -> "${id}"`)
    }
  })

  await t.test('gives two different server ids two different keys', () => {
    const ids = ['my_server', 'my-server', 'my.server', 'a.b', 'a-b', '2fast', '2Fast']
    const keys = ids.map((id) => credentialKeyFor(id))
    assert.equal(new Set(keys).size, keys.length, `collision in ${keys.join(', ')}`)
  })

  await t.test('is stable, so a grant stays reachable across restarts', () => {
    assert.equal(credentialKeyFor('my_server'), credentialKeyFor('my_server'))
  })

  await t.test('refuses a server id that is not a non-empty string', () => {
    assert.throws(() => credentialKeyFor(''), TypeError)
    assert.throws(() => credentialKeyFor(undefined), TypeError)
    assert.throws(() => credentialKeyFor(null), TypeError)
  })
})
