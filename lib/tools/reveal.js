/**
 * The `mcp_oauth` agent tool: the entry point of the lazy exposure.
 *
 * While lazy exposure is on, the remote tools of the authorized servers are
 * not in the model's tool table. This tool is the way in: the model calls it
 * to learn which servers are authorized and which tools they expose, and the
 * tools it asks for become callable from the next step on.
 *
 * The tool is the only one the plugin keeps in the table unconditionally, so
 * it is also the tool that tells the model that the others exist. Its
 * description has to carry that job on its own: the model sees this tool and
 * nothing else.
 *
 * The shape follows the host's contract: `execute` resolves with the data (one
 * row per server), and `output.render` turns that data into the content
 * blocks the model reads. The schema describes the data.
 *
 * @module dsh-oauth-mcp/tools/reveal
 */

import { REVEAL_TOOL_NAME } from '../mcp/reveal.js'

export { REVEAL_TOOL_NAME }

/** JSON Schema of the value the tool resolves with. */
const REVEAL_OUTPUT_SCHEMA = Object.freeze({
  type: 'array',
  description: 'The servers that were revealed, and the tools they expose.',
  items: {
    type: 'object',
    properties: {
      serverId: { type: 'string', description: 'The identifier of the revealed MCP server.' },
      label: { type: 'string', description: 'The human readable label of the server.' },
      authorized: { type: 'boolean', description: 'Whether the server has a usable grant.' },
      connected: { type: 'boolean', description: 'Whether the MCP session is established.' },
      revealed: { type: 'boolean', description: 'Whether the tools of this server are callable now.' },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The public names of the tools of this server, for example "mcp_oauth__notion__search". They are callable from the next step on.',
      },
    },
    required: ['serverId', 'label', 'authorized', 'connected', 'revealed', 'tools'],
  },
})

/**
 * The description of the entry tool.
 *
 * It is written for a model that has no other MCP tool in its table: it says
 * what the tool is for, when to call it, and what comes back.
 *
 * @returns {string} The description.
 */
function buildDescription() {
  return (
    'Reveal the tools of the OAuth protected MCP servers of this profile. ' +
    'The tools of those servers are not in your tool table until you ask for them, ' +
    'so that every step does not carry their schemas. ' +
    'Call it with {"server":"<serverId>"} to reveal one server, ' +
    'or without arguments to list the authorized servers. ' +
    'The answer lists the servers and the names of their tools; those names are callable from the next step on.'
  )
}

/**
 * Build the entry tool.
 *
 * @param {object} options The options.
 * @param {import('../mcp/reveal.js').RevealState} options.reveal The reveal state.
 * @param {{ status: (serverId?: string) => Promise<object[]>, listToolNames: (serverId: string) => string[] }} options.service The plugin service.
 * @returns {object} The tool definition.
 */
export function createRevealTool({ reveal, service }) {
  /**
   * Render the rows into the text the model reads.
   *
   * @param {object} args The arguments the tool was called with.
   * @param {object[]} value The rows.
   * @returns {{ type: 'text', text: string }[]} The content blocks.
   */
  function render(args, value) {
    void args
    const rows = Array.isArray(value) ? value : []
    if (rows.length === 0) {
      return [
        {
          type: 'text',
          text: 'No MCP server is configured in this profile. Add one in the settings, then authorize it.',
        },
      ]
    }
    const lines = []
    for (const row of rows) {
      const state = row.authorized ? 'authorized' : 'not authorized yet'
      const connection = row.connected ? 'connected' : 'not connected'
      const callable = row.revealed ? 'tools callable now' : 'tools not revealed'
      const tools = row.tools.length > 0 ? row.tools.join(', ') : 'no tools yet'
      lines.push(`${row.serverId} (${row.label}) — ${state} — ${connection} — ${callable}`)
      if (row.tools.length > 0) lines.push(`  ${tools}`)
    }
    const revealed = rows.filter((row) => row.revealed).length
    if (revealed > 0) {
      lines.push('')
      lines.push(`The tools of ${revealed} server(s) are callable from the next step on.`)
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }

  return {
    name: REVEAL_TOOL_NAME,
    description: buildDescription(),
    parameters: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description:
            'The id of the MCP server to reveal, for example "notion". Leave it out to list the authorized servers.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: { schema: REVEAL_OUTPUT_SCHEMA, render },
    execute: async (args, exec) => {
      const agent = exec?.agent
      const requested = typeof args?.server === 'string' ? args.server.trim() : ''

      const rows = await service.status(requested || undefined)
      const target = Array.isArray(rows) ? rows : []

      // Reveal what the model asked for. Without a server id every authorized
      // server is revealed: the model asked what is there, and the answer is
      // more useful than another round trip.
      const revealIds = target.filter((row) => row.authorized).map((row) => row.serverId)
      reveal.reveal(agent, revealIds)

      return target.map((row) => ({
        serverId: String(row.serverId ?? ''),
        label: String(row.label ?? row.serverId ?? ''),
        authorized: row.authorized === true,
        connected: row.connected === true,
        revealed: revealIds.includes(String(row.serverId ?? '')),
        tools: Array.isArray(row.tools) ? row.tools.map((name) => String(name)) : [],
      }))
    },
    timeoutMs: 30_000,
    isConcurrencySafe: true,
  }
}
