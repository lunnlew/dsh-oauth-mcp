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
 * @module dsh-oauth-mcp/tools/reveal
 */

import { REVEAL_TOOL_NAME } from '../mcp/reveal.js'

export { REVEAL_TOOL_NAME }

/** JSON Schema of the value the tool resolves with. */
const REVEAL_OUTPUT_SCHEMA = Object.freeze({
  type: 'array',
  description: 'The servers whose tools were revealed, and the tools they expose.',
  items: {
    type: 'object',
    properties: {
      serverId: { type: 'string', description: 'The identifier of the revealed MCP server.' },
      label: { type: 'string', description: 'The human readable label of the server.' },
      authorized: { type: 'boolean', description: 'Whether the server has a usable grant.' },
      connected: { type: 'boolean', description: 'Whether the MCP session is established.' },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The public names of the tools of this server, for example "mcp_oauth__notion__search". They are callable from the next step on.',
      },
    },
    required: ['serverId', 'label', 'authorized', 'connected', 'tools'],
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
    'The answer lists the server and the names of its tools; those names are callable from the next step on.'
  )
}

/**
 * Build the entry tool.
 *
 * @param {object} options The options.
 * @param {import('../mcp/reveal.js').RevealState} options.reveal The reveal state.
 * @param {{ status: (serverId?: string) => Promise<object[]>, listToolNames: (serverId: string) => string[] }} options.service The plugin service.
 * @param {() => string} [options.locale] The current locale.
 * @returns {object} The tool definition.
 */
export function createRevealTool({ reveal, service, locale }) {
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
    },
    output: { schema: REVEAL_OUTPUT_SCHEMA, render: (value) => value },
    execute: async (args, exec) => {
      const agent = exec?.agent
      const requested = typeof args?.server === 'string' ? args.server.trim() : ''

      const rows = await service.status(requested || undefined)
      if (rows.length === 0) {
        return [
          {
            type: 'text',
            text: requested
              ? `No MCP server with the id "${requested}" is configured in this profile.`
              : 'No MCP server is configured in this profile. Add one in the settings, then authorize it.',
          },
        ]
      }

      // Reveal what the model asked for. Without a server id every authorized
      // server is revealed: the model asked what is there, and the answer is
      // more useful than another round trip.
      const wanted = rows.filter((row) => row.authorized).map((row) => row.serverId)
      const target = requested ? rows.filter((row) => row.serverId === requested) : rows
      const revealIds = target.filter((row) => row.authorized).map((row) => row.serverId)
      reveal.reveal(agent, revealIds)

      const lines = []
      for (const row of target) {
        const tools = service.listToolNames(row.serverId)
        lines.push(
          [
            `${row.serverId}: ${row.label}`,
            row.authorized ? 'authorized' : 'not authorized yet',
            row.connected ? 'connected' : 'not connected',
            tools.length > 0 ? `tools: ${tools.join(', ')}` : 'no tools yet',
          ].join(' — '),
        )
      }
      if (requested && revealIds.length === 0) {
        lines.push(`The server "${requested}" is not authorized yet, so its tools were not revealed.`)
      }
      if (wanted.length === 0 && !requested) {
        lines.push('No server is authorized yet. Use the oauth-mcp command to authorize one.')
      }

      return [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ]
    },
  }
}
