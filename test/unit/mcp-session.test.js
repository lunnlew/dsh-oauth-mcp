/**
 * Unit tests of the MCP session lifecycle.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createMcpSession, DEFAULT_PROTOCOL_VERSION } from '../../lib/mcp/session.js'
import { McpError, McpUnauthorizedError } from '../../lib/oauth/errors.js'

/**
 * Build a transport stub whose answers are produced by a script.
 *
 * @param {(message: object, index: number) => object | Error} script The answer factory.
 * @returns {object} The transport stub.
 */
function createTransportStub(script) {
  const sent = []
  return {
    sent,
    sessionId: 'session-1',
    protocolVersion: undefined,
    closed: false,
    async send(message) {
      sent.push(message)
      const answer = script(message, sent.length)
      if (answer instanceof Error) throw answer
      return answer
    },
    async close() {
      this.closed = true
    },
  }
}

/**
 * Build a successful JSON-RPC answer.
 *
 * @param {object} message The request message.
 * @param {unknown} [result] The result of the answer.
 * @returns {object} The answer.
 */
function ok(message, result = {}) {
  return { status: 200, headers: {}, messages: [], response: { jsonrpc: '2.0', id: message.id, result } }
}

/**
 * Build the answer of an accepted notification.
 *
 * @returns {object} The answer.
 */
function accepted() {
  return { status: 202, headers: {}, messages: [], response: undefined }
}

test('session performs the handshake and remembers the negotiated version', async () => {
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') {
      return ok(message, { protocolVersion: '2025-06-18', serverInfo: { name: 'demo', version: '1' } })
    }
    if (message.method === 'notifications/initialized') return accepted()
    return ok(message)
  })

  const session = await createMcpSession({
    transport,
    clientInfo: { name: 'test-client', version: '1.0.0' },
  })

  assert.equal(transport.sent.length, 2)
  assert.equal(transport.sent[0].method, 'initialize')
  assert.deepEqual(transport.sent[0].params, {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  })
  assert.equal(transport.sent[1].method, 'notifications/initialized')
  assert.equal(transport.sent[1].id, undefined)
  assert.equal(session.protocolVersion, '2025-06-18')
  assert.equal(session.serverInfo.name, 'demo')
  assert.equal(transport.protocolVersion, '2025-06-18')
})

test('session forwards the result of a business request', async () => {
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') return ok(message, { protocolVersion: '2025-06-18' })
    if (message.method === 'notifications/initialized') return accepted()
    if (message.method === 'tools/call') {
      return ok(message, { content: [{ type: 'text', text: 'pong' }] })
    }
    return ok(message)
  })
  const session = await createMcpSession({ transport })

  const result = await session.request('tools/call', { name: 'echo' }, { timeoutMs: 1234 })

  assert.deepEqual(result, { content: [{ type: 'text', text: 'pong' }] })
  const call = transport.sent.find((message) => message.method === 'tools/call')
  assert.deepEqual(call.params, { name: 'echo' })
  assert.equal(typeof call.id, 'number')
})

test('session turns a JSON-RPC error into an McpError', async () => {
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') return ok(message)
    if (message.method === 'notifications/initialized') return accepted()
    return {
      status: 200,
      headers: {},
      messages: [],
      response: { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } },
    }
  })
  const session = await createMcpSession({ transport })

  await assert.rejects(
    () => session.request('tools/nope'),
    (error) => error instanceof McpError && error.message === 'Method not found',
  )
})

test('session re-initializes once on 404 and never replays the failed request', async () => {
  let businessCalls = 0
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') return ok(message, { protocolVersion: '2025-06-18' })
    if (message.method === 'notifications/initialized') return accepted()
    businessCalls += 1
    throw new McpError('The MCP server answered with HTTP 404.', { status: 404 })
  })
  const session = await createMcpSession({ transport })

  await assert.rejects(
    () => session.request('tools/call', { name: 'echo' }),
    (error) => error instanceof McpError && error.status === 404,
  )

  assert.equal(businessCalls, 1, 'the failed business request must not be replayed')
  assert.equal(
    transport.sent.filter((message) => message.method === 'initialize').length,
    2,
    'the session must be initialized exactly once more',
  )
  assert.equal(transport.sessionId, undefined, 'the stale session id must be dropped')
})

test('session passes a 401 through without re-initializing', async () => {
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') return ok(message)
    if (message.method === 'notifications/initialized') return accepted()
    throw new McpUnauthorizedError('The MCP server rejected the access token.', { status: 401 })
  })
  const session = await createMcpSession({ transport })

  await assert.rejects(
    () => session.request('tools/call', { name: 'echo' }),
    (error) => error instanceof McpUnauthorizedError && error.status === 401,
  )
  assert.equal(transport.sent.filter((message) => message.method === 'initialize').length, 1)
})

test('session falls back to a known protocol version when the server rejects one', async () => {
  const requested = []
  const transport = createTransportStub((message) => {
    if (message.method === 'initialize') {
      requested.push(message.params.protocolVersion)
      if (message.params.protocolVersion === '2025-06-18') {
        throw new McpError('Unsupported MCP protocol version: 2025-06-18', {
          detail: 'the server supports 2025-03-26',
        })
      }
      return ok(message, { protocolVersion: '2025-03-26' })
    }
    if (message.method === 'notifications/initialized') return accepted()
    return ok(message)
  })

  const session = await createMcpSession({ transport })

  assert.deepEqual(requested, ['2025-06-18', '2025-03-26'])
  assert.equal(session.protocolVersion, '2025-03-26')
})

test('session drives a real transport against a fake MCP server', async () => {
  const fetchImpl = async (url, init) => {
    const message = JSON.parse(init.body)
    if (message.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2025-06-18', serverInfo: { name: 'demo' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } },
      )
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: 'pong' }] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const session = await createMcpSession({ url: 'https://mcp.example.com/rpc', fetchImpl })

  assert.equal(session.sessionId, 'sess-1')
  assert.equal(session.protocolVersion, '2025-06-18')
  const result = await session.request('tools/call', { name: 'echo' })
  assert.deepEqual(result.content, [{ type: 'text', text: 'pong' }])

  await session.close()
})
