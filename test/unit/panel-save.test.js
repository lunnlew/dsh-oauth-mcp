/**
 * Tests of the way the settings panel stores a server.
 *
 * The panel exists in two copies (the ES module and the deployed classic
 * script) and both are checked here, because the browser only ever runs the
 * second one. The two copies drifted once: the module dropped the
 * authorization server and the client id on save while the deployed copy kept
 * them. The test that would have caught it lives here.
 *
 * @module dsh-oauth-mcp/test/unit/panel-save
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanel } from '../../client/panel.js'
import {
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
} from '../support/panel-harness.js'
import { buttons, collect, createFakeReact, inputs, selects } from '../support/fake-react.js'

const CONFIG = { ...PANEL_CONFIG, servers: [] }

/**
 * The text of a node.
 *
 * @param {object} node The node.
 * @returns {string} The text.
 */
function textOf(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (!node || typeof node !== 'object') return ''
  return textOf(node.children)
}

/**
 * Wait for the pending work of the panel to settle.
 *
 * @returns {Promise<void>} Resolves after the next turn of the event loop.
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Fill the draft form of a rendered panel.
 *
 * @param {object} tree The rendered tree of the draft form.
 * @param {Record<string, string>} values The field values.
 * @returns {void}
 */
function fillDraft(tree, values) {
  for (const [key, value] of Object.entries(values)) {
    const field = collect(tree, (node) => node.props?.key === key)[0]
    assert.ok(field, `the draft form has the "${key}" field`)
    const input = inputs(field)[0]
    assert.ok(input, `the "${key}" field has an input`)
    input.props.onChange({ target: { value } })
  }
}

/**
 * Save the draft form and return what the panel asked the host to store.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @param {object} form The fake configuration form.
 * @param {Record<string, string>} values The field values.
 * @returns {Promise<object>} The server entry the panel wrote.
 */
async function saveServer(React, Panel, form, values) {
  let tree = React.render(Panel, {})
  const serversSection = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-section')[0]
  assert.ok(serversSection, 'the panel shows the server section')
  buttons(serversSection).at(-1).props.onClick()

  tree = React.render(Panel, {})
  let dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(dialog, 'the panel shows the draft form')

  // The vendor decides whether the form shows a client id field, so the
  // vendor is picked first.
  const vendorField = collect(dialog, (node) => node.props?.key === 'vendor')[0]
  assert.ok(vendorField, 'the draft form has the "vendor" field')
  const picker = selects(vendorField)[0]
  assert.ok(picker, 'the vendor field has a picker')
  picker.props.onChange({ target: { value: 'github' } })

  tree = React.render(Panel, {})
  dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  fillDraft(dialog, values)

  tree = React.render(Panel, {})
  const form2 = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  const actions = form2.children.at(-1)
  const saveButton = buttons(actions)[0]
  assert.ok(saveButton, 'the draft form has the "save" button')
  saveButton.props.onClick()
  await flush()

  const write = form.writes.find((entry) => entry?.op === 'set' && entry?.path?.[0] === 'servers')
  assert.ok(write, 'the panel wrote the server list')
  return write.value[0]
}

/**
 * Assert that the panel stores every field of the draft.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @param {object} form The fake configuration form the panel writes to.
 * @returns {Promise<void>}
 */
async function assertServerIsStored(React, Panel, form) {
  const entry = await saveServer(React, Panel, form, {
    id: 'github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    scopes: 'repo, user',
    authorizationServerUrl: 'https://github.com/login/oauth',
    clientId: 'the-client-id',
    clientSecret: 'the-client-secret',
  })

  assert.equal(entry.id, 'github', 'the server keeps its id')
  assert.equal(entry.url, 'https://api.githubcopilot.com/mcp/', 'the server keeps its address')
  assert.deepEqual(entry.scopes, ['repo', 'user'], 'the server keeps its scopes')
  assert.equal(
    entry.authorizationServerUrl,
    'https://github.com/login/oauth',
    'the server keeps the authorization server address',
  )
  assert.equal(entry.clientId, 'the-client-id', 'the server keeps the client id')
  assert.equal(entry.clientSecret, 'the-client-secret', 'the server keeps the client secret')
}

/**
 * Assert that editing a server keeps the vendor profile.
 *
 * The profile is the plugin's own note about the server. It is not in the
 * form, so saving the form has to carry it over.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @param {object} form The fake configuration form the panel writes to.
 * @returns {Promise<void>}
 */
