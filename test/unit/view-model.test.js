/**
 * Tests of the view models that leave the host side of the plugin.
 *
 * @module dsh-oauth-mcp/test/unit/view-model
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  renderScopeDetails,
  renderStatusTable,
  renderToolTable,
  sortStatusRows,
  toServerView,
  toStatusRow,
} from '../../lib/view-model.js'
import { createTranslator } from '../../lib/i18n/index.js'
import { displayWidth } from '../../lib/util/width.js'

const SECRET = 'super-secret-access-token-value'

/**
 * Build a grant payload.
 *
 * @param {object} [overrides] The fields to override.
 * @returns {object} The grant payload.
 */
function grant(overrides = {}) {
  return {
    serverId: 'mock',
    serverUrl: 'https://mcp.example.com/mcp',
    resource: 'https://mcp.example.com/mcp',
    clientId: 'client-1',
    accessToken: SECRET,
    tokenType: 'Bearer',
    redirectUri: 'http://127.0.0.1:39271/oauth-mcp/callback',
    scopes: ['read', 'write'],
    obtainedAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  }
}

test('a server without a grant is not authorized and needs a new authorization', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' })
  assert.equal(view.id, 'mock')
  assert.equal(view.label, 'Mock')
  assert.equal(view.url, 'https://mcp.example.com/mcp')
  assert.equal(view.enabled, true)
  assert.equal(view.authorized, false)
  assert.equal(view.hasRefreshToken, false)
  assert.equal(view.needsReauthorization, true)
  assert.equal(view.connected, false)
  assert.equal(view.toolCount, 0)
  assert.deepEqual(view.scopes, [])
})

test('the label falls back to the identifier', () => {
  const view = toServerView({ id: 'mock', url: 'https://mcp.example.com/mcp' })
  assert.equal(view.label, 'mock')
})

test('a stored grant makes the server authorized', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant(),
  })
  assert.equal(view.authorized, true)
  assert.equal(view.needsReauthorization, false)
  assert.equal(view.hasRefreshToken, false)
  assert.equal(typeof view.expiresAt, 'number')
})

test('an expired grant without a refresh token needs a new authorization', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant({ expiresAt: Date.now() - 1_000 }),
  })
  assert.equal(view.authorized, true)
  assert.equal(view.needsReauthorization, true)
})

test('an expired grant with a refresh token can renew itself', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant({ expiresAt: Date.now() - 1_000, refreshToken: 'refresh-value' }),
  })
  assert.equal(view.hasRefreshToken, true)
  assert.equal(view.needsReauthorization, false)
})

test('a live session makes the server connected', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant(),
    session: { closed: false },
    toolCount: 4,
  })
  assert.equal(view.connected, true)
  assert.equal(view.toolCount, 4)
})

test('a closed session is not connected', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant(),
    session: { closed: true },
  })
  assert.equal(view.connected, false)
})

test('the view never carries a token', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant({ refreshToken: 'refresh-value', clientSecret: 'secret-value' }),
  })
  const serialized = JSON.stringify(view)
  assert.ok(!serialized.includes(SECRET))
  assert.ok(!serialized.includes('refresh-value'))
  assert.ok(!serialized.includes('secret-value'))
  assert.ok(!Object.hasOwn(view, 'accessToken'))
})

test('the last error is shortened and redacted', () => {
  const view = toServerView({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    session: { closed: false, lastError: `Bearer ${SECRET} was rejected` },
  })
  assert.equal(typeof view.lastError, 'string')
  assert.ok(!view.lastError.includes(SECRET))
  assert.ok(view.lastError.length <= 200)
})

test('a status row reports the granted scopes', () => {
  const row = toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp', scopes: ['a'] }, {
    grant: grant({ scopes: ['read', 'write'] }),
  })
  assert.equal(row.serverId, 'mock')
  assert.equal(row.label, 'Mock')
  assert.equal(row.authorized, true)
  assert.deepEqual(row.scopes, ['read', 'write'])
  assert.equal(row.needsReauthorization, false)
})

