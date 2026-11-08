/**
 * Shared harness for the settings panel tests.
 *
 * The panel exists in two copies: the ES module `client/panel.js` (the
 * readable source of truth) and `client/index.js` (the classic script the
 * browser really loads). The tests use this harness to render either copy.
 *
 * @module dsh-oauth-mcp/test/support/panel-harness
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** The source of the deployed browser entry. */
export const DEPLOYED_SOURCE = readFileSync(
  new URL('../../client/index.js', import.meta.url),
  'utf8',
)

/** A configuration that keeps the panel deterministic. */
export const PANEL_CONFIG = {
  callbackMode: 'dedicated-port',
  callbackPort: 39271,
  callbackPath: '/oauth-mcp/callback',
  toolPrefix: 'mcp_oauth',
  defaultScopes: [],
  autoConnect: true,
  servers: [],
}

/**
 * Build a fake configuration form.
 *
 * The form records every write, so a test can see what the panel asked the
 * host to store. It can also be told to refuse the writes: the host answers a
 * refused write with `false` instead of throwing, and the panel has to notice
 * that.
 *
 * @param {object} value The configuration value.
 * @param {object} [options] The harness options.
 * @param {boolean} [options.refuse] Whether the host refuses every write.
 * @returns {object} The fake form.
 */
export function createFakeConfigForm(value, options = {}) {
  const writes = []
  const refuse = options.refuse === true
  return {
    writes,
    getSnapshot: () => ({ value }),
    subscribe: () => () => {},
    set: async (field, next) => {
      writes.push({ op: 'set', path: [field], value: next })
      return !refuse
    },
    mutate: async (ops) => {
      for (const op of Array.isArray(ops) ? ops : []) writes.push(op)
      return !refuse
    },
  }
}

/**
 * Load every slot registration of the deployed browser entry.
 *
 * The fake context only exposes the services the entry declares in its
 * `inject` list, exactly like the real client runtime: a service provided by
 * a sibling plugin is invisible unless the entry injects it.
 *
 * @param {object} React The fake React runtime.
 * @param {object} [options] The harness options.
 * @param {boolean} [options.provideConfigService] Whether the configuration
 *   service is provided (it is only provided when the entry injects it).
 * @param {object} [options.form] The configuration form the entry should use.
 * @returns {object[]} The registrations, in registration order.
 */
export function loadDeployedRegistrations(React, options = {}) {
  const manifests = []
  // The file is a classic script: it may not use import or export.
  const evaluate = new Function('window', DEPLOYED_SOURCE)
  evaluate({ __ModuleLoader__: { load: (manifest) => manifests.push(manifest) } })
  assert.equal(manifests.length, 1, 'the entry registers exactly one module')

  const form = options.form ?? createFakeConfigForm(options.config ?? PANEL_CONFIG)
  const registrations = []
  const module = manifests[0].factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const injected = Array.isArray(module.inject) ? module.inject : []
  const services = {}
  if (injected.includes('slots')) {
    services.slots = {
      inject: (key, callback) => {
        const result = callback()
        if (result && typeof result.next === 'function') {
          let step = result.next()
          while (!step.done) step = result.next()
        }
      },
      register: (options, component) => {
        registrations.push({ options, component })
      },
    }
  }
  if (injected.includes('locale')) {
    services.locale = { register: () => () => {}, bind: () => (key) => key }
  }
  if (injected.includes('configForms') && options.provideConfigService !== false) {
    services.configForms = { get: () => form }
  }
  const ctx = {
    get: (name) => services[name],
    effect: (factory) => {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on: () => () => {},
    ...services,
  }
  module.apply(ctx)
  return registrations
}

/**
 * Load the panel component of the deployed browser entry.
 *
 * @param {object} React The fake React runtime.
 * @param {object} [config] The configuration the panel should show.
 * @param {object} [options] The harness options.
 * @param {boolean} [options.provideConfigService] Whether the configuration
 *   service is provided (it is only provided when the entry injects it).
 * @param {object} [options.form] The configuration form the panel should use.
 * @returns {Function} The panel component.
 */
export function loadDeployedPanel(React, config = PANEL_CONFIG, options = {}) {
  const registrations = loadDeployedRegistrations(React, { ...options, config })
  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.ok(section, 'the settings section is registered')
  return section.component
}

/**
 * Load the command row component of the deployed browser entry.
 *
 * @param {object} React The fake React runtime.
 * @param {object} [options] The harness options.
 * @returns {Function} The command row component.
 */
export function loadDeployedCommandView(React, options = {}) {
  const registrations = loadDeployedRegistrations(React, options)
  const row = registrations.find(
    (entry) =>
      entry.options.name === 'conversation.chat.commandview' && entry.options.key === 'oauth-mcp',
  )
  assert.ok(row, 'the command row is registered')
  return row.component
}

/**
 * Render the panel and open the draft form.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @returns {object} The rendered tree of the draft form.
 */
export function renderDraft(React, Panel) {
  let tree = React.render(Panel, {})
  const add = buttonsOf(tree).at(-1)
  assert.ok(add, 'the panel shows the "add server" button')
  add.props.onClick()
  tree = React.render(Panel, {})
  return tree
}

/**
 * Collect the buttons of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object[]} The button nodes.
 */
function buttonsOf(tree) {
  const found = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node.type === 'button') found.push(node)
    visit(node.children)
  }
  visit(tree)
  return found
}
