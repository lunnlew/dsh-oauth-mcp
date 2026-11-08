/**
 * Tests of the browser entry of the plugin.
 *
 * The host serves `client/index.js` as a classic script and loads it through
 * the module loader. The test evaluates the file the same way and checks the
 * manifest, the slot registrations, the locale registration and the language
 * the entry hands to the server half.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createFakeReact } from '../support/fake-react.js'

const SOURCE = readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8')



/**
 * Load the browser entry and return the registered module.
 *
 * @returns {object} The module manifest and the factory result.
 */
function loadClientModule() {
  const manifests = []
  const fakeWindow = {
    __ModuleLoader__: {
      load: (manifest) => manifests.push(manifest),
    },
  }
  // The file is a classic script: it may not use import or export.
  const evaluate = new Function('window', SOURCE)
  evaluate(fakeWindow)
  assert.equal(manifests.length, 1, 'the entry registers exactly one module')
  const manifest = manifests[0]
  const React = createFakeReact()
  const module = manifest.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  return { manifest, module }
}

/**
 * Build a fake client context that records the slot registrations.
 *
 * @param {object} [options] The collaborators of the entry.
 * @param {object} [options.locale] The locale service of the host.
 * @param {object} [options.configForm] The configuration form of the entry.
 * @returns {object} The context and the recorded registrations.
 */
function createFakeClientContext(options = {}) {
  const registrations = []
  const injections = []
  const localeCalls = []
  const listeners = []
  const ctx = {
    slots: {
      inject: (key, callback) => {
        injections.push(key)
        // The host accepts a plain callback and a generator; both are drained here.
        const result = callback()
        if (result && typeof result.next === 'function') {
          let step = result.next()
          while (!step.done) step = result.next()
        }
        return () => injections.splice(injections.indexOf(key), 1)
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => registrations.splice(registrations.indexOf(options), 1)
      },
    },
    locale: options.locale ?? {
      register: (namespace, dictionaries) => {
        localeCalls.push({ namespace, dictionaries })
        return () => localeCalls.splice(localeCalls.indexOf(namespace), 1)
      },
      bind: (namespace) => (key) => `${namespace}:${key}`,
    },
    configForms: {
      get: () => options.configForm,
    },
    effect: (factory) => {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on: () => () => {},
  }
  return { ctx, registrations, injections, localeCalls, listeners }
}

/**
 * Build a fake configuration form that records the writes.
 *
 * @param {object} [options] The behaviour of the form.
 * @param {boolean} [options.fail] Whether the write fails.
 * @returns {object} The fake form and the recorded writes.
 */
function createFakeConfigForm(options = {}) {
  const writes = []
  return {
    writes,
    form: {
      getSnapshot: () => ({ value: {} }),
      subscribe: () => () => {},
      set: async (field, value) => {
        if (options.fail) throw new Error('the configuration service is not writable')
        writes.push([field, value])
      },
    },
  }
}

/**
 * Run a piece of code inside a fake browser window.
 *
 * The plugin reads the language of the browser only inside a browser window,
 * so a test has to provide both to change the language.
 *
 * @param {object} browser The fake navigator.
 * @param {() => void} body The code to run.
 * @returns {void}
 */
function withBrowser(browser, body) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser })
  try {
    body()
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else delete globalThis.window
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
  }
}

/**
 * Collect the texts of a rendered tree.
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

test('the browser entry registers itself under the package name', () => {
  const { manifest } = loadClientModule()
  assert.equal(manifest.id, 'dsh-oauth-mcp')
  assert.equal(typeof manifest.factory, 'function')
})

test('the browser entry asks for the services it uses', () => {
  const { module } = loadClientModule()
  assert.deepEqual(module.inject, ['slots', 'configForms', 'locale'])
  assert.equal(typeof module.apply, 'function')
})

test('the browser entry registers the settings section and the tool views', () => {
  const { module } = loadClientModule()
  const { ctx, registrations, injections } = createFakeClientContext()
  module.apply(ctx)

  assert.ok(injections.includes('settings.section'), 'the settings section is contributed')
  assert.ok(injections.includes('tool.call.toolview'), 'the tool views are contributed')

  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.ok(section, 'the settings section is registered')
  assert.equal(section.options.id, 'oauth-mcp')
  assert.equal(section.options.order, 90)
  assert.equal(typeof section.options.label, 'function')

  const views = registrations.filter((entry) => entry.options.name === 'tool.call.toolview')
  assert.equal(views.length, 2)
  const keys = views.map((entry) => entry.options.key).sort()
  assert.deepEqual(keys, ['dsh_oauth_mcp_authorize', 'dsh_oauth_mcp_status'])
})

test('the browser entry registers its locale namespace', () => {
  const { module } = loadClientModule()
  const { ctx, localeCalls } = createFakeClientContext()
  module.apply(ctx)
  assert.equal(localeCalls.length, 1)
  assert.equal(localeCalls[0].namespace, 'dsh-oauth-mcp')
  assert.ok(localeCalls[0].dictionaries.zh, 'the Chinese dictionary is registered')
  assert.ok(localeCalls[0].dictionaries.en, 'the English dictionary is registered')
})

test('the browser entry hands the language of the host to the server half', () => {
  const { module } = loadClientModule()
  const { form, writes } = createFakeConfigForm()
  const { ctx } = createFakeClientContext({
    configForm: form,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active: 'zh' }),
    },
  })
  module.apply(ctx)
  assert.deepEqual(writes, [['locale', 'zh']])
})

test('the browser entry writes the language again when the host language changes', () => {
  const { module } = loadClientModule()
  const { form, writes } = createFakeConfigForm()
  let active = 'zh'
  const listeners = []
  const { ctx } = createFakeClientContext({
    configForm: form,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active }),
      subscribe: (listener) => {
        listeners.push(listener)
        return () => {}
      },
    },
  })
  module.apply(ctx)
  assert.deepEqual(writes, [['locale', 'zh']])

  active = 'en'
  for (const listener of listeners) listener()
  assert.deepEqual(writes, [['locale', 'zh'], ['locale', 'en']])
})

test('the browser entry survives a configuration service that cannot be written', () => {
  const { module } = loadClientModule()
  const { form } = createFakeConfigForm({ fail: true })
  const { ctx, registrations } = createFakeClientContext({
    configForm: form,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active: 'en' }),
    },
  })
  module.apply(ctx)
  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.ok(section, 'the settings section is registered')
  const tree = section.component({})
  assert.match(textOf(tree), /OAuth 授权管理/)
})

test('the browser entry speaks the language of the browser without a locale service', () => {
  withBrowser({ language: 'en-US', languages: ['en-US'] }, () => {
    const { module } = loadClientModule()
    const { form } = createFakeConfigForm()
    const { ctx, registrations } = createFakeClientContext({ configForm: form })
    module.apply(ctx)
    const section = registrations.find((entry) => entry.options.name === 'settings.section')
    const tree = section.component({})
    assert.match(textOf(tree), /OAuth authorization manager/)
  })
})

test('the browser entry keeps Chinese when the browser does not name a language', () => {
  const { module } = loadClientModule()
  const { form } = createFakeConfigForm()
  const { ctx, registrations } = createFakeClientContext({ configForm: form })
  module.apply(ctx)
  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  const tree = section.component({})
  assert.match(textOf(tree), /OAuth 授权管理/)
})
