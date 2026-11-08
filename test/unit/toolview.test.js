/**
 * Tests of the tool views.
 *
 * The two tool views draw the result of `dsh_oauth_mcp_authorize` and
 * `dsh_oauth_mcp_status`. The host injects its own translator into them, and
 * that one follows the language of the interface; the bundled copy is only
 * used when the host has no locale service, and it then follows the language
 * of the browser.
 *
 * @module dsh-oauth-mcp/test/unit/toolview
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createToolViews, detectBrowserLocale } from '../../client/toolview.js'
import { createFakeReact } from '../support/fake-react.js'

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

describe('the tool views', () => {
  it('use the translator of the host when there is one', () => {
    const React = createFakeReact()
    const { AuthorizeToolView } = createToolViews(React)
    const tree = React.render(AuthorizeToolView, {
      t: (key) => `host:${key}`,
      phase: 'result',
      block: {},
    })
    assert.match(textOf(tree), /host:toolview.authorize.title/)
  })

  it('fall back to the language of the browser', () => {
    withBrowser({ language: 'en-US', languages: ['en-US'] }, () => {
      const React = createFakeReact()
      const { AuthorizeToolView, StatusToolView } = createToolViews(React)
      const authorize = React.render(AuthorizeToolView, { phase: 'result', block: {} })
      const status = React.render(StatusToolView, { phase: 'result', block: {} })
      assert.match(textOf(authorize), /OAuth authorization/)
      assert.match(textOf(status), /OAuth authorization state/)
    })
  })

  it('keep Chinese when the browser does not name a language', () => {
    const React = createFakeReact()
    const { AuthorizeToolView } = createToolViews(React)
    const tree = React.render(AuthorizeToolView, { phase: 'result', block: {} })
    assert.match(textOf(tree), /OAuth 授权/)
  })
})

describe('the language of the browser', () => {
  it('is Chinese for a Chinese tag and English for every other tag', () => {
    const chinese = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const window = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: 'zh-CN', languages: ['zh-CN'] },
      })
      assert.equal(detectBrowserLocale(), 'zh')
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: 'ja-JP', languages: ['ja-JP'] },
      })
      assert.equal(detectBrowserLocale(), 'en')
    } finally {
      if (window) Object.defineProperty(globalThis, 'window', window)
      else delete globalThis.window
      if (chinese) Object.defineProperty(globalThis, 'navigator', chinese)
      else delete globalThis.navigator
    }
  })

  it('is Chinese outside a browser window', () => {
    assert.equal(detectBrowserLocale(), 'zh')
  })
})
