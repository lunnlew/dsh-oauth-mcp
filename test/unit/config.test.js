/**
 * Tests of the configuration helpers.
 *
 * The host resolves a volatile Config field into a reference; an ordinary field
 * resolves into a plain value. Every reader has to accept both shapes.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isVolatileReference,
  readConfigArray,
  readConfigField,
} from '../../lib/util/config.js'

test('a plain value is not a volatile reference', () => {
  assert.equal(isVolatileReference('text'), false)
  assert.equal(isVolatileReference(42), false)
  assert.equal(isVolatileReference(null), false)
  assert.equal(isVolatileReference(undefined), false)
  assert.equal(isVolatileReference({}), false)
})

test('a reference with a get() accessor is a volatile reference', () => {
  assert.equal(isVolatileReference({ get: () => 1 }), true)
})

test('readConfigField returns a plain value unchanged', () => {
  assert.equal(readConfigField('text'), 'text')
  assert.equal(readConfigField(0), 0)
  assert.equal(readConfigField(false), false)
})

test('readConfigField unwraps a volatile reference', () => {
  let current = ['a']
  const reference = { get: () => current }
  assert.deepEqual(readConfigField(reference), ['a'])
  current = ['b']
  assert.deepEqual(readConfigField(reference), ['b'])
})

test('readConfigField falls back for an absent value', () => {
  assert.equal(readConfigField(undefined, 'fallback'), 'fallback')
  assert.equal(readConfigField({ get: () => undefined }, 'fallback'), 'fallback')
  assert.equal(readConfigField(undefined), undefined)
})

test('readConfigArray always returns an array', () => {
  assert.deepEqual(readConfigArray(['a']), ['a'])
  assert.deepEqual(readConfigArray({ get: () => ['b'] }), ['b'])
  assert.deepEqual(readConfigArray(undefined), [])
  assert.deepEqual(readConfigArray('not an array'), [])
  assert.deepEqual(readConfigArray(undefined, ['fallback']), ['fallback'])
})