test('a status row of a server without a grant reports the configured scopes', () => {
  const row = toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp', scopes: ['a', 'b'] })
  assert.deepEqual(row.scopes, ['a', 'b'])
  assert.equal(row.authorized, false)
  assert.equal(row.needsReauthorization, true)
})

test('the status rows are ordered by the server identifier', () => {
  const rows = [
    { serverId: 'zeta', label: 'Zeta' },
    { serverId: 'alpha', label: 'Alpha' },
    { serverId: 'mu', label: 'Mu' },
  ]
  assert.deepEqual(
    sortStatusRows(rows).map((row) => row.serverId),
    ['alpha', 'mu', 'zeta'],
  )
})

test('the status table carries the number of scopes, not the scopes themselves', () => {
  const scopes = Array.from({ length: 13 }, (_, index) => `mcp-tool:group-${index}:read`)
  const table = renderStatusTable([
    toStatusRow({ id: 'feishu', label: 'Feishu', url: 'https://mcp.feishu.cn/mcp' }, {
      grant: grant({ scopes }),
    }),
  ])

  assert.ok(!table.includes('mcp-tool:group-0:read'), 'the table does not carry a scope name')
  assert.ok(table.includes('13'), 'the table carries the number of scopes')
  // The table stays narrow: a vendor may publish fifty scopes.
  for (const line of table.split('\n')) {
    assert.ok(displayWidth(line) < 120, 'the line of the table stays narrow')
  }
})

test('the scopes of every server are printed below the table', () => {
  const details = renderScopeDetails([
    toStatusRow({ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp' }, {
      grant: grant({ scopes: ['default'] }),
    }),
    toStatusRow({ id: 'feishu', label: 'Feishu', url: 'https://mcp.feishu.cn/mcp' }, {
      grant: grant({ scopes: ['mcp-tool:common:get-user', 'mcp-tool:common:search-user'] }),
    }),
  ])

  assert.ok(details.includes('Notion'), 'every server is named')
  assert.ok(details.includes('Feishu'), 'every server is named')
  assert.ok(details.includes('default'), 'the scopes are listed')
  assert.ok(details.includes('mcp-tool:common:get-user'), 'the scopes are listed')
  assert.ok(
    details.indexOf('Feishu') < details.indexOf('Notion') || details.indexOf('Notion') < details.indexOf('Feishu'),
    'the servers keep the order of the table',
  )
})

test('there are no scope details when no server has a scope', () => {
  assert.equal(renderScopeDetails([]), '')
  assert.equal(
    renderScopeDetails([toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' })]),
    '',
  )
})

test('the status table lists every server', () => {
  const table = renderStatusTable([
    toStatusRow({ id: 'zeta', label: 'Zeta', url: 'https://z.example.com/mcp' }),
    toStatusRow({ id: 'alpha', label: 'Alpha', url: 'https://a.example.com/mcp' }),
  ])
  assert.ok(table.includes('alpha'))
  assert.ok(table.includes('zeta'))
  assert.ok(table.indexOf('alpha') < table.indexOf('zeta'))
  assert.ok(table.includes('Server'))
})

test('the status table is empty without a server', () => {
  assert.equal(renderStatusTable([]), 'No MCP server is configured yet.')
})

test('the status table never shows a token', () => {
  const table = renderStatusTable([
    toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, { grant: grant() }),
  ])
  assert.ok(!table.includes(SECRET))
  assert.ok(!table.toLowerCase().includes('token'))
})

test('the columns of the status table line up', () => {
  const table = renderStatusTable([
    toStatusRow({ id: 'notion', label: 'Notion 笔记', url: 'https://mcp.notion.com/mcp' }, {
      grant: grant({ scopes: ['default'] }),
    }),
    toStatusRow({ id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp' }),
  ])
  const lines = table.split('\n')

  /**
   * The column at which every cell starts.
   *
   * The cells are separated by two spaces; the padding of a cell runs into
   * that separator, so the cells are found by scanning the runs of spaces.
   *
   * @param {string} line The table line.
   * @returns {number[]} The offsets in display columns.
   */
  function offsets(line) {
    const found = [0]
    let column = 0
    let index = 0
    while (index < line.length) {
      if (line[index] === ' ') {
        let run = 0
        while (line[index + run] === ' ') run += 1
        column += run
        index += run
        if (run >= 2) found.push(column)
        continue
      }
      column += displayWidth(line[index])
      index += 1
    }
    return found
  }

  const header = offsets(lines[0])
  assert.ok(header.length >= 8, 'the table has eight columns')
  for (const line of lines.slice(1)) {
    assert.deepEqual(offsets(line), header, 'every row starts its columns in the same place')
  }
})

test('the expiry column stays short', () => {
  const table = renderStatusTable([
    toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
      grant: grant({ expiresAt: Date.now() + 30 * 60_000 }),
    }),
  ])
  assert.match(table, /in \d+m/)
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(table), 'the table does not print an ISO timestamp')
})

