/**
 * Smoke test: the plugin loads, works and leaves no residue behind.
 *
 * The regression this file guards is the OAuth gap in the host MCP client: a
 * remote MCP server that demands OAuth cannot be used by it, and the user needs
 * a way to authorize it without handing a token to the model. The plugin
 * therefore has to produce an authorization link for the *user* and must never
 * do the granting itself.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'

import { apply } from '../../index.js'
import { createFakeHost, toolNames } from '../host/fake-host.js'
import { withMockServers } from '../setup.js'
import { freePort } from '../support/waiting.js'

/**
 * Check whether a TCP port can be bound on the loopback interface.
 *
 * @param {number} port The port to probe.
 * @returns {Promise<boolean>} `true` when the port is free.
 */
async function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true))
    })
  })
}

/**
 * Build the plugin Config for the smoke test.
 *
 * @param {object} [overrides] Field overrides.
 * @returns {object} The Config.
 */
function makeConfig(overrides = {}) {
  return {
    callbackMode: 'dedicated-port',
    callbackPath: '/oauth-mcp/callback',
    toolPrefix: 'mcp_oauth',
    authorizationTimeoutMs: 300000,
    defaultScopes: [],
    autoConnect: false,
    servers: [],
    ...overrides,
  }
}

test('loading the plugin binds the callback port and unloading releases it', async () => {
  const port = await freePort()
  const host = createFakeHost({ config: makeConfig({ callbackPort: port }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    assert.equal(await isPortFree(port), false, 'the callback port is in use while the plugin runs')
  } finally {
    await dispose()
  }
  assert.equal(await isPortFree(port), true, 'the callback port is released again')
  assert.equal(host.tools.size, 0, 'no tool registration is left behind')
  assert.equal(host.commands.size, 0, 'no command registration is left behind')
  assert.equal(host.flows.size, 0, 'no authorization flow is left behind')
  assert.equal(host.routes.size, 0, 'no web route is left behind')
})

test('an OAuth protected MCP server can only be used after the user authorized it', async () => {
  await withMockServers(async ({ as, mcp }) => {
    mcp.setScenario({ 'require-auth': true })
    const host = createFakeHost({
      config: makeConfig({
        callbackMode: 'manual-only',
        servers: [{ id: 'mock', label: 'Mock MCP', url: mcp.endpoint, enabled: true }],
      }),
    })
    const dispose = await apply(host.ctx, host.config)
    try {
      const service = host.provided.get('oauthMcp')
      const status = await service.status('mock')
      assert.equal(status.length, 1)
      assert.equal(status[0].authorized, false, 'nothing is authorized yet')
      assert.equal(status[0].needsReauthorization, true)

      // The agent may ask for an authorization, but it may not grant one.
      const authorize = host.tools.get('dsh_oauth_mcp_authorize')
      const result = await authorize.execute({ serverId: 'mock', dryRun: true }, {})
      const text = authorize.output.render({}, result).map((block) => block.text ?? '').join('\n')
      assert.match(text, /mock/)
      assert.doesNotMatch(text, /Bearer\s/)
      assert.doesNotMatch(text, /access_token/)

      const stillNotAuthorized = await service.status('mock')
      assert.equal(stillNotAuthorized[0].authorized, false, 'the dry run granted nothing')
      assert.equal(toolNames(host.tools).includes('dsh_oauth_mcp_status'), true)
    } finally {
      await dispose()
    }
  })
})

test('the status tool never leaks a token, not even a prefix', async () => {
  await withMockServers(async ({ as, mcp }) => {
    const host = createFakeHost({
      config: makeConfig({
        callbackMode: 'manual-only',
        servers: [{ id: 'mock', label: 'Mock MCP', url: mcp.endpoint, enabled: true }],
      }),
    })
    const dispose = await apply(host.ctx, host.config)
    try {
      const service = host.provided.get('oauthMcp')
      // Simulate a stored grant without going through the network.
      await host.records.set('oauth-mcp/mock', {
        kind: 'grant',
        payload: {
          serverId: 'mock',
          serverUrl: mcp.endpoint,
          resource: mcp.endpoint,
          clientId: 'mock-client-1',
          accessToken: 'mock-access-token-secret-value',
          tokenType: 'Bearer',
          redirectUri: 'http://127.0.0.1:39271/oauth-mcp/callback',
          scopes: ['read'],
          obtainedAt: Date.now(),
          expiresAt: Date.now() + 3600_000,
        },
      })
      const status = await service.status('mock')
      assert.equal(status[0].authorized, true)

      const tool = host.tools.get('dsh_oauth_mcp_status')
      const rendered = tool.output.render({}, { servers: status }).map((block) => block.text ?? '').join('\n')
      assert.doesNotMatch(rendered, /mock-access-token/)
      assert.doesNotMatch(rendered, /secret-value/)
      assert.doesNotMatch(rendered, /Bearer\s/)
    } finally {
      await dispose()
    }
  })
})
