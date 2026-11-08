/**
 * Unit tests of the remote tool executor.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createToolExecutor } from '../../lib/mcp/tool-executor.js'
import { McpError } from '../../lib/oauth/errors.js'

/**
 * Build a session stub whose answers are produced by a script.
 *
 * @param {(method: string, params: object) => unknown} script The answer factory.
 * @returns {object} The session stub.
 */
function createSessionStub(script) {
  const calls = []
  return {
    calls,
    async request(method, params, options) {
      calls.push({ method, params, options })
      return script(method, params)
    },
  }
}

test('executor calls tools/call and returns the content blocks', async () => {
  const session = createSessionStub(() => ({ content: [{ type: 'text', text: 'pong' }] }))
  const executor = createToolExecutor({ session })

  const blocks = await executor.callTool('srv', 'echo', { text: 'hi' })

  assert.deepEqual(blocks, [{ type: 'text', text: 'pong' }])
  assert.equal(session.calls[0].method, 'tools/call')
  assert.deepEqual(session.calls[0].params, { name: 'echo', arguments: { text: 'hi' } })
})

test('executor passes the timeout to the session', async () => {
  const session = createSessionStub(() => ({ content: [] }))
  const executor = createToolExecutor({ session, timeoutMs: 1234 })

  await executor.callTool('srv', 'echo', {})
  assert.equal(session.calls[0].options.timeoutMs, 1234)

  await executor.callTool('srv', 'echo', {}, { timeoutMs: 99 })
  assert.equal(session.calls[1].options.timeoutMs, 99)
})

test('executor lists the tools of a server', async () => {
  const descriptors = [{ name: 'echo', inputSchema: { type: 'object' } }]
  const session = createSessionStub(() => ({ tools: descriptors }))
  const executor = createToolExecutor({ session })

  const tools = await executor.listTools('srv')

  assert.deepEqual(tools, descriptors)
  assert.equal(session.calls[0].method, 'tools/list')
})

test('executor follows the pagination cursor', async () => {
  const pages = [{ tools: [{ name: 'a' }], nextCursor: 'page-2' }, { tools: [{ name: 'b' }] }]
  let page = 0
  const session = createSessionStub(() => pages[page++])
  const executor = createToolExecutor({ session })

  const tools = await executor.listTools('srv')

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['a', 'b'],
  )
  assert.deepEqual(session.calls[1].params, { cursor: 'page-2' })
})

test('executor resolves the session of a server from a map', async () => {
  const session = createSessionStub(() => ({ content: [] }))
  const executor = createToolExecutor({ session: new Map([['srv', session]]) })

  await executor.callTool('srv', 'echo', {})
  assert.equal(session.calls.length, 1)
})

test('executor reports a missing session', async () => {
  const executor = createToolExecutor({ session: new Map() })

  await assert.rejects(
    () => executor.callTool('srv', 'echo', {}),
    (error) => error instanceof McpError && error.code === 'server_not_found',
  )
})