test('a status row lists the tools the server exposes', () => {
  const row = toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, {
    grant: grant(),
    toolNames: ['mcp_oauth__mock__echo', 'mcp_oauth__mock__add'],
  })
  assert.deepEqual(row.tools, ['mcp_oauth__mock__echo', 'mcp_oauth__mock__add'])
})

test('a status row of a server without tools lists no tool', () => {
  const row = toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' })
  assert.deepEqual(row.tools, [])
})

test('the tool table shows the callable name, the remote name and the description', () => {
  const table = renderToolTable([
    {
      serverId: 'notion',
      label: 'Notion 笔记',
      connected: true,
      authorized: true,
      tools: [
        { name: 'mcp_oauth__notion__search', remoteName: 'search', description: 'Search pages' },
        { name: 'mcp_oauth__notion__fetch', remoteName: 'fetch', description: 'Fetch one page' },
      ],
    },
  ], createTranslator('en'))
  assert.ok(table.includes('mcp_oauth__notion__search'))
  assert.ok(table.includes('search'))
  assert.ok(table.includes('Search pages'))
  assert.ok(table.includes('Connected'))
})

test('the tool table of a server without tools says so', () => {
  const table = renderToolTable([
    { serverId: 'mock', label: 'Mock', connected: false, authorized: false, tools: [] },
  ], createTranslator('en'))
  assert.ok(table.includes('Not authorized'))
  assert.ok(table.includes('no tools yet'))
})

test('the tables are written in the language of the translator', () => {
  const rows = [
    toStatusRow({ id: 'mock', label: 'Mock', url: 'https://mcp.example.com/mcp' }, { grant: grant() }),
  ]
  const groups = [
    { serverId: 'mock', label: 'Mock', connected: false, authorized: false, tools: [] },
  ]

  const english = [renderStatusTable(rows, createTranslator('en')), renderToolTable(groups, createTranslator('en'))]
  const chinese = [renderStatusTable(rows, createTranslator('zh')), renderToolTable(groups, createTranslator('zh'))]

  assert.ok(english[0].includes('Authorized'))
  assert.ok(english[1].includes('no tools yet'))
  assert.ok(chinese[0].includes('已授权'))
  assert.ok(chinese[1].includes('暂时没有工具'))
})

test('the tool table never shows a token', () => {
  const table = renderToolTable([
    {
      serverId: 'mock',
      label: 'Mock',
      connected: true,
      authorized: true,
      tools: [{ name: 'mcp_oauth__mock__echo', remoteName: 'echo', description: `Bearer ${SECRET}` }],
    },
  ])
  assert.ok(!table.includes(SECRET))
})
