/**
 * Tests of the lazy exposure of the remote MCP tools.
 *
 * The mechanism under test is the host's per-step admission: a registration
 * that carries a `when` condition is evaluated before every model step, and a
 * tool whose condition is false is not in that step's tool table at all.
 *
 * @module dsh-oauth-mcp/test/unit/reveal
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { REVEAL_TOOL_NAME, createRevealState } from '../../lib/mcp/reveal.js'

test('a server is not revealed before the model asks for it', () => {
  const reveal = createRevealState()
  const agent = {}

  assert.equal(reveal.isRevealed(agent, 'notion'), false)
  assert.equal(reveal.admission('notion')({ agent }), false)
})

test('revealing a server admits its tools', () => {
  const reveal = createRevealState()
  const agent = {}

  reveal.reveal(agent, ['notion'])

  assert.equal(reveal.isRevealed(agent, 'notion'), true)
  assert.equal(reveal.admission('notion')({ agent }), true)
})

test('the reveal is per agent: another agent starts over', () => {
  const reveal = createRevealState()
  const first = {}
  const second = {}

  reveal.reveal(first, ['notion'])

  assert.equal(reveal.isRevealed(first, 'notion'), true)
  assert.equal(reveal.isRevealed(second, 'notion'), false)
  assert.equal(reveal.admission('notion')({ agent: second }), false)
})

test('revealing one server does not reveal another', () => {
  const reveal = createRevealState()
  const agent = {}

  reveal.reveal(agent, ['notion'])

  assert.equal(reveal.isRevealed(agent, 'notion'), true)
  assert.equal(reveal.isRevealed(agent, 'linear'), false)
})

test('the admission tolerates a context without an agent', () => {
  const reveal = createRevealState()

  // A host that calls the condition without an agent must not throw.
  assert.equal(typeof reveal.admission('notion')({}), 'boolean')
  assert.equal(typeof reveal.admission('notion')({ agent: undefined }), 'boolean')
})

test('the lazy exposure can be turned off, and then every server is admitted', () => {
  const reveal = createRevealState({ enabled: false })
  const agent = {}

  assert.equal(reveal.enabled, false)
  assert.equal(reveal.isRevealed(agent, 'notion'), true)
  assert.equal(reveal.admission('notion')({ agent }), true)
  assert.equal(reveal.guardFor({ name: 'mcp_oauth__notion__search', agent }), undefined)
})

test('the guard refuses a tool of a server that was not revealed', () => {
  const reveal = createRevealState()
  const agent = {}

  const refusal = reveal.guardFor({ name: 'mcp_oauth__notion__search', agent })

  assert.equal(typeof refusal, 'string')
  assert.match(refusal, /not revealed/)
  assert.match(refusal, /notion/)
  assert.match(refusal, new RegExp(REVEAL_TOOL_NAME))
})

test('the guard allows a tool of a revealed server', () => {
  const reveal = createRevealState()
  const agent = {}
  reveal.reveal(agent, ['notion'])

  assert.equal(reveal.guardFor({ name: 'mcp_oauth__notion__search', agent }), undefined)
})

test('the guard ignores the tools of other plugins', () => {
  const reveal = createRevealState()
  const agent = {}

  // The host's own MCP bridge names its tools `mcp__<server>__<tool>`.
  assert.equal(reveal.guardFor({ name: 'mcp__windows__Screenshot', agent }), undefined)
  assert.equal(reveal.guardFor({ name: 'dsh_oauth_mcp_status', agent }), undefined)
  assert.equal(reveal.guardFor({ name: 'pwsh', agent }), undefined)
  assert.equal(reveal.guardFor({}), undefined)
})

test('the guard respects a different tool prefix', () => {
  const reveal = createRevealState({ toolPrefix: 'acme' })
  const agent = {}

  assert.match(reveal.guardFor({ name: 'acme__notion__search', agent }), /not revealed/)
  // The default prefix must not match any more.
  assert.equal(reveal.guardFor({ name: 'mcp_oauth__notion__search', agent }), undefined)
})

test('revealing the same server twice reports nothing new', () => {
  const reveal = createRevealState()
  const agent = {}

  assert.deepEqual(reveal.reveal(agent, ['notion']), ['notion'])
  assert.deepEqual(reveal.reveal(agent, ['notion']), [])
})

test('revealing without an agent changes nothing', () => {
  const reveal = createRevealState()

  assert.deepEqual(reveal.reveal(undefined, ['notion']), [])
  assert.equal(reveal.isRevealed(undefined, 'notion'), false)
})
