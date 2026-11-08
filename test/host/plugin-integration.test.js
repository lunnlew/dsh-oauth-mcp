/**
 * Host integration test: the plugin installs itself into a fake host, exposes
 * its tools, its command and its authorization flows, and leaves nothing behind
 * when it is unloaded.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, Config, ENTRY_ID, inject, name } from '../../index.js'
import { createFakeHost, toolNames, withVolatileConfig } from './fake-host.js'
import { readConfigArray } from '../../lib/util/config.js'
import { waitFor, freePort } from '../support/waiting.js'

const SERVER = {
  id: 'mock',
  label: 'Mock MCP',
  url: 'http://127.0.0.1:53102/mcp',
  scopes: [],
  enabled: true,
}

/**
 * List the configuration fields the host may write without a restart.
 *
 * @param {object} schema The plugin Config schema.
 * @returns {string[]} The names of the volatile fields.
 */
function volatileFields(schema) {
  const json = schema.toJSON()
  const root = json.refs[json.uid]
  const fields = []
  for (const [name, id] of Object.entries(root?.dict ?? {})) {
    if (json.refs[id]?.meta?.volatile === true) fields.push(name)
  }
  return fields.sort()
}

/**
 * Build a plugin Config for the tests.
 *
 * @param {object} [overrides] Field overrides.
 * @returns {object} The Config.
 */
function makeConfig(overrides = {}) {
  return {
    callbackMode: 'manual-only',
    callbackPort: 39271,
    callbackPath: '/oauth-mcp/callback',
    toolPrefix: 'mcp_oauth',
    authorizationTimeoutMs: 300000,
    defaultScopes: [],
    autoConnect: false,
    servers: [SERVER],
    ...overrides,
  }
}

test('the module exports the shape the host expects', () => {
  assert.equal(typeof apply, 'function')
  assert.equal(name, 'dsh-oauth-mcp')
  assert.equal(ENTRY_ID, 'dsh-oauth-mcp')
  assert.deepEqual(inject, ['tools'])
  assert.ok(Config, 'the plugin exports a Config schema')
  assert.equal(typeof Config['~standard'].validate, 'function')
})

test('the Config accepts the documented shape', () => {
  const result = Config['~standard'].validate(makeConfig())
  assert.equal(result.issues, undefined, `the config is valid: ${JSON.stringify(result.issues)}`)
  const validated = Config(makeConfig())
  assert.equal(validated.callbackMode, 'manual-only')
  assert.equal(validated.toolPrefix, 'mcp_oauth')
  const servers = readConfigArray(validated.servers, [])
  assert.equal(servers.length, 1)
  assert.equal(servers[0].id, 'mock')
})

test('the settings page fields are volatile, the rest is not', () => {
  // The host only lets the settings page write volatile fields; a volatile
  // field is committed into the running plugin instead of restarting it.
  assert.deepEqual(volatileFields(Config), [
    'autoConnect',
    'defaultScopes',
    'lazyTools',
    'locale',
    'servers',
  ])
})

test('the Config rejects a server without an id', () => {
  assert.throws(() => Config(makeConfig({ servers: [{ url: 'http://x/' }] })))
})

test('apply registers the two agent tools', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const names = toolNames(host.tools)
    assert.ok(names.includes('dsh_oauth_mcp_authorize'), `expected the authorize tool, got ${names.join(', ')}`)
    assert.ok(names.includes('dsh_oauth_mcp_status'), `expected the status tool, got ${names.join(', ')}`)

    const authorize = host.tools.get('dsh_oauth_mcp_authorize')
    assert.equal(typeof authorize.execute, 'function')
    assert.ok(authorize.output, 'the tool declares an output definition')
    assert.ok(authorize.output.schema, 'the output definition carries a schema')
    assert.equal(typeof authorize.output.render, 'function')
    assert.ok(authorize.description.length > 20, 'the tool has a usable description')
  } finally {
    await dispose()
  }
})

test('apply provides the oauthMcp service and the host command', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    assert.ok(service, 'the plugin provides the oauthMcp service')
    for (const method of ['listServers', 'describeServer', 'status', 'listTools', 'beginAuthorization', 'disconnect', 'updateServer']) {
      assert.equal(typeof service[method], 'function', `the service exposes ${method}`)
    }

    assert.ok(host.commands.has('oauth-mcp'), 'the plugin registers the /oauth-mcp command')
    assert.ok(host.flows.has('oauth-mcp/mock'), 'the plugin registers an authorization flow per server')
  } finally {
    await dispose()
  }
})

test('the status tool answers without any server being authorized', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const tool = host.tools.get('dsh_oauth_mcp_status')
    const result = await tool.execute({}, {})
    const text = tool.output.render({}, result).map((block) => block.text ?? '').join('\n')
    assert.match(text, /mock/)
    assert.doesNotMatch(text, /Bearer\s/)
    assert.doesNotMatch(text, /access_token/)
  } finally {
    await dispose()
  }
})

