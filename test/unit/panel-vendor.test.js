/**
 * Tests of the vendor picker of the settings panel.
 *
 * The panel has to ask the user for as little as possible: picking a vendor
 * fills the endpoint, the identifier, the scopes and the authorization
 * server, so only the fields that really need typing stay empty. The panel
 * exists in two copies (the ES module and the deployed classic script) and
 * both are checked here.
 *
 * The vendors are written down once, in `lib/profiles/known-profiles.js`.
 * `lib/profiles/vendor-presets.js` projects that table into the shape the
 * panel needs, and the ES module `client/panel.js` imports the projection.
 * Only the deployed browser entry carries a written out copy, because a
 * classic script cannot import anything;
 * `scripts/build-vendor-presets.mjs` writes that copy and copies the rules of
 * the panel into it. These tests check that the copy is current and that the
 * panel and the server half agree about an endpoint.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  VENDOR_PRESETS,
  createPanel,
  deriveServerId,
  findVendorPreset,
} from '../../client/panel.js'
import {
  KNOWN_PROFILES,
  PUBLIC_SUFFIXES,
  deriveServerId as deriveHostServerId,
  matchProfileByEndpoint,
} from '../../lib/profiles/known-profiles.js'
import { projectVendorPreset, VENDOR_PRESETS as HOST_PRESETS } from '../../lib/profiles/vendor-presets.js'
import { buildIndexSource } from '../../scripts/build-vendor-presets.mjs'
import { buildVendorDoc } from '../../scripts/build-vendor-table.mjs'
import { buttons, collect, createFakeReact, inputs } from '../support/fake-react.js'
import {
  DEPLOYED_SOURCE,
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
  renderDraft,
} from '../support/panel-harness.js'

/**
 * Read one file of the package.
 *
 * @param {string} relative The path inside the package.
 * @returns {string} The content.
 */
function read(relative) {
  return readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')
}

/**
 * Take the part of a file between two markers.
 *
 * @param {string} source The file content.
 * @param {string} start The opening marker.
 * @param {string} end The closing marker.
 * @returns {string} The marked part.
 */
function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end)
  assert.ok(from >= 0, `the marker ${start} is missing`)
  assert.ok(to > from, `the marker ${end} is missing`)
  return source.slice(source.indexOf('\n', from) + 1, to)
}

/**
 * Evaluate the vendor regions of one client file.
 *
 * The regions are plain JavaScript, so they can be read without the rest of
 * the file; the deployed copy is the one the browser really runs.
 *
 * @param {string} source The content of the client file.
 * @returns {object} The table and the rules of the file.
 */
function loadVendorRegions(source) {
  const data = between(source, '// >>> VENDOR_DATA', '// <<< VENDOR_DATA')
  const code = between(source, '// >>> VENDOR_CODE', '// <<< VENDOR_CODE')
  const body = `${data}\n${code}\nreturn { VENDOR_PRESETS, findVendorPreset, deriveServerId, PUBLIC_SUFFIXES }`
  return new Function(body.replace(/^export\s+/gm, ''))()
}

/**
 * The endpoints the panel and the server half have to agree about.
 */
const SHARED_URLS = [
  'https://mcp.notion.com/mcp',
  'https://mcp.notion.com',
  'https://mcp.linear.app',
  'https://mcp.example.com/mcp',
  'https://example.org/mcp',
  'https://mcp.mycompany.internal/mcp',
  'https://mcp.example.com.cn/mcp',
  'https://mcp.unknown.example.org/mcp',
  '',
]

/**
 * Collect the text inputs of a tree, in document order.
 *
 * @param {object} tree The rendered tree.
 * @returns {object[]} The text input elements.
 */
function textInputs(tree) {
  return inputs(tree).filter((input) => input.props.type !== 'checkbox')
}

/**
 * Collect the dialog of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object} The dialog element.
 */
function dialogOf(tree) {
  const dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(dialog, 'the draft form is shown in a dialog')
  return dialog
}

/**
 * Pick a vendor in the picker of the dialog.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @param {string} vendorId The vendor to pick.
 * @returns {object} The rendered tree.
 */
