/**
 * Tests of the `mcp_oauth` entry tool.
 *
 * The shape of the answer matters more than it looks: the host validates the
 * value a tool resolves with against the schema the tool declares, and it
 * refuses the call when the two do not match. The model then sees an error
 * instead of the answer. So the value has to be the data the schema
 * describes, and `output.render` turns that data into the text.
 *
 * @module dsh-oauth-mcp/test/unit/reveal-tool
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { REVEAL_TOOL_NAME, createRevealTool } from '../../lib/tools/reveal.js'
import { createRevealState } from '../../lib/mcp/reveal.js'

/**
 * Build the tool with a fake service.
 *
 * @param {object[]} [rows] The status rows the service reports.
 * @returns {object} The tool and the reveal state.
 */
function createTool(rows = []) {
  const reveal = createRevealState({ toolPrefix: 'mcp_oauth' })
  const service = {
    status: async () => rows,
    listToolNames: () => [],
  }
  return { tool: createRevealTool({ reveal, service }), reveal }
}

const ROWS = [
  {
    serverId: 'notion',
    label: 'notion',
    authorized: true,
    connected: true,
    tools: ['mcp_oauth__notion__search', 'mcp_oauth__notion__create_page'],
  },
  {
    serverId: 'feishu',
    label: '飞书 MCP',
    authorized: false,
    connected: false,
    tools: [],
  },
]

test('the tool resolves with the rows the schema describes', async () => {
  const { tool } = createTool(ROWS)
  const rows = await tool.execute({}, { agent: { id: 'agent-1' } })

  assert.equal(Array.isArray(rows), true)
  for (const row of rows) {
    for (const field of tool.output.schema.items.required) {
      assert.ok(Object.hasOwn(row, field), `the row is missing "${field}"`)
    }
  }
})

test('the tool renders the rows into text blocks', async () => {
  const { tool } = createTool(ROWS)
  const rows = await tool.execute({}, { agent: { id: 'agent-1' } })
  const blocks = tool.output.render({}, rows)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /notion/)
  assert.match(blocks[0].text, /mcp_oauth__notion__search/)
})

test('the tool renders an empty answer when no server is configured', async () => {
  const { tool } = createTool([])
  const rows = await tool.execute({}, { agent: { id: 'agent-1' } })
  const blocks = tool.output.render({}, rows)

  assert.deepEqual(rows, [])
  assert.match(blocks[0].text, /No MCP server/)
})

test('calling the tool reveals the authorized servers', async () => {
  const { tool, reveal } = createTool(ROWS)
  const agent = { id: 'agent-1' }

  assert.equal(reveal.isRevealed(agent, 'notion'), false)

  const rows = await tool.execute({}, { agent })

  assert.equal(reveal.isRevealed(agent, 'notion'), true)
  assert.equal(reveal.isRevealed(agent, 'feishu'), false, 'an unauthorized server is not revealed')
  assert.equal(rows.find((row) => row.serverId === 'notion').revealed, true)
  assert.equal(rows.find((row) => row.serverId === 'feishu').revealed, false)
})

test('naming a server reveals only that one', async () => {
  const { tool, reveal } = createTool(ROWS)
  const agent = { id: 'agent-1' }

  await tool.execute({ server: 'notion' }, { agent })

  assert.equal(reveal.isRevealed(agent, 'notion'), true)
  assert.equal(reveal.isRevealed(agent, 'feishu'), false)
})

test('the tool tolerates a call without an agent', async () => {
  const { tool } = createTool(ROWS)

  // The host always passes an agent, but the tool must not throw without one.
  const rows = await tool.execute({}, {})
  assert.equal(Array.isArray(rows), true)
})

test('the tool name is the one the guard and the documents name', () => {
  assert.equal(REVEAL_TOOL_NAME, 'mcp_oauth')
})
