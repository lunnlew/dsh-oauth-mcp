/**
 * Unit tests of the streamable-http JSON-RPC transport.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createMcpTransport, DEFAULT_REQUEST_TIMEOUT_MS } from '../../lib/mcp/transport.js'
import { McpError, McpUnauthorizedError, McpForbiddenError } from '../../lib/oauth/errors.js'

/**
 * Build a fake `fetch` that records its calls.
 *
 * @param {(url: string, init: object) => Response | Promise<Response>} handler The answer factory.
 * @returns {Function & { calls: object[] }} The fake fetch.
 */
function createFetchStub(handler) {
  const calls = []
  const stub = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  stub.calls = calls
  return stub
}

/**
 * Read a header of a recorded request.
 *
 * @param {object} call The recorded call.
 * @param {string} name The header name.
 * @returns {string | null} The header value.
 */
function headerOf(call, name) {
  return new Headers(call.init.headers).get(name)
}

test('transport posts JSON-RPC messages with the MCP headers', async () => {
  const fetchImpl = createFetchStub(
    () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  const answer = await transport.send({ jsonrpc: '2.0', id: 7, method: 'ping' })

  assert.equal(answer.status, 200)
  assert.deepEqual(answer.response, { jsonrpc: '2.0', id: 7, result: { ok: true } })
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].url, 'https://mcp.example.com/rpc')
  assert.equal(fetchImpl.calls[0].init.method, 'POST')
  assert.equal(headerOf(fetchImpl.calls[0], 'content-type'), 'application/json')
  assert.equal(headerOf(fetchImpl.calls[0], 'accept'), 'application/json, text/event-stream')
  assert.equal(headerOf(fetchImpl.calls[0], 'mcp-session-id'), null)
  assert.equal(headerOf(fetchImpl.calls[0], 'mcp-protocol-version'), null)
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { jsonrpc: '2.0', id: 7, method: 'ping' })
})

test('transport remembers and echoes the session id and the protocol version', async () => {
  const fetchImpl = createFetchStub((_url, init) => {
    const { id } = JSON.parse(init.body)
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-42' },
    })
  })
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  assert.equal(transport.sessionId, 'session-42')

  transport.protocolVersion = '2025-06-18'
  await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

  assert.equal(headerOf(fetchImpl.calls[1], 'mcp-session-id'), 'session-42')
  assert.equal(headerOf(fetchImpl.calls[1], 'mcp-protocol-version'), '2025-06-18')
})

test('transport parses a server-sent event answer', async () => {
  const body = [
    'event: message',
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}',
    '',
    '',
  ].join('\n')
  const fetchImpl = createFetchStub(
    () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  )
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  const answer = await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })

  assert.equal(answer.messages.length, 2)
  assert.deepEqual(answer.response, { jsonrpc: '2.0', id: 3, result: { tools: [] } })
})

test('transport skips notifications until the matching answer arrives', async () => {
  const body = [
    'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
    '',
    'data: {"jsonrpc":"2.0","id":9,"result":{"done":true}}',
    '',
    '',
  ].join('\n')
  const fetchImpl = createFetchStub(
    () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  )
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  const answer = await transport.send({ jsonrpc: '2.0', id: 9, method: 'tools/call' })

  assert.equal(answer.messages.length, 2)
  assert.deepEqual(answer.response.result, { done: true })
})

test('transport accepts a notification answer of 202 without a body', async () => {
  const fetchImpl = createFetchStub(() => new Response(null, { status: 202 }))
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  const answer = await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  assert.equal(answer.status, 202)
  assert.deepEqual(answer.messages, [])
  assert.equal(answer.response, undefined)
})

test('transport maps 401 and 403 to the dedicated error classes', async () => {
  const unauthorized = createMcpTransport({
    url: 'https://mcp.example.com/rpc',
    fetchImpl: createFetchStub(() => new Response('no token', { status: 401 })),
  })
  await assert.rejects(
    () => unauthorized.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    (error) => error instanceof McpUnauthorizedError && error.status === 401,
  )

  const forbidden = createMcpTransport({
    url: 'https://mcp.example.com/rpc',
    fetchImpl: createFetchStub(
      () =>
        new Response('denied', {
          status: 403,
          headers: { 'www-authenticate': 'Bearer scope="mcp:write"' },
        }),
    ),
  })
  await assert.rejects(
    () => forbidden.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    (error) =>
      error instanceof McpForbiddenError &&
      error.status === 403 &&
      Array.isArray(error.missingScopes) &&
      error.missingScopes.includes('mcp:write'),
  )
})

test('transport reports other HTTP failures as McpError', async () => {
  const transport = createMcpTransport({
    url: 'https://mcp.example.com/rpc',
    fetchImpl: createFetchStub(() => new Response('boom', { status: 500 })),
  })
  await assert.rejects(
    () => transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    (error) => error instanceof McpError && error.status === 500,
  )
})

test('transport rejects a request that times out', async () => {
  const fetchImpl = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  const transport = createMcpTransport({ url: 'https://mcp.example.com/rpc', fetchImpl })

  await assert.rejects(
    () => transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { timeoutMs: 25 }),
    (error) => error instanceof McpError && /timed out/i.test(error.message),
  )
})

test('transport never leaks a token into an error message', async () => {
  const transport = createMcpTransport({
    url: 'https://mcp.example.com/rpc',
    fetchImpl: createFetchStub(
      () => new Response('Bearer secret-token-value', { status: 401, headers: { 'content-type': 'text/plain' } }),
    ),
  })
  await assert.rejects(
    () => transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    (error) => {
      assert.ok(!(error.message ?? '').includes('secret-token-value'))
      assert.ok(!(error.detail ?? '').includes('secret-token-value'))
      return true
    },
  )
})

test('transport exposes a default request timeout', () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 60_000)
})
