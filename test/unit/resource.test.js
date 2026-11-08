import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canonicalResource } from '../../lib/oauth/resource.js'

test('the scheme, the host and the default port are normalised', () => {
  assert.equal(canonicalResource('http://Example.COM:80/mcp/'), 'http://example.com/mcp')
  assert.equal(canonicalResource('https://Example.COM:443/mcp'), 'https://example.com/mcp')
})

test('a non-default port is kept', () => {
  assert.equal(canonicalResource('https://example.com:8443/mcp'), 'https://example.com:8443/mcp')
})

test('the fragment is dropped', () => {
  assert.equal(canonicalResource('https://example.com/mcp#section'), 'https://example.com/mcp')
})

test('the query is kept', () => {
  assert.equal(canonicalResource('https://example.com/mcp?tenant=a'), 'https://example.com/mcp?tenant=a')
})

test('the trailing slashes are dropped, also at the root of a server', () => {
  // The MCP authorization profile asks for the form without the trailing
  // slash, also for the root of a server.
  assert.equal(canonicalResource('https://example.com/'), 'https://example.com')
  assert.equal(canonicalResource('https://example.com'), 'https://example.com')
  assert.equal(canonicalResource('https://example.com/mcp//'), 'https://example.com/mcp')
})

test('a value that is not a string is refused', () => {
  assert.throws(() => canonicalResource(undefined), TypeError)
  assert.throws(() => canonicalResource(42), TypeError)
  assert.throws(() => canonicalResource({}), TypeError)
})

test('a value that is not a parsable URL is refused', () => {
  assert.throws(() => canonicalResource('not a url'), TypeError)
  assert.throws(() => canonicalResource('/relative/path'), TypeError)
})