function pickVendor(React, Panel, vendorId) {
  let tree = renderDraft(React, Panel)
  const select = collect(tree, (node) => node.type === 'select')[0]
  assert.ok(select, 'the dialog offers a vendor picker')
  select.props.onChange({ target: { value: vendorId } })
  tree = React.render(Panel, {})
  return tree
}

test('the vendor picker offers every known vendor', () => {
  assert.deepEqual(
    VENDOR_PRESETS.map((preset) => preset.id),
    KNOWN_PROFILES.map((profile) => profile.id),
    'the picker and the host table know the same vendors',
  )
  for (const profile of KNOWN_PROFILES) {
    const preset = VENDOR_PRESETS.find((item) => item.id === profile.id)
    assert.ok(preset, `the picker knows ${profile.id}`)
    assert.deepEqual(
      preset,
      projectVendorPreset(profile),
      `${profile.id} is the projection of the server profile, field by field`,
    )
  }
})

test('the identifiers of the known vendors do not change', () => {
  assert.deepEqual(
    VENDOR_PRESETS.map((preset) => preset.id).slice(0, 17),
    [
      'notion',
      'linear',
      'atlassian',
      'sentry',
      'figma',
      'github',
      'stripe',
      'datadog',
      'cloudflare',
      'vercel',
      'grafana',
      'newrelic',
      'canva',
      'intercom',
      'context7',
      'pagerduty',
      'zendesk',
    ],
    'the identifiers are stored in existing configurations and credential keys',
  )
})

test('the table keeps the first identifiers and adds the newer ones after them', () => {
  const ids = VENDOR_PRESETS.map((preset) => preset.id)
  assert.equal(new Set(ids).size, ids.length, 'no identifier is used twice')
  assert.deepEqual(
    ids.slice(0, 17),
    [
      'notion',
      'linear',
      'atlassian',
      'sentry',
      'figma',
      'github',
      'stripe',
      'datadog',
      'cloudflare',
      'vercel',
      'grafana',
      'newrelic',
      'canva',
      'intercom',
      'context7',
      'pagerduty',
      'zendesk',
    ],
    'the identifiers that already exist keep their place',
  )
  for (const id of [
    'slack',
    'miro',
    'mongodb',
    'supabase',
    'neon',
    'prisma',
    'clerk',
    'square',
    'paypal',
    'ramp',
    'mercury',
    'asana',
    'monday',
    'retool',
    'render',
    'exa',
    'tavily',
    'shopify',
    'airtable',
    'cloudbase',
    'cloudbase-intl',
    'feishu',
    'lark',
  ]) {
    assert.ok(ids.includes(id), `the table knows ${id}`)
  }
})

test('the picker offers every scope the vendor publishes', () => {
  for (const profile of KNOWN_PROFILES) {
    const preset = VENDOR_PRESETS.find((item) => item.id === profile.id)
    const published = profile.scopesSupported ?? profile.defaultScopes
    assert.deepEqual(
      [...preset.scopes],
      [...published],
      `${profile.id} offers the scopes the vendor publishes`,
    )
  }
  const pagerduty = VENDOR_PRESETS.find((preset) => preset.id === 'pagerduty')
  assert.deepEqual(
    [...pagerduty.scopes],
    [
      'incidents.read',
      'incidents.write',
      'oncalls.read',
      'services.read',
      'services.write',
      'users.read',
    ],
    'PagerDuty publishes six scopes and all six are offered',
  )
})

test('the deployed browser entry carries the same vendor table', () => {
  const deployed = loadVendorRegions(DEPLOYED_SOURCE)
  assert.deepEqual(
    deployed.VENDOR_PRESETS.map((preset) => preset.id),
    KNOWN_PROFILES.map((profile) => profile.id),
    'the browser entry knows the same vendors',
  )
  for (const profile of KNOWN_PROFILES) {
    const preset = deployed.VENDOR_PRESETS.find((item) => item.id === profile.id)
    assert.deepEqual(
      preset,
      projectVendorPreset(profile),
      `${profile.id} is the projection of the server profile in the browser entry`,
    )
  }
})