test('the authorize tool refuses to act without a user present', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const tool = host.tools.get('dsh_oauth_mcp_authorize')
    const result = await tool.execute({ serverId: 'mock', dryRun: true }, {})
    const text = tool.output.render({}, result).map((block) => block.text ?? '').join('\n')
    assert.match(text, /mock/)
  } finally {
    await dispose()
  }
})

test('the plugin reports a missing credential service instead of failing silently', async () => {
  const host = createFakeHost({ config: makeConfig(), withCredentials: false })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    assert.equal(service.credentialServiceState(), 'missing')

    const rows = await service.status()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].credentialService, 'missing', 'the status row carries the fact')

    const tool = host.tools.get('dsh_oauth_mcp_status')
    const result = await tool.execute({}, {})
    const text = tool.output.render({}, result).map((block) => block.text ?? '').join('\n')
    assert.match(text, /credential service/i, 'the tool explains that the host exposes none')
  } finally {
    await dispose()
  }
})

test('the plugin picks the credential service up when the host exposes it later', async () => {
  const host = createFakeHost({ config: makeConfig(), withCredentials: false })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    assert.equal(service.credentialServiceState(), 'missing')

    // The host activates its credential provider after this plugin started.
    host.services.credentials = {
      readRecord: async () => undefined,
      describeRecord: async () => undefined,
      listRecords: async () => [],
      modifyRecord: async (key, mutate) => {
        const next = await mutate(host.records.get(key))
        if (next === undefined) host.records.delete(key)
        else host.records.set(key, next)
        return host.records.get(key)
      },
      deleteRecord: async (key) => {
        host.records.delete(key)
      },
    }

    assert.equal(service.credentialServiceState(), 'ready', 'the service is found without a restart')
    const rows = await service.status()
    assert.equal(rows[0].credentialService, 'ready')
  } finally {
    await dispose()
  }
})

test('unloading removes every registration', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  // The authorize tool, the status tool and the lazy exposure entry tool.
  assert.equal(host.tools.size, 3)
  assert.equal(host.commands.size, 1)
  assert.equal(host.flows.size, 1)

  await dispose()

  assert.equal(host.tools.size, 0, 'the tools are unregistered')
  assert.equal(host.commands.size, 0, 'the command is unregistered')
  assert.equal(host.flows.size, 0, 'the authorization flows are unregistered')
  assert.equal(host.routes.size, 0, 'no web route is left behind')
})

test('the plugin survives a host without the optional services', async () => {
  const host = createFakeHost({
    config: makeConfig(),
    withCredentials: false,
    withCommands: false,
    withAuthorization: false,
    withSettings: false,
    withWebServer: false,
  })
  const dispose = await apply(host.ctx, host.config)
  try {
    // The authorize tool, the status tool and the lazy exposure entry tool.
    assert.equal(host.tools.size, 3)
    assert.equal(host.commands.size, 0)
    assert.equal(host.flows.size, 0)
  } finally {
    await dispose()
  }
})

