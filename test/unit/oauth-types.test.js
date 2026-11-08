/**
 * Tests of the shared value shapes.
 *
 * The module is pure: constants, parsers and the payload factory. The parser
 * of the scopes and the lifetime of the token decide what the plugin asks
 * for and when it refreshes, so they are pinned here.
 *
 * @module dsh-oauth-mcp/test/unit/oauth-types
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { PLUGIN_ID, PLUGIN_VERSION } from '../../lib/build-info.js'
import {
  CLIENT_NAME,
  DEFAULT_REFRESH_SKEW_MS,
  SOFTWARE_ID,
  SOFTWARE_VERSION,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  TOKEN_ENDPOINT_AUTH_METHODS,
  computeExpiresAt,
  createGrantPayload,
  formatScope,
  hasRefreshToken,
  isExpired,
  mergeTokenResponse,
  parseScope,
} from '../../lib/oauth/types.js'

test('the client identifies itself with the version of the plugin', () => {
  assert.equal(SOFTWARE_ID, PLUGIN_ID)
  assert.equal(SOFTWARE_VERSION, PLUGIN_VERSION)
  assert.equal(CLIENT_NAME, `DSH (${PLUGIN_ID})`)
})

test('the plugin asks for the grant types and the response type it supports', () => {
  assert.deepEqual([...SUPPORTED_GRANT_TYPES], ['authorization_code', 'refresh_token'])
  assert.deepEqual([...SUPPORTED_RESPONSE_TYPES], ['code'])
  assert.ok(TOKEN_ENDPOINT_AUTH_METHODS.includes('none'))
  assert.ok(TOKEN_ENDPOINT_AUTH_METHODS.includes('client_secret_basic'))
})

test('a scope string is split on spaces and plus signs', () => {
  assert.deepEqual(parseScope('read write'), ['read', 'write'])
  assert.deepEqual(parseScope('read+write'), ['read', 'write'])
  assert.deepEqual(parseScope('  read   write  '), ['read', 'write'])
  assert.deepEqual(parseScope(['read', 'write']), ['read', 'write'])
  assert.deepEqual(parseScope(''), [])
  assert.deepEqual(parseScope(undefined), [])
  assert.deepEqual(parseScope(42), [])
})

test('the scopes are joined with a space', () => {
  assert.equal(formatScope(['read', 'write']), 'read write')
  assert.equal(formatScope(['read', '', 'write']), 'read write')
  assert.equal(formatScope('read write'), '')
})

test('a lifetime becomes an absolute expiry', () => {
  assert.equal(computeExpiresAt(3600, 1_000), 3_601_000)
  assert.equal(computeExpiresAt(0, 1_000), 1_000)
  assert.equal(computeExpiresAt(-10, 1_000), 1_000)
  assert.equal(computeExpiresAt(undefined), undefined)
  assert.equal(computeExpiresAt('3600'), undefined)
  assert.equal(computeExpiresAt(Number.NaN), undefined)
})

test('a grant without a lifetime does not expire', () => {
  assert.equal(isExpired(undefined), false)
  assert.equal(isExpired({ accessToken: 'x' }), false)
  assert.equal(isExpired({ expiresAt: Date.now() + 3_600_000 }), false)
})

test('a grant is refreshed before it really expires', () => {
  const now = 1_000_000
  const expiresAt = now + DEFAULT_REFRESH_SKEW_MS - 1
  assert.equal(isExpired({ expiresAt }, { now }), true)
  assert.equal(isExpired({ expiresAt: now + DEFAULT_REFRESH_SKEW_MS + 1 }, { now }), false)
  assert.equal(isExpired({ expiresAt: now + 100 }, { now, skewMs: 0 }), false)
})

test('a refresh token is only reported when there is one', () => {
  assert.equal(hasRefreshToken({ refreshToken: 'r' }), true)
  assert.equal(hasRefreshToken({ refreshToken: '' }), false)
  assert.equal(hasRefreshToken({}), false)
  assert.equal(hasRefreshToken(undefined), false)
})

test('the stored payload carries the token and nothing else by accident', () => {
  const payload = createGrantPayload({
    serverId: 'notion',
    serverUrl: 'https://mcp.notion.com/mcp',
    resource: 'https://mcp.notion.com/mcp',
    clientId: 'the-client-id',
    accessToken: 'the-token',
    scopes: 'read write',
    obtainedAt: 1_000,
  })

  assert.equal(payload.serverId, 'notion')
  assert.equal(payload.accessToken, 'the-token')
  assert.equal(payload.tokenType, 'Bearer')
  assert.deepEqual(payload.scopes, ['read', 'write'])
  assert.equal(payload.obtainedAt, 1_000)
  assert.equal(payload.expiresAt, undefined)
  assert.equal(payload.clientSecret, undefined)
  assert.equal(payload.refreshToken, undefined)
})

test('the optional fields of the payload are only there when they are given', () => {
  const payload = createGrantPayload({
    serverId: 'notion',
    serverUrl: 'https://mcp.notion.com/mcp',
    resource: 'https://mcp.notion.com/mcp',
    clientId: 'the-client-id',
    accessToken: 'the-token',
    clientSecret: 'the-secret',
    refreshToken: 'the-refresh',
    issuer: 'https://mcp.notion.com',
    expiresIn: 3600,
    obtainedAt: 1_000,
  })

  assert.equal(payload.clientSecret, 'the-secret')
  assert.equal(payload.refreshToken, 'the-refresh')
  assert.equal(payload.issuer, 'https://mcp.notion.com')
  assert.equal(payload.expiresAt, 3_601_000)
})

test('a refresh response keeps the refresh token it does not repeat', () => {
  const stored = {
    serverId: 'notion',
    accessToken: 'old',
    refreshToken: 'the-refresh',
    scopes: ['read'],
    obtainedAt: 1,
  }

  const merged = mergeTokenResponse(stored, { access_token: 'new' }, { now: 5 })

  assert.equal(merged.accessToken, 'new')
  assert.equal(merged.refreshToken, 'the-refresh')
  assert.deepEqual(merged.scopes, ['read'])
  assert.equal(merged.obtainedAt, 5)
  assert.equal(merged.expiresAt, undefined)
})

test('a refresh response replaces the scopes it names', () => {
  const stored = { serverId: 'notion', accessToken: 'old', scopes: ['read'] }

  const merged = mergeTokenResponse(stored, { access_token: 'new', scope: 'read write' }, { now: 5 })

  assert.deepEqual(merged.scopes, ['read', 'write'])
})

test('a refresh response drops the expiry it does not name', () => {
  const stored = { serverId: 'notion', accessToken: 'old', expiresAt: 10 }

  const merged = mergeTokenResponse(stored, { access_token: 'new' }, { now: 5 })

  assert.equal(merged.expiresAt, undefined)
})

test('a refresh response clears the last error', () => {
  const stored = { serverId: 'notion', accessToken: 'old', lastError: 'it failed' }

  const merged = mergeTokenResponse(stored, { access_token: 'new' }, { now: 5 })

  assert.equal(merged.lastError, undefined)
})
