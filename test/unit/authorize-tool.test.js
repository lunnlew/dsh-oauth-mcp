/**
 * The authorize tool has three shapes of the same operation: name a server,
 * paste back a callback URL, or ask for the plan only. These cases pin the
 * behaviour the user feels: one step to connect a server, a link that can be
 * clicked, and a way back when the browser could not reach the callback.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAuthorizeTool } from '../../lib/tools/authorize.js'
import { ERROR_CODES, OAuthError } from '../../lib/oauth/errors.js'

const CALLBACK_URL = 'http://127.0.0.1:39271/oauth-mcp/callback?code=the-code&state=the-state'

/**
 * Build a service stub that records what the tool asked for.
 *
 * @param {object} [overrides] The methods to replace.
 * @returns {object} The service stub.
 */
function createFakeService(overrides = {}) {
  const calls = { describe: [], ensure: [], begin: [], complete: [], resolve: [] }
  const service = {
    calls,
    describeServer: async (id) => {
      calls.describe.push(id)
      throw new OAuthError(ERROR_CODES.server_not_found, `Unknown server "${id}".`)
    },
    ensureServer: async (reference) => {
      calls.ensure.push(reference)
      return {
        server: { id: 'notion', label: 'Notion MCP (Beta)', url: reference, scopes: [] },
        registered: true,
      }
    },
    beginAuthorization: async (request) => {
      calls.begin.push(request)
      return {
        status: 'awaiting_user',
        serverId: 'notion',
        registered: /^https?:\/\//i.test(String(request?.server ?? '')),
        authorizationUrl: 'https://auth.example/authorize?client_id=x&state=the-state',
        expiresAt: 1_700_000_000_000,
      }
    },
    completeManual: async (serverId, input) => {
      calls.complete.push({ serverId, input })
    },
    resolveServerByState: (state) => {
      calls.resolve.push(state)
      return ''
    },
    ...overrides,
  }
  return service
}

/**
 * Build the tool with the collaborators the host would provide.
 *
 * @param {object} service The service stub.
 * @param {object} [options] The factory options.
 * @returns {object} The tool definition.
 */
function createTool(service, options = {}) {
  return createAuthorizeTool({
    service,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    callback: { mode: 'dedicated-port', redirectUri: 'http://127.0.0.1:39271/oauth-mcp/callback' },
    config: {
      callbackMode: 'dedicated-port',
      callbackPort: 39271,
      callbackPath: '/oauth-mcp/callback',
      defaultScopes: [],
      ...options.config,
    },
  })
}

test('the tool names one operation and describes the three shapes', () => {
  const tool = createTool(createFakeService())
  assert.equal(tool.name, 'dsh_oauth_mcp_authorize')
  assert.match(tool.description, /server=/)
  assert.match(tool.description, /callbackUrl/)
  assert.match(tool.description, /dryRun/)
  assert.deepEqual(tool.parameters.required, [], 'no argument is mandatory')
  assert.equal(typeof tool.parameters.properties.server.description, 'string')
  assert.equal(typeof tool.parameters.properties.callbackUrl.description, 'string')
})

test('the tool starts the login of a configured server', async () => {
  const service = createFakeService({
    describeServer: async (id) => ({
      id,
      label: 'Notion MCP (Beta)',
      url: 'https://mcp.notion.com/mcp',
      scopes: ['default'],
    }),
  })
  const tool = createTool(service)

  const result = await tool.execute({ server: 'notion' }, {})

  assert.equal(result.status, 'awaiting_user')
  assert.equal(result.serverId, 'notion')
  assert.equal(result.label, 'Notion MCP (Beta)')
  assert.match(result.authorizationUrl, /^https:\/\//)
  assert.deepEqual(service.calls.begin, [{ server: 'notion', source: 'agent', method: 'browser' }])
})

test('the tool adds a server that is only known by its endpoint', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  const result = await tool.execute({ server: 'https://mcp.notion.com/mcp' }, {})

  assert.equal(result.registered, true, 'the endpoint was not configured yet')
  assert.equal(result.serverId, 'notion', 'the known vendor profile named the server')
  assert.equal(result.label, 'Notion MCP (Beta)')
  assert.deepEqual(service.calls.begin, [
    { server: 'https://mcp.notion.com/mcp', source: 'agent', method: 'browser' },
  ])
})