test('the generated vendor table is up to date', () => {
  const panel = read('client/panel.js')
  const index = read('client/index.js')
  assert.equal(
    buildIndexSource(index, panel),
    index,
    'running the generator changes nothing in client/index.js',
  )
})

test('the readable panel imports the table instead of carrying a copy', () => {
  const panel = read('client/panel.js')
  assert.ok(
    panel.includes("import { VENDOR_PRESETS } from '../lib/profiles/vendor-presets.js'"),
    'the panel reads the vendor table from the server half',
  )
  assert.ok(
    panel.includes("import { PUBLIC_SUFFIXES } from '../lib/profiles/known-profiles.js'"),
    'the panel reads the public suffixes from the server half',
  )
  assert.ok(
    !panel.includes('// >>> VENDOR_DATA'),
    'the panel holds no written out copy of the table',
  )
  assert.equal(
    VENDOR_PRESETS,
    HOST_PRESETS,
    'the panel hands out the table of the server half itself',
  )
  assert.deepEqual(
    [...VENDOR_PRESETS.map((preset) => preset.id)],
    [...KNOWN_PROFILES.map((profile) => profile.id)],
    'the panel and the server half know the same vendors',
  )
})

test('the table of the document is up to date', () => {
  const doc = read('docs/vendors.md')
  assert.equal(
    buildVendorDoc(doc),
    doc,
    'running the generator changes nothing in docs/vendors.md',
  )
  for (const profile of KNOWN_PROFILES) {
    assert.ok(
      profile.note,
      `${profile.id} has no note for the document`,
    )
  }
})

test('the panel and the server half agree about an endpoint', () => {
  const deployed = loadVendorRegions(DEPLOYED_SOURCE)
  for (const url of SHARED_URLS) {
    const label = url || 'an empty address'
    assert.equal(
      findVendorPreset(url)?.id,
      matchProfileByEndpoint(url)?.id,
      `the panel and the host find the same vendor for ${label}`,
    )
    assert.equal(
      deriveServerId(url),
      deriveHostServerId(url),
      `the panel and the host derive the same identifier for ${label}`,
    )
    assert.equal(
      deployed.findVendorPreset(url)?.id,
      matchProfileByEndpoint(url)?.id,
      `the browser entry and the host find the same vendor for ${label}`,
    )
    assert.equal(
      deployed.deriveServerId(url),
      deriveHostServerId(url),
      `the browser entry and the host derive the same identifier for ${label}`,
    )
  }
})

test('a vendor is found by its host as well', () => {
  assert.equal(findVendorPreset('https://mcp.notion.com')?.id, 'notion')
  assert.equal(findVendorPreset('https://mcp.notion.com/mcp')?.id, 'notion')
  assert.equal(findVendorPreset('https://mcp.linear.app')?.id, 'linear')
  assert.equal(findVendorPreset('https://mcp.example.com/mcp'), undefined)
  assert.equal(findVendorPreset(''), undefined)
})

test('the identifier of an unknown endpoint comes from the host', () => {
  assert.equal(deriveServerId('https://example.org/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.example.com/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.mycompany.internal/mcp'), 'mycompany-internal')
  assert.equal(deriveServerId('https://mcp.example.com.cn/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.mycompany.example.com/mcp'), 'mycompany-example')
  assert.equal(deriveServerId('https://mcp.notion.com/mcp'), 'notion')
  assert.equal(deriveServerId(''), '')
})

test('the client and the host know the same public suffixes', () => {
  const deployed = loadVendorRegions(DEPLOYED_SOURCE)
  assert.deepEqual(
    [...deployed.PUBLIC_SUFFIXES],
    [...PUBLIC_SUFFIXES],
    'the browser entry drops the same suffixes as the host',
  )
  for (const suffix of PUBLIC_SUFFIXES) {
    const url = `https://mcp.example.${suffix}/mcp`
    assert.equal(
      deployed.deriveServerId(url),
      deriveHostServerId(url),
      `the browser entry drops ${suffix} the same way as the host`,
    )
  }
})

