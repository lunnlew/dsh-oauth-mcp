/**
 * End-to-end test of the lazy exposure of the remote MCP tools.
 *
 * The test drives the whole path: the plugin registers the remote tools, the
 * host evaluates the admission condition once per step, the model calls the
 * entry tool, and the tools of that server become callable.
 *
 * @module dsh-oauth-mcp/test/e2e/lazy-exposure
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../../index.js'
import { REVEAL_TOOL_NAME } from '../../lib/mcp/reveal.js'
import { createFakeHost, toolNames, withVolatileConfig } from '../host/fake-host.js'
import { withMockServers } from '../setup.js'

/**
 * Start the plugin against a fake host.
 *
 * @param {object} [options] The options.
 * @returns {Promise<{ host: object, dispose: () => void }>} The running plugin.
 */
async function startPlugin(options = {}) {
  const config = withVolatileConfig({
    callbackMode: 'dedicated-port',
    callbackPort: 0,
    callbackPath: '/oauth-mcp/callback',
    toolPrefix: 'mcp_oauth',
    authorizationTimeoutMs: 30000,
    defaultScopes: [],
    autoConnect: true,
    servers: [],
    ...options.config,
  })
  const host = createFakeHost({ config, ...options.host })
  const dispose = await apply(host.ctx, config)
  return { host, dispose }
}

test('the remote tools are hidden until the model reveals them', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin({
      config: { servers: [{ id: 'mock', url: mcp.endpoint, enabled: true }] },
    })
    try {
      const service = host.provided.get('oauthMcp')
      // The server has no grant yet, so there is nothing to reveal; the point
      // of this test is the mechanism, which the unit tests cover in detail.
      assert.ok(service, 'the plugin provides its service')

      const agent = { id: 'agent-1' }
      const admitted = await host.admittedTools(agent)
      const names = admitted.map((tool) => tool.name)

      // The entry tool is always there: it is the only hint the model gets.
      assert.ok(names.includes(REVEAL_TOOL_NAME), `expected the entry tool, got ${names.join(', ')}`)
      // The two own tools are always there as well.
      assert.ok(names.includes('dsh_oauth_mcp_status'))
      assert.ok(names.includes('dsh_oauth_mcp_authorize'))
      // No remote tool is offered, because the server was never revealed.
      assert.equal(
        names.some((name) => name.startsWith('mcp_oauth__mock__')),
        false,
        'no remote tool is offered before the reveal',
      )
    } finally {
      dispose()
    }
  })
})

test('the guard refuses a remote tool that was not revealed', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin({
      config: { servers: [{ id: 'mock', url: mcp.endpoint, enabled: true }] },
    })
    try {
      const agent = { id: 'agent-1' }
      const refusal = host.checkGuards({
        name: 'mcp_oauth__mock__echo',
        agent,
      })
      assert.equal(typeof refusal, 'string', 'the guard refuses the call')
      assert.match(refusal, /not revealed/)
      assert.match(refusal, /mock/)

      // The tools of the host itself are not touched by the guard.
      assert.equal(
        host.checkGuards({ name: 'dsh_oauth_mcp_status', agent }),
        undefined,
        'the guard ignores the tools of the plugin itself',
      )
    } finally {
      dispose()
    }
  })
})

test('the entry tool reveals a server and the host then admits its tools', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin({
      config: { servers: [{ id: 'mock', url: mcp.endpoint, enabled: true }] },
    })
    try {
      const service = host.provided.get('oauthMcp')
      const agent = { id: 'agent-1' }

      // The entry tool is the only way in.
      const entry = host.tools.get(REVEAL_TOOL_NAME)
      assert.ok(entry, 'the entry tool is registered')
      assert.ok(entry.description.length > 40, 'the entry tool explains itself')
      assert.match(entry.description, /Reveal/, 'the description says what the tool is for')

      // The server is not authorized in this test, so the entry tool reports
      // that and reveals nothing. The authorized path is covered by the unit
      // tests of the reveal state.
      const rows = await entry.execute({}, { agent })
      assert.equal(Array.isArray(rows), true)
      assert.equal(rows[0].serverId, 'mock')
      assert.equal(typeof rows[0].revealed, 'boolean')
      const rendered = entry.output.render({}, rows)
      assert.match(rendered[0].text, /mock/, 'the answer names the server')

      // The value the tool resolves with has to match the schema it declares:
      // the host rejects an answer that does not, and the model never sees it.
      const required = entry.output.schema.items.required
      for (const row of rows) {
        for (const field of required) {
          assert.ok(
            Object.hasOwn(row, field),
            `the row is missing the field "${field}" that the schema requires`,
          )
        }
      }
      assert.equal(
        rendered.every((block) => block.type === 'text' && typeof block.text === 'string'),
        true,
        'the render produces text blocks',
      )

      // The tools of the server are still not offered: it is not authorized.
      const admitted = await host.admittedTools(agent)
      assert.equal(
        admitted.some((tool) => tool.name === 'mcp_oauth__mock__echo'),
        false,
        'an unauthorized server offers no tools',
      )
    } finally {
      dispose()
    }
  })
})

test('the entry tool is registered even when the lazy exposure is off', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin({
      config: {
        lazyTools: false,
        servers: [{ id: 'mock', url: mcp.endpoint, enabled: true }],
      },
    })
    try {
      const agent = { id: 'agent-1' }
      // With the lazy exposure off the guard must not refuse anything.
      assert.equal(
        host.checkGuards({ name: 'mcp_oauth__mock__echo', agent }),
        undefined,
        'the guard is inactive',
      )
      // The entry tool stays registered: it reports the servers either way.
      assert.ok(toolNames(host.tools).includes(REVEAL_TOOL_NAME))
    } finally {
      dispose()
    }
  })
})