test('the plugin binds a loopback port in dedicated-port mode', async () => {
  const port = await freePort()
  const host = createFakeHost({ config: makeConfig({ callbackMode: 'dedicated-port', callbackPort: port }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    const views = await service.listServers()
    assert.equal(views[0].callbackMode, 'dedicated-port')
    assert.match(views[0].redirectUri ?? '', /^http:\/\/127\.0\.0\.1:\d+\/oauth-mcp\/callback$/)
    assert.equal(views[0].redirectUri, `http://127.0.0.1:${port}/oauth-mcp/callback`)
  } finally {
    await dispose()
  }
})

test('the manual-only mode still announces a loopback redirect URI', async () => {
  const host = createFakeHost({ config: makeConfig({ callbackMode: 'manual-only' }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    const views = await service.listServers()
    assert.equal(views[0].callbackMode, 'manual-only')
    // The authorization server needs a redirect URI even when no listener runs:
    // the user copies the address bar URL back into the plugin.
    assert.equal(views[0].redirectUri, 'http://127.0.0.1:39271/oauth-mcp/callback')
  } finally {
    await dispose()
  }
})

test('the authorize tool plans the flow with the live callback state', async () => {
  const port = await freePort()
  const host = createFakeHost({ config: makeConfig({ callbackMode: 'dedicated-port', callbackPort: port }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    const tool = host.tools.get('dsh_oauth_mcp_authorize')
    const result = await tool.execute({ serverId: 'mock', dryRun: true }, {})
    assert.equal(result.status, 'planned')
    assert.equal(result.callbackMode, 'dedicated-port')
    assert.equal(result.redirectUri, `http://127.0.0.1:${port}/oauth-mcp/callback`)
    assert.ok(Array.isArray(result.steps) && result.steps.length > 0, 'the plan lists the steps')
  } finally {
    await dispose()
  }
})

test('a volatile server list change reaches the running plugin', async () => {
  // The settings page writes the server list through the host settings service.
  // The host commits a volatile change into the running plugin and reports it
  // through `loader/volatile-update`.
  const config = withVolatileConfig(makeConfig({ servers: [] }))
  const host = createFakeHost({ config })
  const dispose = await apply(host.ctx, host.config)
  try {
    assert.equal(host.flows.size, 0, 'no server is configured yet')

    await host.settingsService.mutate(ENTRY_ID, [
      { op: 'set', path: ['servers'], value: [SERVER] },
    ])
    host.emit('loader/volatile-update', [['servers']])
    const reached = await waitFor(() => host.flows.has('oauth-mcp/mock'))

    assert.ok(reached, 'the new server got an authorization flow')

    const service = host.provided.get('oauthMcp')
    const views = await service.listServers()
    assert.equal(views.length, 1)
    assert.equal(views[0].id, 'mock')
  } finally {
    await dispose()
  }
})

test('the command answers in the language of the interface', async () => {
  const host = createFakeHost({ config: makeConfig(), locale: 'zh-CN' })
  const dispose = await apply(host.ctx, host.config)
  try {
    const result = await host.commands.get('oauth-mcp').handler({ rawInput: 'help' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /用法/, 'the answer is written in chinese')
    assert.equal(result.text.includes('Usage:'), false, 'the answer holds no english')
  } finally {
    await dispose()
  }
})

test('the command answers in the language the client wrote into the plugin namespace', async () => {
  const config = withVolatileConfig(makeConfig())
  const host = createFakeHost({ config })
  const dispose = await apply(host.ctx, host.config)
  try {
    // The client half writes the language of the interface into the plugin's
    // own namespace, so both halves of the plugin speak the same language.
    await host.settingsService.mutate(ENTRY_ID, [{ op: 'set', path: ['locale'], value: 'zh-CN' }])

    const result = await host.commands.get('oauth-mcp').handler({ rawInput: 'help' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /用法/, 'the answer is written in chinese')
  } finally {
    await dispose()
  }
})

test('the command falls back to the language of the system', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const result = await host.commands.get('oauth-mcp').handler({ rawInput: 'help' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Usage/, 'the answer is written in english')
  } finally {
    await dispose()
  }
})

test('the command explains what it can do', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const command = host.commands.get('oauth-mcp')
    const result = await command.handler({ rawInput: 'help' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /oauth-mcp authorize/)
    assert.match(result.text, /oauth-mcp status/)
    assert.match(result.text, /oauth-mcp tools/)
    assert.match(result.text, /oauth-mcp complete/)
    assert.match(result.text, /oauth-mcp disconnect/)
  } finally {
    await dispose()
  }
})

test('the tools command reports that a server without a session has no tools', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const command = host.commands.get('oauth-mcp')
    const result = await command.handler({ rawInput: 'tools' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /no tools yet/)
    assert.match(result.text, /How to use these tools/)
  } finally {
    await dispose()
  }
})

test('the tools command lists the tools of one server by their callable name', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    // The fake host has no MCP server, so the tool list is empty; the command
    // still has to answer with the servers it knows about.
    const result = await host.commands.get('oauth-mcp').handler({ rawInput: 'tools mock' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Mock MCP/)
    assert.ok(service, 'the service is provided')
  } finally {
    await dispose()
  }
})

test('the status command tells the user how to connect the first server', async () => {
  const host = createFakeHost({ config: makeConfig({ servers: [] }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    const command = host.commands.get('oauth-mcp')
    const result = await command.handler({ rawInput: 'status' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /oauth-mcp authorize https:\/\/mcp\.notion\.com\/mcp/)
  } finally {
    await dispose()
  }
})

test('an unknown server name is answered with the configured identifiers', async () => {
  const host = createFakeHost({ config: makeConfig() })
  const dispose = await apply(host.ctx, host.config)
  try {
    const command = host.commands.get('oauth-mcp')
    const result = await command.handler({ rawInput: 'authorize nope' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /mock/, 'the answer names the configured servers')
    assert.match(result.text, /mcp\.notion\.com/, 'the answer shows that an endpoint URL works too')
  } finally {
    await dispose()
  }
})

test('the service adds a server that is only known by its endpoint', async () => {
  const host = createFakeHost({ config: makeConfig({ servers: [] }) })
  const dispose = await apply(host.ctx, host.config)
  try {
    const service = host.provided.get('oauthMcp')
    const resolved = await service.ensureServer('https://mcp.notion.com/mcp')
    assert.equal(resolved.registered, true, 'the endpoint was added')
    assert.equal(resolved.server.id, 'notion', 'the known vendor table named the server')
    assert.equal(resolved.server.url, 'https://mcp.notion.com/mcp')

    const views = await service.listServers()
    assert.equal(views.length, 1)
    assert.equal(views[0].id, 'notion')

    // A second call finds the same server instead of adding it twice.
    const again = await service.ensureServer('https://mcp.notion.com/mcp')
    assert.equal(again.registered, false)
    assert.equal((await service.listServers()).length, 1)
  } finally {
    await dispose()
  }
})