test('choosing a vendor fills the endpoint, the identifier and the scopes', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })
  const tree = pickVendor(React, Panel, 'notion')
  const fields = textInputs(dialogOf(tree))
  assert.equal(fields[0].props.value, 'notion', 'the identifier is filled')
  assert.equal(fields[1].props.value, 'Notion MCP (Beta)', 'the label is filled')
  assert.equal(fields[2].props.value, 'https://mcp.notion.com/mcp', 'the endpoint is filled')
  assert.equal(fields[3].props.value, 'default', 'the default scope is filled')
})

test('the deployed browser entry fills the form the same way', () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React)
  const tree = pickVendor(React, Panel, 'linear')
  const fields = textInputs(dialogOf(tree))
  assert.equal(fields[0].props.value, 'linear')
  assert.equal(fields[2].props.value, 'https://mcp.linear.app/mcp')
})

test('the scopes of a vendor can be picked with the mouse', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })
  let tree = pickVendor(React, Panel, 'notion')
  const list = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-scopes')[0]
  assert.ok(list, 'the vendor scopes are shown as checkboxes')
  const ticks = inputs(list)
  assert.equal(ticks.length, 2, 'both published scopes are offered')
  assert.equal(ticks[0].props.checked, true, 'the default scope is ticked')
  assert.equal(ticks[1].props.checked, false, 'the other scope is not ticked')

  ticks[1].props.onChange()
  tree = React.render(Panel, {})
  const fields = textInputs(dialogOf(tree))
  assert.equal(fields[3].props.value, 'default, ema_issuer:manage', 'the ticked scope is added')
})

test('the identifier of a hand written address is only filled when it is empty', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })
  let tree = renderDraft(React, Panel)
  let fields = textInputs(dialogOf(tree))
  fields[2].props.onChange({ target: { value: 'https://example.org/mcp' } })
  tree = React.render(Panel, {})
  fields = textInputs(dialogOf(tree))
  assert.equal(fields[0].props.value, 'example', 'an empty identifier comes from the address')

  fields[0].props.onChange({ target: { value: 'my-own-id' } })
  tree = React.render(Panel, {})
  fields = textInputs(dialogOf(tree))
  fields[2].props.onChange({ target: { value: 'https://mcp.example.com/mcp' } })
  tree = React.render(Panel, {})
  fields = textInputs(dialogOf(tree))
  assert.equal(fields[0].props.value, 'my-own-id', 'a typed identifier is never overwritten')
  assert.equal(fields[2].props.value, 'https://mcp.example.com/mcp', 'the address is still filled')
})

test('a hand written address gets the same identifier as the host', () => {
  for (const url of [
    'https://mcp.notion.com/mcp',
    'https://mcp.example.com/mcp',
    'https://example.org/mcp',
    'https://mcp.grafana.com/mcp',
    '',
  ]) {
    assert.equal(
      deriveServerId(url),
      deriveHostServerId(url),
      `the panel and the host agree about ${url || 'an empty address'}`,
    )
  }
  assert.equal(deriveServerId('https://mcp.notion.com/mcp'), 'notion')
})

test('the copy button puts the authorization command into the clipboard', async () => {
  const written = []
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          written.push(text)
        },
      },
    },
  })
  try {
    const React = createFakeReact()
    const config = {
      ...PANEL_CONFIG,
      servers: [{ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', enabled: true }],
    }
    const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(config) })
    const tree = React.render(Panel, {})
    const copy = buttons(tree).find((button) => button.children[0] === '复制授权命令')
    assert.ok(copy, 'every server row offers the command')
    await copy.props.onClick()
    assert.deepEqual(written, ['/oauth-mcp authorize https://mcp.notion.com/mcp'])
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
})

test('the dialog can be closed without saving', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })
  const tree = renderDraft(React, Panel)
  const overlay = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-overlay')[0]
  assert.ok(overlay, 'the dialog is drawn over the panel')
  assert.ok(overlay.props.onClick, 'clicking the backdrop closes the dialog')
})
