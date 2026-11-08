/**
 * Tests of the credential key migration.
 *
 * The host refuses to read a credentials document whose keys do not obey the
 * `<scope>/<id>` grammar, and it refuses before this plugin is loaded, so the
 * migration has to work on the raw document text.
 *
 * @module dsh-oauth-mcp/test/unit/credential-migration
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isHostCredentialKey,
  migrateCredentialDocument,
  migratedKeyFor,
} from '../../lib/store/credential-migration.js'

describe('isHostCredentialKey', () => {
  it('accepts the shape the host accepts', () => {
    assert.equal(isHostCredentialKey('oauth-mcp/notion'), true)
    assert.equal(isHostCredentialKey('client-connection/browser-session'), true)
  })

  it('refuses the legacy colon shape', () => {
    assert.equal(isHostCredentialKey('oauth-mcp:notion'), false)
  })

  it('refuses a key with the wrong number of segments', () => {
    assert.equal(isHostCredentialKey('oauth-mcp'), false)
    assert.equal(isHostCredentialKey('oauth-mcp/a/b'), false)
  })

  it('refuses a segment the host would refuse', () => {
    assert.equal(isHostCredentialKey('oauth-mcp/my_server'), false)
    assert.equal(isHostCredentialKey('oauth-mcp/2fast'), false)
  })
})

describe('migratedKeyFor', () => {
  it('rewrites a legacy key of this plugin', () => {
    assert.equal(migratedKeyFor('oauth-mcp:notion'), 'oauth-mcp/notion')
  })

  it('normalizes a legacy id the host would refuse', () => {
    const migrated = migratedKeyFor('oauth-mcp:my_server')
    assert.match(migrated, /^oauth-mcp\/x-my-server-[0-9a-f]{8}$/)
  })

  it('leaves the key of another plugin alone', () => {
    assert.equal(migratedKeyFor('client-connection:browser-session'), null)
  })

  it('leaves a key that already obeys the grammar alone', () => {
    assert.equal(migratedKeyFor('oauth-mcp/notion'), null)
  })
})

describe('migrateCredentialDocument', () => {
  /** A document with one legacy key and one good key. */
  const DOCUMENT = [
    'version: 1',
    'refs:',
    '  MINIMAX_CN_API_KEY: "sk-cp-secret"',
    'records:',
    '  client-connection/browser-session:',
    '    kind: grant',
    '    payload:',
    '      secret: keep-me',
    '  oauth-mcp:notion:',
    '    kind: grant',
    '    payload:',
    '      serverId: notion',
    '      accessToken: token-value',
    '',
  ].join('\n')

  it('rewrites the legacy record key', () => {
    const result = migrateCredentialDocument(DOCUMENT)
    assert.deepEqual(result.migrated, [{ from: 'oauth-mcp:notion', to: 'oauth-mcp/notion' }])
    assert.match(result.text, /^ {2}oauth-mcp\/notion:$/m)
    assert.doesNotMatch(result.text, /oauth-mcp:notion/)
  })

  it('keeps every other line as it was', () => {
    const result = migrateCredentialDocument(DOCUMENT)
    for (const line of [
      'version: 1',
      '  MINIMAX_CN_API_KEY: "sk-cp-secret"',
      '  client-connection/browser-session:',
      '      secret: keep-me',
      '      accessToken: token-value',
    ]) {
      assert.ok(result.text.includes(line), `the line "${line}" is preserved`)
    }
  })

  it('does not touch the payload of a record', () => {
    const result = migrateCredentialDocument(DOCUMENT)
    assert.ok(result.text.includes('    kind: grant'))
    assert.ok(result.text.includes('      serverId: notion'))
  })

  it('reports a document that needs no repair', () => {
    const result = migrateCredentialDocument(DOCUMENT.replace('oauth-mcp:notion:', 'oauth-mcp/notion:'))
    assert.deepEqual(result.migrated, [])
    assert.equal(result.text, DOCUMENT.replace('oauth-mcp:notion:', 'oauth-mcp/notion:'))
  })

  it('reports the keys of other plugins it did not touch', () => {
    const document = ['records:', '  other-plugin:thing:', '    kind: grant', ''].join('\n')
    const result = migrateCredentialDocument(document)
    assert.deepEqual(result.migrated, [])
    assert.deepEqual(result.untouched, ['other-plugin:thing'])
    assert.equal(result.text, document)
  })

  it('leaves a document without records alone', () => {
    const document = ['version: 1', 'refs:', '  KEY: value', ''].join('\n')
    const result = migrateCredentialDocument(document)
    assert.deepEqual(result.migrated, [])
    assert.equal(result.text, document)
  })
})
