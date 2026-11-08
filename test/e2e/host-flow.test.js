/**
 * End-to-end test of the complete chain: the settings panel writes the server
 * list, the host commits it into the running plugin, the user authorizes the
 * server in a browser, the plugin stores the grant, opens the MCP session,
 * mirrors the remote tools into the host tool service, the host calls one of
 * them, the status reports the result, the user disconnects, and the plugin
 * unloads without leaving a residue.
 *
 * Everything runs against the mock authorization server and the mock MCP
 * server of `test/support`; no network access and no real host are needed.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:net'

import { apply, ENTRY_ID } from '../../index.js'
import { createPanel } from '../../client/panel.js'
import { createFakeHost, toolNames, withVolatileConfig } from '../host/fake-host.js'
import { buttons, collect, createFakeReact, inputs } from '../support/fake-react.js'
import { withMockServers } from '../setup.js'
import { waitFor } from '../support/waiting.js'

/**
 * Wait for a few event loop turns.
 *
 * @param {number} [turns] The number of turns.
 * @returns {Promise<void>} Resolves after the turns.
 */
async function flush(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * Report whether a TCP port can be bound.
 *
 * @param {number} port The port.
 * @returns {Promise<boolean>} Whether the port is free.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/**
 * Build the config form the client panel uses.
 *
 * The form reads the configuration the host resolved and writes through the
 * settings service, exactly like the `configForms` service of the host does.
 *
 * @param {object} host The fake host.
 * @returns {object} The config form.
 */
function createConfigForm(host) {
  const listeners = new Set()

  /**
   * Read the current configuration.
   *
   * @returns {object} The snapshot.
   */
  const snapshot = () => {
    const values = host.config.__volatileValues ?? {}
    return {
      status: 'ready',
      value: {
        callbackMode: host.config.callbackMode,
        callbackPort: host.config.callbackPort,
        callbackPath: host.config.callbackPath,
        toolPrefix: host.config.toolPrefix,
        defaultScopes: values.defaultScopes ?? [],
        autoConnect: values.autoConnect ?? true,
        servers: values.servers ?? [],
      },
    }
  }

  /**
   * Tell the panel that the configuration changed.
   *
   * @returns {void}
   */
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, value) => {
      await host.settingsService.mutate(ENTRY_ID, [{ op: 'set', path: [field], value }])
      notify()
    },
    mutate: async (ops) => {
      await host.settingsService.mutate(ENTRY_ID, ops)
      notify()
    },
  }
}

/**
 * Drive the settings panel until it saved one server.
 *
 * The panel is a React component, so the test renders it with the fake React
 * runtime, clicks the "add" button, fills the draft form and clicks "save".
 *
 * @param {object} options The options.
 * @param {object} options.React The fake React runtime.
 * @param {Function} options.Panel The panel component.
 * @param {object} options.server The server the panel has to save.
 * @returns {Promise<void>} Resolves once the panel wrote the server.
 */
async function saveServerInPanel({ React, Panel, server }) {
  let tree = React.render(Panel, {})

  const serversSection = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-section')[0]
  assert.ok(serversSection, 'the panel shows the server section')
  const addButton = buttons(serversSection).at(-1)
  assert.ok(addButton, 'the panel shows the "add server" button')
  addButton.props.onClick()

  tree = React.render(Panel, {})
  const draftSection = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(draftSection, 'the panel shows the draft form')

  for (const [key, value] of [
    ['id', server.id],
    ['label', server.label ?? server.id],
    ['url', server.url],
    ...(Array.isArray(server.scopes) ? [['scopes', server.scopes.join(', ')]] : []),
  ]) {
    const field = collect(tree, (node) => node.props?.key === key)[0]
    assert.ok(field, `the draft form has the "${key}" field`)
    const input = inputs(field)[0]
    input.props.onChange({ target: { value } })
  }

  tree = React.render(Panel, {})
  const formSection = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(formSection, 'the panel shows the draft form')
  const actions = formSection.children.at(-1)
  const saveButton = buttons(actions)[0]
  assert.ok(saveButton, 'the draft form has the "save" button')
  saveButton.props.onClick()
  await flush()
}