async function assertProfileSurvives(React, Panel, form) {
  let tree = React.render(Panel, {})
  const row = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-row')[0]
  assert.ok(row, 'the panel shows the server row')
  const edit = buttons(row).at(0)
  assert.ok(edit, 'the server row has an "edit" button')
  edit.props.onClick()

  tree = React.render(Panel, {})
  const dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(dialog, 'the panel shows the draft form')
  fillDraft(dialog, { label: 'Notion 工作区' })

  tree = React.render(Panel, {})
  const form2 = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  buttons(form2.children.at(-1))[0].props.onClick()
  await flush()

  const write = form.writes.find((entry) => entry?.op === 'set' && entry?.path?.[0] === 'servers')
  assert.ok(write, 'the panel wrote the server list')
  assert.equal(write.value[0].profile, 'notion', 'the vendor profile survived the edit')
  assert.equal(write.value[0].label, 'Notion 工作区', 'the new label was stored')
}

test('the panel stores every field of the draft', async () => {
  const React = createFakeReact()
  const form = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  await assertServerIsStored(React, Panel, form)
})

test('the deployed browser entry stores every field of the draft', async () => {
  const React = createFakeReact()
  const form = createFakeConfigForm(CONFIG)
  const Panel = loadDeployedPanel(React, CONFIG, { form })
  await assertServerIsStored(React, Panel, form)
})

test('editing a server keeps the vendor profile', async () => {
  const React = createFakeReact()
  const config = {
    ...PANEL_CONFIG,
    servers: [
      {
        id: 'notion',
        label: 'Notion',
        url: 'https://mcp.notion.com/mcp',
        scopes: ['default'],
        enabled: true,
        profile: 'notion',
      },
    ],
  }
  const form = createFakeConfigForm(config)
  const Panel = createPanel(React, { getConfigForm: () => form })
  await assertProfileSurvives(React, Panel, form)
})

test('a plain HTTP address gets a hint, an HTTPS address does not', async () => {
  const React = createFakeReact()
  const form = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })

  let tree = React.render(Panel, {})
  const serversSection = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-section')[0]
  buttons(serversSection).at(-1).props.onClick()

  tree = React.render(Panel, {})
  let dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  fillDraft(dialog, { url: 'https://mcp.example.com/mcp' })
  tree = React.render(Panel, {})
  dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.equal(
    textOf(dialog.children).includes('明文 HTTP'),
    false,
    'an HTTPS address says nothing about cleartext',
  )

  fillDraft(dialog, { url: 'http://mcp.example.com/mcp' })
  tree = React.render(Panel, {})
  dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(
    textOf(dialog.children).includes('明文 HTTP'),
    'a plain HTTP address warns that the token travels in cleartext',
  )

  fillDraft(dialog, { url: 'http://127.0.0.1:3000/mcp' })
  tree = React.render(Panel, {})
  dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.equal(
    textOf(dialog.children).includes('明文 HTTP'),
    false,
    'a loopback address is not warned about',
  )
})

test('removing a server asks first', async () => {
  const React = createFakeReact()
  const config = {
    ...PANEL_CONFIG,
    servers: [
      {
        id: 'notion',
        label: 'Notion',
        url: 'https://mcp.notion.com/mcp',
        scopes: ['default'],
        enabled: true,
      },
    ],
  }
  const form = createFakeConfigForm(config)
  const Panel = createPanel(React, { getConfigForm: () => form })

  const asked = []
  const previous = globalThis.confirm
  Object.defineProperty(globalThis, 'confirm', {
    configurable: true,
    writable: true,
    value: (question) => {
      asked.push(question)
      return false
    },
  })
  try {
    let tree = React.render(Panel, {})
    const row = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-row')[0]
    const remove = buttons(row).at(-1)
    remove.props.onClick()
    await flush()
  } finally {
    Object.defineProperty(globalThis, 'confirm', {
      configurable: true,
      writable: true,
      value: previous,
    })
  }

  assert.equal(asked.length, 1, 'the panel asked before removing')
  assert.match(asked[0], /Notion/, 'the question names the server')
  const write = form.writes.find((entry) => entry?.op === 'set' && entry?.path?.[0] === 'servers')
  assert.equal(write, undefined, 'nothing was written')
})

test('a refused write is reported and the dialog stays open', async () => {
  const React = createFakeReact()
  // The host answers a refused write with `false` instead of throwing.
  const form = createFakeConfigForm(CONFIG, { refuse: true })
  const Panel = createPanel(React, { getConfigForm: () => form })

  await saveServer(React, Panel, form, {
    id: 'notion',
    label: 'Notion',
    url: 'https://mcp.notion.com/mcp',
  })

  const tree = React.render(Panel, {})
  const error = collect(
    tree,
    (node) => node.props?.className === 'dsh-oauth-mcp-panel-error',
  )[0]
  assert.ok(error, 'the panel shows the error')
  assert.match(textOf(error.children), /宿主拒绝了这次修改/, 'the panel says that the host refused')
  const dialog = collect(
    tree,
    (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog',
  )[0]
  assert.ok(dialog, 'the draft form is still open')
})
