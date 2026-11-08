/**
 * Unit tests of the tool registry that mirrors remote MCP tools into the host.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createToolRegistry } from '../../lib/mcp/tool-registry.js'

/**
 * Build a stub of the host tool service.
 *
 * @returns {object} The stub, recording every registration and disposal.
 */
function createToolsStub() {
  const calls = []
  const registered = new Map()
  const disposed = []
  return {
    calls,
    registered,
    disposed,
    register(definition) {
      calls.push(definition)
      registered.set(definition.name, definition)
      return () => {
        registered.delete(definition.name)
        disposed.push(definition.name)
      }
    },
  }
}

test('registry registers one host tool per remote tool', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools, toolPrefix: 'mcp_oauth' })

  await registry.sync('srv', [
    {
      name: 'echo',
      description: 'Echoes the given text.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    },
  ])

  assert.equal(tools.registered.size, 1)
  const definition = tools.registered.get('mcp_oauth__srv__echo')
  assert.ok(definition, 'the public name must be prefixed')
  assert.deepEqual(definition.parameters, {
    type: 'object',
    properties: { text: { type: 'string' } },
  })
  assert.ok(definition.output.schema, 'output.schema is mandatory')
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(definition.isConcurrencySafe, true)
  assert.match(definition.description, /Echoes the given text\./)
  assert.match(definition.description, /Use it when/)
  assert.match(definition.description, /report the error/)
})

test('registry marks a mutating tool as not concurrency safe', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'write', annotations: { readOnlyHint: false } }])

  assert.equal(tools.registered.get('mcp_oauth__srv__write').isConcurrencySafe, false)
})

test('registry reports the public names of the tools of one server', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools, toolPrefix: 'mcp_oauth' })

  await registry.sync('srv', [{ name: 'echo' }, { name: 'add' }])
  await registry.sync('other', [{ name: 'ping' }])

  assert.deepEqual(registry.hostToolNames('srv'), ['mcp_oauth__srv__add', 'mcp_oauth__srv__echo'])
  assert.deepEqual(registry.hostToolNames('other'), ['mcp_oauth__other__ping'])
  assert.deepEqual(registry.hostToolNames('missing'), [])
})

test('registry calls the injected executor', async () => {
  const tools = createToolsStub()
  const calls = []
  const registry = createToolRegistry({
    tools,
    callTool: async (...args) => {
      calls.push(args)
      return [{ type: 'text', text: 'ok' }]
    },
  })

  await registry.sync('srv', [{ name: 'echo' }])
  const definition = tools.registered.get('mcp_oauth__srv__echo')
  const result = await definition.execute({ text: 'hi' }, {})

  assert.deepEqual(result, [{ type: 'text', text: 'ok' }])
  assert.equal(calls[0][0], 'srv')
  assert.equal(calls[0][1], 'echo')
  assert.deepEqual(calls[0][2], { text: 'hi' })
})

test('registry answers with an error result when no executor is available', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'echo' }])
  const definition = tools.registered.get('mcp_oauth__srv__echo')

  const result = await definition.execute({}, {})

  assert.ok(Array.isArray(result))
  assert.equal(result.length, 1)
  assert.equal(result[0].type, 'text')
  assert.match(result[0].text, /not available/)
})

test('registry unregisters the tools that disappeared', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'a' }, { name: 'b' }])
  await registry.sync('srv', [{ name: 'a' }])

  assert.equal(tools.registered.size, 1)
  assert.ok(tools.registered.has('mcp_oauth__srv__a'))
  assert.ok(tools.disposed.includes('mcp_oauth__srv__b'))
})

test('registry replaces a tool whose definition changed', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'a', description: 'One.' }])
  await registry.sync('srv', [{ name: 'a', description: 'Two.' }])

  assert.equal(tools.calls.length, 2)
  assert.match(tools.registered.get('mcp_oauth__srv__a').description, /Two\./)
})

test('registry skips a name that is already taken and logs it', async () => {
  const tools = createToolsStub()
  const logs = []
  const registry = createToolRegistry({
    tools,
    logger: {
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  })

  await registry.sync('a', [{ name: 'b__c' }])
  await registry.sync('a__b', [{ name: 'c' }])

  assert.equal(tools.registered.size, 1)
  assert.ok(logs.some((args) => String(args[0]).includes('already taken')))
})

test('registry builds a lower-case public name', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  assert.equal(registry.hostToolName('Srv', 'My Tool'), 'mcp_oauth__srv__my_tool')
  assert.equal(registry.hostToolName('srv', 'a.b'), 'mcp_oauth__srv__a_b')
})

test('registry renders the content blocks of a remote result', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'echo' }])
  const { render } = tools.registered.get('mcp_oauth__srv__echo').output

  const rendered = render(
    {},
    [
      { type: 'text', text: 'hello' },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'audio' },
    ],
  )

  assert.equal(rendered.length, 3)
  assert.deepEqual(rendered[0], { type: 'text', text: 'hello' })
  assert.equal(rendered[1].type, 'text')
  assert.match(rendered[1].text, /image\/png/)
  assert.ok(!rendered[1].text.includes('AAAA'))
  assert.equal(rendered[2].type, 'text')
  assert.match(rendered[2].text, /audio/)
})

test('registry unregisters a whole server and disposes everything', async () => {
  const tools = createToolsStub()
  const registry = createToolRegistry({ tools })

  await registry.sync('srv', [{ name: 'a' }, { name: 'b' }])
  await registry.sync('other', [{ name: 'c' }])

  registry.unregisterServer('srv')
  assert.equal(tools.registered.size, 1)
  assert.ok(tools.registered.has('mcp_oauth__other__c'))

  registry.dispose()
  assert.equal(tools.registered.size, 0)
})