test('the rendered answer carries a clickable link and a copyable line', async () => {
  const service = createFakeService({
    describeServer: async (id) => ({ id, label: 'Notion', url: 'https://mcp.notion.com/mcp', scopes: [] }),
  })
  const tool = createTool(service)
  const result = await tool.execute({ server: 'notion' }, {})

  const [block] = tool.output.render({ server: 'notion' }, result)
  assert.match(block.text, /\[open the authorization page\]\(<https:\/\/[^>]+>\)/)
  assert.match(block.text, /copy this line into the browser/)
  assert.match(block.text, /dsh_oauth_mcp_status/)
})

test('the manual mode tells the user to paste the callback URL back', async () => {
  const service = createFakeService({
    describeServer: async (id) => ({ id, label: 'Notion', url: 'https://mcp.notion.com/mcp', scopes: [] }),
  })
  const tool = createTool(service, { config: { callbackMode: 'manual-only' } })
  const result = await tool.execute({ server: 'notion', method: 'manual' }, {})

  const [block] = tool.output.render({ server: 'notion' }, result)
  assert.match(block.text, /callbackUrl/)
  assert.match(block.text, /address bar/)
})

test('a pasted callback URL finishes the login', async () => {
  const service = createFakeService()
  service.resolveServerByState = (state) => {
    service.calls.resolve.push(state)
    return state === 'the-state' ? 'notion' : ''
  }
  service.describeServer = async (id) => ({ id, label: 'Notion', url: 'https://mcp.notion.com/mcp', scopes: [] })
  const tool = createTool(service)

  const result = await tool.execute({ callbackUrl: CALLBACK_URL }, {})

  assert.equal(result.status, 'authorized')
  assert.equal(result.serverId, 'notion')
  assert.deepEqual(service.calls.complete, [{ serverId: 'notion', input: CALLBACK_URL }])
  assert.deepEqual(service.calls.resolve, ['the-state'])
})

test('a pasted callback URL with a server name resolves the server first', async () => {
  const service = createFakeService({
    describeServer: async (id) => ({ id, label: 'Notion', url: 'https://mcp.notion.com/mcp', scopes: [] }),
  })
  const tool = createTool(service)

  const result = await tool.execute({ server: 'notion', callbackUrl: CALLBACK_URL }, {})

  assert.equal(result.status, 'authorized')
  assert.deepEqual(service.calls.ensure, ['notion'])
  assert.equal(service.calls.complete.length, 1)
})

test('a callback URL without a pending request is refused with a hint', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  await assert.rejects(
    () => tool.execute({ callbackUrl: CALLBACK_URL }, {}),
    (error) => {
      assert.equal(error.code, ERROR_CODES.state_invalid)
      assert.match(error.message, /pending authorization request/)
      return true
    },
  )
  assert.equal(service.calls.complete.length, 0, 'nothing was completed')
})

test('a callback URL the user could not copy is reported', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  await assert.rejects(
    () => tool.execute({ callbackUrl: 'I could not copy it' }, {}),
    (error) => {
      assert.equal(error.code, ERROR_CODES.callback_rejected)
      return true
    },
  )
})

test('without any argument the tool asks for one', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  await assert.rejects(
    () => tool.execute({}, {}),
    (error) => {
      assert.equal(error.code, ERROR_CODES.server_not_found)
      assert.match(error.message, /callbackUrl/)
      return true
    },
  )
})

test('a dry run does not contact the server', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  const result = await tool.execute({ server: 'https://mcp.notion.com/mcp', dryRun: true }, {})

  assert.equal(result.status, 'planned')
  assert.equal(service.calls.begin.length, 0, 'no authorization was started')
  assert.equal(service.calls.ensure.length, 0, 'the configuration was not written')
  assert.ok(result.steps.length > 3, 'the plan lists the steps')
  assert.match(result.nextStep, /Nothing was sent/)
})

test('an unknown server name is reported with the configured identifiers', async () => {
  const service = createFakeService()
  const tool = createTool(service)

  await assert.rejects(
    () => tool.execute({ server: 'nope' }, {}),
    (error) => {
      assert.equal(error.code, ERROR_CODES.server_not_found)
      return true
    },
  )
})

test('the output schema declares the fields the new shapes need', () => {
  const tool = createTool(createFakeService())
  const schema = tool.output.schema
  for (const field of ['serverId', 'label', 'endpoint', 'status', 'method', 'callbackMode', 'redirectUri', 'scopes', 'steps', 'nextStep', 'registered']) {
    assert.ok(schema.properties[field], `the schema declares ${field}`)
  }
  assert.ok(schema.required.includes('nextStep'))
  assert.equal(schema.additionalProperties, false)
})