/**
 * Start the plugin inside the fake host.
 *
 * @param {object} [options] The options.
 * @returns {Promise<{ host: object, dispose: () => void }>} The running plugin.
 */
async function startPlugin(options = {}) {
  const config = withVolatileConfig({
    callbackMode: 'dedicated-port',
    // Port 0 asks the operating system for a free loopback port.
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
  return { host, config, dispose }
}

test('the settings page adds a server and the running plugin picks it up', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin()
    try {
      const React = createFakeReact()
      const form = createConfigForm(host)
      const Panel = createPanel(React, { getConfigForm: () => form })

      await saveServerInPanel({
        React,
        Panel,
        server: { id: 'mock', url: mcp.endpoint },
      })

      // The panel wrote the server list through the settings service.
      assert.deepEqual(
        host.config.__volatileValues.servers.map((server) => server.id),
        ['mock'],
        'the panel saved the server',
      )
      assert.equal(
        host.settingsService.calls.some((call) => call.ns === ENTRY_ID && call.ops?.[0]?.path?.[0] === 'servers'),
        true,
        'the host received the server list',
      )

      // The host reported the change to the running plugin, which registered
      // the authorization flow of the new server.
      assert.equal(host.flows.has('oauth-mcp/mock'), true, 'the plugin registered the authorization flow')

      const service = host.provided.get('oauthMcp')
      const rows = await service.status()
      assert.equal(rows.length, 1)
      assert.equal(rows[0].serverId, 'mock')
      assert.equal(rows[0].authorized, false, 'the server is not authorized yet')
    } finally {
      dispose()
    }
  })
})

