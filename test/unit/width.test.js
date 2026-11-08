/**
 * Tests of the terminal-column helpers.
 *
 * @module dsh-oauth-mcp/test/unit/width
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { displayWidth, padEndWidth } from '../../lib/util/width.js'

describe('the display width', () => {
  it('counts a latin letter as one column', () => {
    assert.equal(displayWidth('abc'), 3)
  })

  it('counts a chinese character as two columns', () => {
    assert.equal(displayWidth('已授权'), 6)
    assert.equal(displayWidth('a已b'), 4)
  })

  it('counts a fullwidth form as two columns', () => {
    assert.equal(displayWidth('（'), 2)
  })

  it('counts an emoji as two columns', () => {
    assert.equal(displayWidth('⚠'), 1)
    assert.equal(displayWidth('🔑'), 2)
  })

  it('counts a combining mark as no column', () => {
    assert.equal(displayWidth('é'), 1)
  })

  it('treats an empty text as no column', () => {
    assert.equal(displayWidth(''), 0)
    assert.equal(displayWidth(undefined), 0)
  })
})

describe('the padding', () => {
  it('pads a latin text to the wanted width', () => {
    assert.equal(padEndWidth('abc', 6), 'abc   ')
  })

  it('pads a chinese text by its display width', () => {
    const padded = padEndWidth('已授权', 8)
    assert.equal(displayWidth(padded), 8)
  })

  it('keeps a text that is already wide enough', () => {
    assert.equal(padEndWidth('abcdef', 3), 'abcdef')
  })
})
