import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createServerList } from '../../lib/store/server-list.js'

/**
 * Build a fake settings service.
 *
 * @returns {{ update: (entryId: string, patch: object) => Promise<void>, calls: Array<{ entryId: string, patch: object }> }}
 *   The fake settings service.
 */
function createFakeSettings() {
  const calls = []
  return {
    calls,
    async update(entryId, patch) {
      calls.push({ entryId, patch })
    },
  }
}

const ENTRY_ID = 'dsh-oauth-mcp'

test('the server list reads the configured servers', () => {
  const serverList = createServerList({
    config: {
      servers: [
        { id: 'alpha', label: 'Alpha', url: 'https://alpha.example.com/mcp' },
        { id: 'beta', label: 'Beta', url: 'https://beta.example.com/mcp', scopes: ['read'] },
      ],
    },
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  const servers = serverList.list()
  assert.equal(servers.length, 2)
  assert.equal(servers[0].id, 'alpha')
  assert.equal(servers[1].scopes[0], 'read')
})

test('the server list drops configured servers with an invalid id', () => {
  const serverList = createServerList({
    config: {
      servers: [
        { id: 'Alpha', url: 'https://alpha.example.com/mcp' },
        { id: '-beta', url: 'https://beta.example.com/mcp' },
        { id: 'gamma_1', url: 'https://gamma.example.com/mcp' },
      ],
    },
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  assert.deepEqual(
    serverList.list().map((server) => server.id),
    ['gamma_1'],
  )
})

test('the server list reads one server by id', () => {
  const serverList = createServerList({
    config: { servers: [{ id: 'alpha', url: 'https://alpha.example.com/mcp' }] },
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  assert.equal(serverList.get('alpha')?.url, 'https://alpha.example.com/mcp')
  assert.equal(serverList.get('missing'), undefined)
})

test('the server list returns copies of its entries', () => {
  const serverList = createServerList({
    config: { servers: [{ id: 'alpha', url: 'https://alpha.example.com/mcp' }] },
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  const entry = serverList.get('alpha')
  entry.label = 'changed'
  assert.equal(serverList.get('alpha').label, undefined)
})

test('the server list adds a server and persists the list', async () => {
  const settings = createFakeSettings()
  const serverList = createServerList({ config: {}, settings, entryId: ENTRY_ID })

  const servers = await serverList.upsert({
    id: 'alpha',
    label: 'Alpha',
    url: 'https://alpha.example.com/mcp',
    scopes: 'read write',
  })

  assert.equal(servers.length, 1)
  assert.deepEqual(servers[0].scopes, ['read', 'write'])
  assert.equal(settings.calls.length, 1)
  assert.equal(settings.calls[0].entryId, ENTRY_ID)
  assert.equal(settings.calls[0].patch.servers.length, 1)
  assert.equal(settings.calls[0].patch.servers[0].id, 'alpha')
})

test('the server list replaces a server with the same id', async () => {
  const settings = createFakeSettings()
  const serverList = createServerList({
    config: { servers: [{ id: 'alpha', label: 'Old', url: 'https://old.example.com/mcp' }] },
    settings,
    entryId: ENTRY_ID,
  })

  const servers = await serverList.upsert({
    id: 'alpha',
    label: 'New',
    url: 'https://new.example.com/mcp',
  })

  assert.equal(servers.length, 1)
  assert.equal(servers[0].label, 'New')
  assert.equal(servers[0].url, 'https://new.example.com/mcp')
})

test('the server list defaults the label to the id', async () => {
  const serverList = createServerList({
    config: {},
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  const servers = await serverList.upsert({ id: 'alpha', url: 'https://alpha.example.com/mcp' })
  assert.equal(servers[0].label, 'alpha')
})

test('the server list rejects a malformed server', async () => {
  const serverList = createServerList({
    config: {},
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  await assert.rejects(() => serverList.upsert(null), TypeError)
  await assert.rejects(() => serverList.upsert({ id: 'Alpha', url: 'https://a.example.com' }), TypeError)
  await assert.rejects(() => serverList.upsert({ id: 'alpha' }), TypeError)
  await assert.rejects(() => serverList.upsert({ id: 'alpha', url: 'not a url' }), TypeError)
  await assert.rejects(() => serverList.upsert({ id: 'alpha', url: 'ftp://a.example.com' }), TypeError)
})

test('the server list removes a server and persists the list', async () => {
  const settings = createFakeSettings()
  const serverList = createServerList({
    config: {
      servers: [
        { id: 'alpha', url: 'https://alpha.example.com/mcp' },
        { id: 'beta', url: 'https://beta.example.com/mcp' },
      ],
    },
    settings,
    entryId: ENTRY_ID,
  })

  const servers = await serverList.remove('alpha')

  assert.deepEqual(
    servers.map((server) => server.id),
    ['beta'],
  )
  assert.equal(settings.calls.length, 1)
  assert.equal(settings.calls[0].patch.servers.length, 1)
})

test('the server list does not persist a removal of an unknown server', async () => {
  const settings = createFakeSettings()
  const serverList = createServerList({ config: {}, settings, entryId: ENTRY_ID })

  const servers = await serverList.remove('alpha')

  assert.deepEqual(servers, [])
  assert.equal(settings.calls.length, 0)
})

test('the server list rejects a malformed removal id', async () => {
  const serverList = createServerList({
    config: {},
    settings: createFakeSettings(),
    entryId: ENTRY_ID,
  })

  await assert.rejects(() => serverList.remove('Alpha'), TypeError)
})

test('the server list fails loudly when the host has no settings service', async () => {
  const serverList = createServerList({ config: {}, entryId: ENTRY_ID })

  await assert.rejects(
    () => serverList.upsert({ id: 'alpha', url: 'https://alpha.example.com/mcp' }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'The host settings service is unavailable.')
      return true
    },
  )
})