test('the complete flow authorizes a server and calls its remote tool', async () => {
  await withMockServers(async ({ mcp }) => {
    // The mock MCP server only answers requests that carry the bearer token.
    mcp.setScenario({ 'require-auth': true })

    const { host, dispose } = await startPlugin()
    try {
      const React = createFakeReact()
      const form = createConfigForm(host)
      const Panel = createPanel(React, { getConfigForm: () => form })
      await saveServerInPanel({
        React,
        Panel,
        server: { id: 'mock', url: mcp.endpoint, scopes: ['mock-scope'] },
      })

      const service = host.provided.get('oauthMcp')
      const command = host.commands.get('oauth-mcp')
      assert.ok(command, 'the plugin registered the host command')

      // The agent tool cannot authorize on its own: it only hands out the URL.
      const authorizeTool = host.tools.get('dsh_oauth_mcp_authorize')
      const plan = await authorizeTool.execute({ serverId: 'mock', dryRun: true }, {})
      assert.equal(JSON.stringify(plan).includes('access_token'), false, 'the plan holds no token')
      assert.equal(host.records.size, 0, 'nothing was granted yet')
      assert.equal(
        toolNames(host.tools).some((name) => name.startsWith('mcp_oauth__')),
        false,
        'no remote tool is registered before the authorization',
      )

      // The user asks for the authorization URL and opens it in a browser.
      const authorizeResult = await command.handler({ rawInput: 'authorize mock' })
      assert.equal(authorizeResult.kind, 'success')
      const authorizationUrl = authorizeResult.text.match(/https?:\/\/\S+/)?.[0]
      assert.ok(authorizationUrl, 'the command printed the authorization URL')
      assert.match(authorizationUrl, /code_challenge=/, 'the request carries a PKCE challenge')
      assert.match(authorizationUrl, /code_challenge_method=S256/, 'the request carries the S256 method')

      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')
      assert.ok(redirectUri?.startsWith('http://127.0.0.1:'), 'the redirect stays on the loopback interface')

      // The browser follows the redirect of the authorization server to the
      // callback receiver of the plugin.
      const browser = await fetch(authorizationUrl)
      assert.equal(browser.status, 200, 'the callback receiver confirmed the authorization')
      const page = await browser.text()
      assert.equal(page.includes('code='), false, 'the page does not echo the code')

      // The plugin stored the grant in the host credential service.
      const record = host.records.get('oauth-mcp/mock')
      assert.ok(record, 'the grant was stored')
      assert.equal(record.kind, 'grant')
      assert.match(record.payload.accessToken, /^mock-access-token-/)
      assert.equal(record.payload.clientSecret, undefined, 'the grant holds no client secret')

      // The remote tools are mirrored into the host tool service.
      assert.equal(
        await waitFor(() => toolNames(host.tools).includes('mcp_oauth__mock__echo')),
        true,
        'the remote tools were registered',
      )
      assert.deepEqual(
        toolNames(host.tools).filter((name) => name.startsWith('mcp_oauth__')),
        ['mcp_oauth__mock__add', 'mcp_oauth__mock__echo'],
      )

      // The host calls one of the remote tools.
      const echo = host.tools.get('mcp_oauth__mock__echo')
      const called = await echo.execute({ text: 'hello from the host' }, {})
      assert.match(JSON.stringify(called), /hello from the host/)

      // The status reports the connection, and it never leaks the token.
      const statusResult = await command.handler({ rawInput: 'status' })
      assert.equal(statusResult.kind, 'success')
      assert.match(statusResult.text, /mock/)
      assert.equal(statusResult.text.includes('mock-access-token-'), false, 'the table holds no token')
      // The scopes are too long for a table cell, so the table carries their
      // number and the list is printed below it.
      assert.match(statusResult.text, /mcp-tool|mock-scope/, 'the scopes are printed below the table')

      const statusTool = host.tools.get('dsh_oauth_mcp_status')
      const rows = await statusTool.execute({}, {})
      assert.equal(rows.length, 1)
      assert.equal(rows[0].serverId, 'mock')
      assert.equal(rows[0].authorized, true)
      assert.equal(rows[0].connected, true)
      assert.equal(rows[0].toolCount, 2)
      assert.equal(JSON.stringify(rows).includes('mock-access-token-'), false, 'the rows hold no token')

      assert.equal((await service.listTools('mock')).length, 2, 'the service lists the remote tools')

      // The user asks which tools the authorization brought in.
      const toolsResult = await command.handler({ rawInput: 'tools mock' })
      assert.equal(toolsResult.kind, 'success')
      assert.match(toolsResult.text, /mcp_oauth__mock__echo/, 'the command names the callable tool')
      assert.match(toolsResult.text, /mcp_oauth__mock__add/, 'the command names the callable tool')
      assert.match(toolsResult.text, /How to use these tools/, 'the command explains how to call them')
      assert.equal(toolsResult.text.includes('mock-access-token-'), false, 'the list holds no token')

      // The status tool publishes the same names, so the agent can look them up.
      const rowsWithTools = await statusTool.execute({}, {})
      assert.deepEqual(rowsWithTools[0].tools, ['mcp_oauth__mock__add', 'mcp_oauth__mock__echo'])

      // The user disconnects the server: the tools are gone, the token stays.
      const disconnectResult = await command.handler({ rawInput: 'disconnect mock' })
      assert.equal(disconnectResult.kind, 'success')
      assert.equal(
        toolNames(host.tools).some((name) => name.startsWith('mcp_oauth__')),
        false,
        'the remote tools were unregistered',
      )
      assert.ok(host.records.get('oauth-mcp/mock'), 'the stored token was kept')

      // The plugin unloads: nothing is left behind and the port is free again.
      const port = Number(new URL(redirectUri).port)
      dispose()
      assert.deepEqual(toolNames(host.tools), [], 'no tool is left registered')
      assert.equal(host.commands.size, 0, 'no command is left registered')
      assert.equal(host.flows.size, 0, 'no authorization flow is left registered')
      assert.equal(await waitFor(() => isPortFree(port), { timeoutMs: 3000 }), true, 'the callback port was released')
    } finally {
      dispose()
    }
  })
})

