/**
 * Tests for the settings panel's connection to the host configuration service.
 *
 * The panel only shows the server list when it can read the plugin entry's
 * configuration through the host `configForms` service. That service is
 * provided by a sibling client plugin, so the entry has to inject it; without
 * that injection the panel used to render an empty list that looked like
 * "the servers were lost after a restart".
 *
 * @module dsh-oauth-mcp/test/unit/panel-connection
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createFakeReact } from '../support/fake-react.js'
import { DEPLOYED_SOURCE, PANEL_CONFIG, loadDeployedPanel } from '../support/panel-harness.js'

/**
 * Collect the text of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {string} The joined text.
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

test('the deployed client entry injects the host configuration service', () => {
  const manifests = []
  const evaluate = new Function('window', DEPLOYED_SOURCE)
  evaluate({ __ModuleLoader__: { load: (manifest) => manifests.push(manifest) } })
  assert.equal(manifests.length, 1)
  const module = manifests[0].factory((name) => {
    if (name === 'react') return { createElement: () => null }
    throw new Error(`unexpected require: ${name}`)
  })
  const injected = module.inject
  assert.ok(Array.isArray(injected), 'the entry declares an inject list')
  assert.ok(injected.includes('slots'), 'the entry injects the slot service')
  assert.ok(
    injected.includes('configForms'),
    'the entry injects the host configuration service (a sibling plugin provides it)',
  )
})

test('the deployed panel lists the servers once the configuration service is injected', () => {
  const React = createFakeReact()
  const config = {
    ...PANEL_CONFIG,
    servers: [{ id: 'notion', label: 'notion', url: 'https://mcp.notion.com/mcp', enabled: true }],
  }
  const Panel = loadDeployedPanel(React, config)
  const tree = React.render(Panel, {})
  const text = textOf(tree)
  assert.match(text, /notion/)
  assert.match(text, /https:\/\/mcp\.notion\.com\/mcp/)
  assert.doesNotMatch(text, /没有接上宿主/)
})

test('the deployed panel says so when the configuration service is missing', () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React, PANEL_CONFIG, { provideConfigService: false })
  const tree = React.render(Panel, {})
  const text = textOf(tree)
  assert.match(text, /没有接上宿主/)
  assert.match(text, /\/oauth-mcp status/)
  // The empty-list message would suggest the servers were lost.
  assert.doesNotMatch(text, /还没有配置任何 MCP 服务器/)
})

test('the source panel says so when no configuration form is available', async () => {
  const { createPanel } = await import('../../client/panel.js')
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => undefined })
  const tree = React.render(Panel, {})
  const text = textOf(tree)
  assert.match(text, /没有接上宿主/)
  assert.match(text, /\/oauth-mcp status/)
  assert.doesNotMatch(text, /还没有配置任何 MCP 服务器/)
})
