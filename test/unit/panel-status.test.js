/**
 * Tests of the settings panel server state.
 *
 * Adding a server only writes the configuration, so the panel shows the
 * configuration state (“Enabled” / “Disabled”). The live state — authorized,
 * connected, number of mirrored tools — lives in the host and is reached
 * through the `/oauth-mcp status` command or the `dsh_oauth_mcp_status` tool.
 * The panel therefore has to say that, and it has to make the configuration
 * state easy to scan.
 *
 * Both copies of the panel are checked: the ES module `client/panel.js` and
 * the deployed classic script `client/index.js`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanel } from '../../client/panel.js'
import { collect, createFakeReact } from '../support/fake-react.js'
import {
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
} from '../support/panel-harness.js'

const SERVERS = [
  {
    id: 'notion',
    label: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    scopes: ['default'],
    enabled: true,
  },
  {
    id: 'linear',
    label: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    scopes: ['read'],
    enabled: false,
  },
]

const CONFIG = { ...PANEL_CONFIG, servers: SERVERS }

/**
 * Collect the text of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {string} The concatenated text.
 */
function textOf(tree) {
  const parts = []
  const visit = (node) => {
    if (node === null || node === undefined || node === false) return
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object') return
    visit(node.children)
  }
  visit(tree)
  return parts.join(' ')
}

/**
 * Assert that the panel explains the configuration state.
 *
 * @param {object} tree The rendered tree.
 * @returns {void}
 */
function assertStateSemantics(tree) {
  const badges = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-badge')
  assert.equal(badges.length, 2, 'every server row carries a state badge')

  const enabled = badges[0]
  assert.match(textOf(enabled), /已启用/, 'the first server is shown as enabled')
  assert.equal(enabled.props.style.borderRadius, '999px', 'the badge is a pill')
  assert.notEqual(
    enabled.props.style.color,
    badges[1].props.style.color,
    'the enabled badge differs from the disabled one',
  )
  assert.match(textOf(badges[1]), /已停用/, 'the second server is shown as disabled')

  const text = textOf(tree)
  assert.match(text, /\/oauth-mcp status/, 'the hint points at the status command')
  assert.match(text, /dsh_oauth_mcp_status/, 'the hint points at the status tool')

  for (const badge of badges) {
    for (const value of Object.values(badge.props.style)) {
      if (typeof value !== 'string' || !value.includes('var(')) continue
      assert.match(value, /var\(--dsw-alias-[a-z0-9-]+\)/, 'the badge only uses host tokens')
    }
  }
}

test('the panel module shows the configuration state and explains it', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(CONFIG) })
  assertStateSemantics(React.render(Panel, {}))
})

test('the deployed browser entry shows the configuration state and explains it', () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React, CONFIG)
  assertStateSemantics(React.render(Panel, {}))
})