test('a server that refuses the token once makes the plugin refresh the grant', async () => {
  await withMockServers(async ({ as, mcp }) => {
    // The token is fine, but the server refuses it once: the plugin has to
    // refresh the grant even though the token was not due yet.
    mcp.setScenario({ 'require-auth': true, 'reject-first-token': true })

    const { host, dispose } = await startPlugin()
    try {
      const React = createFakeReact()
      const form = createConfigForm(host)
      const Panel = createPanel(React, { getConfigForm: () => form })
      await saveServerInPanel({
        React,
        Panel,
        server: { id: 'mock', url: mcp.endpoint, scopes: ['mock-scope'] },
      })

      const command = host.commands.get('oauth-mcp')
      const authorizeResult = await command.handler({ rawInput: 'authorize mock' })
      assert.equal(authorizeResult.kind, 'success')
      const authorizationUrl = authorizeResult.text.match(/https?:\/\/\S+/)?.[0]
      assert.ok(authorizationUrl, 'the command printed the authorization URL')

      const browser = await fetch(authorizationUrl)
      assert.equal(browser.status, 200, 'the callback receiver confirmed the authorization')

      // The refresh happened: the authorization server issued a second token.
      assert.equal(
        await waitFor(() => toolNames(host.tools).includes('mcp_oauth__mock__echo')),
        true,
        'the remote tools were registered after the refresh',
      )
      assert.ok(as.state().tokens.length >= 2, 'the grant was refreshed')

      // The tool call works with the refreshed token.
      const echo = host.tools.get('mcp_oauth__mock__echo')
      const called = await echo.execute({ text: 'hello after the refresh' }, {})
      assert.match(JSON.stringify(called), /hello after the refresh/)
    } finally {
      dispose()
    }
  })
})

