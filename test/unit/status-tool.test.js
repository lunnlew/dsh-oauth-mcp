/**
 * Tests of the status tool.
 *
 * The tool is read-only and it publishes a whitelist of fields: a token can
 * never travel with a row, and a field the service adds later does not reach
 * the model by accident.
 *
 * @module dsh-oauth-mcp/test/unit/status-tool
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { STATUS_TOOL_NAME, createStatusTool } from '../../lib/tools/status.js'
import { ERROR_CODES, OAuthError } from '../../lib/oauth/errors.js'

/**
 * Build a service stub that answers with the given rows.
 *
 * @param {object[]} rows The status rows.
 * @param {object} [options] The options.
 * @param {Error} [options.error] The failure the service throws.
 * @returns {object} The service stub.
 */
function createFakeService(rows = [], options = {}) {
  const calls = []
  return {
    calls,
    status: async (serverId) => {
      calls.push(serverId)
      if (options.error) throw options.error
      return rows
    },
  }
}

/**
 * Build the tool with the collaborators the host would provide.
 *
 * @param {object} [options] The overrides.
 * @returns {object} The tool.
 */
function createTool(options = {}) {
  const service = options.service ?? createFakeService([])
  const tool = createStatusTool({
    service,
    logger: options.logger,
    settings: options.settings,
    config: options.config,
  })
  return { tool, service }
}

test('the tool carries the wire name the host registers it under', () => {
  const { tool } = createTool()
  assert.equal(tool.name, STATUS_TOOL_NAME)
  assert.equal(tool.name, 'dsh_oauth_mcp_status')
})

test('the tool is read-only', () => {
  const { tool } = createTool()
  assert.equal(tool.isConcurrencySafe, true)
  assert.deepEqual(tool.parameters.required, [])
  assert.equal(tool.parameters.additionalProperties, false)
})

test('the tool reports every configured server', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: true, connected: true, toolCount: 3 },
  ])
  const { tool } = createTool({ service })

  const rows = await tool.execute({})

  assert.equal(service.calls[0], undefined, 'the service is asked for every server')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].serverId, 'notion')
  assert.equal(rows[0].authorized, true)
  assert.equal(rows[0].toolCount, 3)
})

test('the tool reports one server when it is named', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: true, connected: true, toolCount: 3 },
  ])
  const { tool } = createTool({ service })

  await tool.execute({ serverId: 'notion' })

  assert.equal(service.calls[0], 'notion')
})

test('a row carries only the published fields', async () => {
  const service = createFakeService([
    {
      serverId: 'notion',
      label: 'Notion',
      authorized: true,
      connected: true,
      toolCount: 3,
      accessToken: 'the-secret-token',
      clientSecret: 'the-secret',
      refreshToken: 'the-refresh',
      tools: ['mcp_oauth__notion__search'],
      scopes: ['default'],
    },
  ])
  const { tool } = createTool({ service })

  const [row] = await tool.execute({})

  assert.equal(row.accessToken, undefined, 'the token does not travel with the row')
  assert.equal(row.clientSecret, undefined, 'the secret does not travel with the row')
  assert.equal(row.refreshToken, undefined, 'the refresh token does not travel with the row')
  assert.deepEqual(row.tools, ['mcp_oauth__notion__search'])
  assert.deepEqual(row.scopes, ['default'])
})

test('the optional fields are only there when the service knows them', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: true, connected: true, toolCount: 3 },
  ])
  const { tool } = createTool({ service })

  const [row] = await tool.execute({})

  assert.equal(row.expiresAt, undefined)
  assert.equal(row.lastError, undefined)
  assert.equal(row.credentialService, undefined)
})

test('the credential service state is reported when it is known', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: true, connected: true, toolCount: 3, credentialService: 'missing' },
  ])
  const { tool } = createTool({ service })

  const [row] = await tool.execute({})

  assert.equal(row.credentialService, 'missing')
})

test('an unknown server is an error', async () => {
  const service = createFakeService([])
  const { tool } = createTool({ service })

  await assert.rejects(
    () => tool.execute({ serverId: 'nothing' }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.server_not_found)
      return true
    },
    'the caller learns that the server is unknown',
  )
})

test('a failure of the service keeps its code', async () => {
  const service = createFakeService([], { error: new OAuthError(ERROR_CODES.credential_service_unavailable, 'no credentials') })
  const { tool } = createTool({ service })

  await assert.rejects(
    () => tool.execute({}),
    (error) => {
      assert.equal(error.code, ERROR_CODES.credential_service_unavailable)
      return true
    },
    'the failure of the service reaches the caller',
  )
})

test('the report names the servers that need a new authorization', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: false, needsReauthorization: true },
  ])
  const { tool } = createTool({ service })

  const text = tool.output.render({}, await tool.execute({}))[0].text

  assert.match(text, /notion/, 'the report names the server')
})

test('the report names the servers whose credential service is missing', async () => {
  const service = createFakeService([
    { serverId: 'notion', label: 'Notion', authorized: true, credentialService: 'missing' },
  ])
  const { tool } = createTool({ service })

  const text = tool.output.render({}, await tool.execute({}))[0].text

  assert.ok(text.length > 0, 'the report says something')
})

test('an empty list is reported as such', async () => {
  const service = createFakeService([])
  const { tool } = createTool({ service })

  const text = tool.output.render({}, await tool.execute({}))[0].text

  assert.ok(text.length > 0, 'the report says something')
})
