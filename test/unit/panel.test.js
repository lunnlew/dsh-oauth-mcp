/**
 * Tests of the settings panel.
 *
 * The panel shows the configuration of the plugin. Only the fields the host
 * declares volatile may be written from the panel; the remaining fields are
 * read-only here and belong to the host's plugin configuration page.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createFakeReact } from '../support/fake-react.js'

import {
  CALLBACK_MODE_LABEL_KEYS,
  createPanel,
  detectBrowserLocale,
  normalizeClientLocale,
} from '../../client/panel.js'
import {
  detectBrowserLocale as commandviewBrowserLocale,
  normalizeClientLocale as commandviewLocale,
} from '../../client/commandview.js'
import {
  detectBrowserLocale as toolviewBrowserLocale,
  normalizeClientLocale as toolviewLocale,
} from '../../client/toolview.js'



/**
 * Walk an element tree.
 *
 * @param {object} element The root element.
 * @returns {object[]} Every element of the tree.
 */
function collect(element) {
  if (!element || typeof element !== 'object') return []
  const children = Array.isArray(element.children) ? element.children : []
  return [element, ...children.flatMap((child) => collect(child))]
}

/**
 * Collect every text of an element tree.
 *
 * @param {object} element The root element.
 * @returns {string[]} The texts.
 */
function texts(element) {
  return collect(element)
    .map((node) => node.children)
    .flat()
    .filter((child) => typeof child === 'string')
}

/**
 * Collect every style object of an element tree.
 *
 * @param {object} element The root element.
 * @returns {object[]} The style objects.
 */
function styles(element) {
  return collect(element)
    .map((node) => node.props?.style)
    .filter((style) => style && typeof style === 'object')
}

/**
 * Build a fake configuration form.
 *
 * @param {object} value The configuration value.
 * @returns {object} The fake form and the recorded writes.
 */
function createFakeConfigForm(value) {
  const writes = []
  return {
    writes,
    form: {
      getSnapshot: () => ({ value }),
      subscribe: () => () => {},
      set: async (field, next) => {
        writes.push([field, next])
      },
    },
  }
}

const CONFIG = {
  callbackMode: 'dedicated-port',
  callbackPort: 39271,
  callbackPath: '/oauth-mcp/callback',
  toolPrefix: 'mcp_oauth',
  defaultScopes: [],
  autoConnect: true,
  servers: [],
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

test('the panel shows the ordinary configuration fields as read-only values', () => {
  const React = createFakeReact()
  const { form } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = React.render(Panel, {})
  const nodes = collect(tree)

  assert.equal(nodes.some((node) => node.type === 'select'), false, 'the panel has no dropdown')
  const rendered = texts(tree)
  assert.ok(rendered.includes('39271'), 'the callback port is shown')
  assert.ok(rendered.includes('/oauth-mcp/callback'), 'the callback path is shown')
  assert.ok(rendered.includes('mcp_oauth'), 'the tool name prefix is shown')
})

test('the panel explains where the ordinary fields are edited', () => {
  const React = createFakeReact()
  const { form } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = React.render(Panel, {})
  const rendered = texts(tree).join('\n')
  assert.ok(rendered.includes('配置文件'), 'the hint names the host configuration file')
})

test('the panel writes only the volatile fields', async () => {
  const React = createFakeReact()
  const { form, writes } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = React.render(Panel, {})
  const nodes = collect(tree)

  const scopes = nodes.find(
    (node) => node.type === 'input' && typeof node.props.onChange === 'function' && node.props.type !== 'checkbox',
  )
  assert.ok(scopes, 'the default scopes field is editable')
  await scopes.props.onChange({ target: { value: 'read, write' } })

  assert.deepEqual(writes, [['defaultScopes', ['read', 'write']]])
})

test('the panel only uses the host design tokens', () => {
  const React = createFakeReact()
  const { form } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = React.render(Panel, {})

  for (const style of styles(tree)) {
    for (const value of Object.values(style)) {
      const references = String(value).match(/var\(--[^)]+\)/g) ?? []
      for (const reference of references) {
        assert.ok(
          reference.startsWith('var(--dsw-alias-'),
          `the style uses a host token: ${reference}`,
        )
      }
    }
  }
})

test('a Chinese tag is Simplified Chinese and every other language is English', () => {
  assert.equal(normalizeClientLocale('zh'), 'zh')
  assert.equal(normalizeClientLocale('zh-CN'), 'zh')
  assert.equal(normalizeClientLocale('ZH-Hans-CN'), 'zh')
  assert.equal(normalizeClientLocale('en'), 'en')
  assert.equal(normalizeClientLocale('en-US'), 'en')
  assert.equal(normalizeClientLocale('ja'), 'en')
  assert.equal(normalizeClientLocale(''), undefined)
  assert.equal(normalizeClientLocale(undefined), undefined)
})

test('the panel uses the translator of the host when there is one', () => {
  const React = createFakeReact()
  const { form } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = Panel({ t: (key) => `host:${key}` })
  assert.ok(texts(tree).includes('host:panel.title'))
})

test('the panel falls back to the language of the browser', () => {
  withBrowser({ language: 'en-US', languages: ['en-US'] }, () => {
    const React = createFakeReact()
    const { form } = createFakeConfigForm(CONFIG)
    const Panel = createPanel(React, { getConfigForm: () => form })
    const tree = React.render(Panel, {})
    assert.ok(texts(tree).includes('OAuth authorization manager'))
  })
})

test('the panel keeps Chinese when the browser does not name a language', () => {
  const React = createFakeReact()
  const { form } = createFakeConfigForm(CONFIG)
  const Panel = createPanel(React, { getConfigForm: () => form })
  const tree = React.render(Panel, {})
  assert.ok(texts(tree).includes('OAuth 授权管理'))
})

test('the client modules agree about the language', () => {
  for (const tag of ['zh', 'zh-CN', 'en-US', 'ja', '', undefined]) {
    assert.equal(
      toolviewLocale(tag),
      normalizeClientLocale(tag),
      'the tool views read a tag like the panel',
    )
    assert.equal(
      commandviewLocale(tag),
      normalizeClientLocale(tag),
      'the command row reads a tag like the panel',
    )
  }
  withBrowser({ language: 'en-US', languages: ['en-US'] }, () => {
    assert.equal(toolviewBrowserLocale(), detectBrowserLocale())
    assert.equal(commandviewBrowserLocale(), detectBrowserLocale())
  })
})

test('the deployed browser entry reads the callback modes like the panel', () => {
  const source = readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8')
  const block = source.match(/const CALLBACK_MODE_LABEL_KEYS = \{([\s\S]*?)\n {4}\}/)
  assert.ok(block, 'the browser entry carries the callback mode labels')
  const deployed = {}
  for (const match of block[1].matchAll(/'([^']+)': '([^']+)'/g)) deployed[match[1]] = match[2]
  assert.deepEqual(
    deployed,
    CALLBACK_MODE_LABEL_KEYS,
    'the panel and the browser entry map the callback modes to the same labels',
  )
})