test('the authorization completes when the host exposes the credential service later', async () => {
  await withMockServers(async ({ mcp }) => {
    // The host starts the plugin before its credential provider is active.
    const { host, dispose } = await startPlugin({ host: { withCredentials: false } })
    try {
      const React = createFakeReact()
      const form = createConfigForm(host)
      const Panel = createPanel(React, { getConfigForm: () => form })
      await saveServerInPanel({ React, Panel, server: { id: 'mock', url: mcp.endpoint } })

      const service = host.provided.get('oauthMcp')
      assert.equal(
        service.credentialServiceState(),
        'missing',
        'the host exposes no credential service yet',
      )

      // The credential provider becomes active while the plugin keeps running.
      host.services.credentials = {
        readRecord: async (key) => host.records.get(key),
        describeRecord: async (key) => ({ key, kind: host.records.get(key)?.kind }),
        listRecords: async () => [...host.records.keys()],
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

      const command = host.commands.get('oauth-mcp')
      const authorizeResult = await command.handler({ rawInput: 'authorize mock' })
      assert.equal(authorizeResult.kind, 'success')
      const authorizationUrl = authorizeResult.text.match(/https?:\/\/\S+/)?.[0]
      assert.ok(authorizationUrl, 'the command printed the authorization URL')

      const browser = await fetch(authorizationUrl)
      assert.equal(browser.status, 200, 'the callback receiver confirmed the authorization')

      const record = host.records.get('oauth-mcp/mock')
      assert.ok(record, 'the grant was stored in the late credential service')
      assert.equal(record.kind, 'grant')
      assert.match(record.payload.accessToken, /^mock-access-token-/)

      const rows = await service.status()
      assert.equal(rows[0].authorized, true)
      assert.equal(rows[0].credentialService, 'ready')
    } finally {
      dispose()
    }
  })
})

test('a failing command shows what the server said', async () => {
  await withMockServers(async ({ as, mcp }) => {
    // The authorization server refuses the registration and says why. That
    // sentence is the part that tells the operator what to change, so the
    // command has to pass it on.
    await as.setScenario({ 'dcr-400': true })

    const { host, dispose } = await startPlugin()
    try {
      const command = host.commands.get('oauth-mcp')
      const result = await command.handler({ rawInput: `authorize ${mcp.endpoint}` })
      assert.equal(result.kind, 'error')
      assert.match(result.text, /Dynamic client registration failed/)
      assert.match(
        result.text,
        /the client metadata was rejected/,
        'the answer of the server is shown',
      )
    } finally {
      dispose()
    }
  })
})

test('one command connects a server the user only knows by its endpoint', async () => {
  await withMockServers(async ({ mcp }) => {
    mcp.setScenario({ 'require-auth': true })
    const { host, dispose } = await startPlugin()
    try {
      const command = host.commands.get('oauth-mcp')
      assert.ok(command, 'the plugin registered the host command')

      // The user only knows the endpoint; the plugin adds the server itself.
      const result = await command.handler({ rawInput: `authorize ${mcp.endpoint}` })
      assert.equal(result.kind, 'success')
      assert.match(result.text, /\[Open the authorization page\]/, 'the answer carries a clickable link')
      assert.match(result.text, /to the server list/, 'the answer says that the server was added')

      const servers = host.config.__volatileValues.servers ?? []
      assert.equal(servers.length, 1, 'the server was written to the configuration')
      assert.equal(servers[0].url, mcp.endpoint)
      assert.equal(servers[0].enabled, true)

      // The link of the markdown link is the authorization URL.
      const authorizationUrl = result.text.match(/<(https?:\/\/[^>]+)>/)?.[1]
      assert.ok(authorizationUrl, 'the answer printed the authorization URL')
      assert.match(authorizationUrl, /code_challenge=/)

      // The browser finishes the login.
      const browser = await fetch(authorizationUrl)
      assert.equal(browser.status, 200)
      const page = await browser.text()
      assert.match(page, /Authorization complete/, 'the callback page confirms the authorization')
      assert.equal(page.includes('code='), false, 'the page does not echo the code')

      // The remote tools are mirrored into the host tool service.
      const serverId = servers[0].id
      assert.equal(
        await waitFor(() => toolNames(host.tools).includes(`mcp_oauth__${serverId}__echo`)),
        true,
        'the remote tools were registered',
      )

      const statusResult = await command.handler({ rawInput: 'status' })
      assert.equal(statusResult.kind, 'success')
      assert.match(statusResult.text, /已授权|authorized/i)
      assert.equal(statusResult.text.includes('mock-access-token-'), false, 'the table holds no token')
    } finally {
      dispose()
    }
  })
})

test('the host authorization flow commits the grant the user granted', async () => {
  await withMockServers(async ({ mcp }) => {
    const { host, dispose } = await startPlugin()
    try {
      const React = createFakeReact()
      const form = createConfigForm(host)
      const Panel = createPanel(React, { getConfigForm: () => form })
      await saveServerInPanel({ React, Panel, server: { id: 'mock', url: mcp.endpoint } })

      const flow = host.flows.get('oauth-mcp/mock')
      assert.ok(flow, 'the plugin registered the authorization flow')

      const notices = []
      const commits = []
      const session = {
        method: 'authorize',
        signal: new AbortController().signal,
        notify: (notice) => notices.push(notice),
        prompt: async () => '',
        commit: async (record) => {
          commits.push(record)
        },
      }

      const running = flow.run(session)
      assert.equal(
        await waitFor(() => notices.length > 0),
        true,
        'the flow notified the user about the authorization URL',
      )
      const authorizationUrl = notices[0]?.url
      assert.ok(authorizationUrl, 'the notice carries the authorization URL')

      const browser = await fetch(authorizationUrl)
      assert.equal(browser.status, 200)

      await running
      assert.equal(commits.length, 1, 'the flow committed the grant')
      assert.equal(commits[0].kind, 'grant')
      assert.match(commits[0].payload.accessToken, /^mock-access-token-/)
      assert.equal(host.records.get('oauth-mcp/mock')?.kind, 'grant', 'the grant reached the credential service')
    } finally {
      dispose()
    }
  })
})
