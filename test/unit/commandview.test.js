/**
 * Tests of the `/oauth-mcp` command row.
 *
 * The host renders a command result as plain text, so the plugin occupies the
 * keyed slot `conversation.chat.commandview` and draws the answer itself.
 * These tests cover the text parser and the rendered row, for the ES module
 * (`client/commandview.js`) and for the deployed copy (`client/index.js`).
 *
 * @module dsh-oauth-mcp/test/unit/commandview
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COMMAND_NAME, createCommandView, parseCommandText } from '../../client/commandview.js'
import { buildLine } from '../../lib/build-info.js'
import { collect, createFakeReact } from '../support/fake-react.js'
import { loadDeployedCommandView } from '../support/panel-harness.js'

const AUTHORIZE_URL =
  'https://mcp.notion.com/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A39271%2Foauth-mcp%2Fcallback&state=xyz'

/** Collect the anchors of a rendered tree. */
function anchors(tree) {
  return collect(tree, (node) => node.type === 'a')
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

/** Collect the texts of a tree. */
function texts(tree) {
  const parts = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const children = node.children
    if (typeof children === 'string') {
      parts.push(children)
      return
    }
    if (!Array.isArray(children)) return
    for (const child of children) {
      if (typeof child === 'string') parts.push(child)
      else visit(child)
    }
  }
  visit(tree)
  return parts.join('\n')
}

describe('parseCommandText', () => {
  it('turns a markdown link into one link segment', () => {
    const lines = parseCommandText(`点击这里 → [打开授权页面](<${AUTHORIZE_URL}>)`)
    assert.equal(lines.length, 1)
    const links = lines[0].filter((segment) => segment.type === 'link')
    assert.equal(links.length, 1)
    assert.equal(links[0].href, AUTHORIZE_URL)
    assert.equal(links[0].text, '打开授权页面')
  })

  it('turns a bare URL into a link segment', () => {
    const lines = parseCommandText(`如果链接点不开，把这一行复制到浏览器地址栏：\n${AUTHORIZE_URL}`)
    assert.equal(lines.length, 2)
    const links = lines[1].filter((segment) => segment.type === 'link')
    assert.equal(links.length, 1)
    assert.equal(links[0].href, AUTHORIZE_URL)
    assert.equal(links[0].text, AUTHORIZE_URL)
  })

  it('keeps the plain text around a link', () => {
    const lines = parseCommandText(`Notion：授权进行中 → [打开授权页面](<${AUTHORIZE_URL}>)`)
    const text = lines[0]
      .filter((segment) => segment.type === 'text')
      .map((segment) => segment.text)
      .join('')
    assert.match(text, /Notion：授权进行中/)
    assert.match(text, /→/)
  })

  it('returns nothing for an empty answer', () => {
    assert.deepEqual(parseCommandText(''), [])
    assert.deepEqual(parseCommandText(undefined), [])
  })
})

describe('the command row', () => {
  it('renders the authorization URL as a clickable link', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: {
        name: COMMAND_NAME,
        outcome: {
          kind: 'success',
          text: `点击下面的链接，在浏览器里完成 "Notion" 的授权：\n[打开授权页面](<${AUTHORIZE_URL}>)`,
        },
      },
    })

    const links = anchors(tree)
    assert.equal(links.length, 1)
    assert.equal(links[0].props.href, AUTHORIZE_URL)
    assert.equal(links[0].props.target, '_blank')
    assert.equal(links[0].props.rel, 'noreferrer noopener')
    assert.deepEqual(links[0].children, ['打开授权页面'])
    assert.match(texts(tree), /完成 "Notion" 的授权/)
  })

  it('marks the failed outcome', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'error', text: '未知命令 "x"。' } },
    })
    assert.equal(tree.props['data-state'], 'error')
    assert.match(texts(tree), /未知命令/)
  })

  it('marks the running outcome', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, { node: { name: COMMAND_NAME, outcome: null } })
    assert.equal(tree.props['data-state'], 'running')
  })

  it('names the arguments of the run it renders', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, args: ' status notion ', outcome: { kind: 'success', text: 'ok' } },
    })
    const titles = collect(tree, (node) =>
      node.props?.className === 'dsh-oauth-mcp-command-title',
    )
    assert.equal(titles.length, 1)
    assert.equal(titles[0].children[0], '/oauth-mcp status notion')
  })

  it('keeps the bare command name when the run had no arguments', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, args: '  ', outcome: { kind: 'success', text: 'ok' } },
    })
    const titles = collect(tree, (node) =>
      node.props?.className === 'dsh-oauth-mcp-command-title',
    )
    assert.equal(titles[0].children[0], '/oauth-mcp')
  })

  it('styles itself with the host tokens only', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'success', text: AUTHORIZE_URL } },
    })
    const styles = collect(tree, (node) => node.props && node.props.style)
      .map((node) => node.props.style)
    assert.ok(styles.length > 0)
    for (const style of styles) {
      for (const value of Object.values(style)) {
        if (typeof value !== 'string') continue
        for (const match of value.matchAll(/var\((--[^)]+)\)/g)) {
          assert.match(match[1], /^--dsw-alias-/)
        }
      }
    }
  })
})

describe('the beautified command row', () => {
  /** The answer the host produces for `/oauth-mcp authorize`. */
  const AUTHORIZE_ANSWER = [
    buildLine(),
    '点击下面的链接，在浏览器里完成 "notion" 的授权：',
    `[打开授权页面](<${AUTHORIZE_URL}>)`,
    '如果链接点不开，把这一行复制到浏览器地址栏：',
    AUTHORIZE_URL,
    '完成后插件会自动保存凭据并连接这台服务器（回调方式：dedicated-port）。',
  ].join('\n')

  /** Render the answer with one runtime and collect the result. */
  function render(React, CommandView, text = AUTHORIZE_ANSWER) {
    return React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'success', text } },
    })
  }

  it('sorts the answer into build line, action, url and prose', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = render(React, CommandView)
    const kinds = collect(tree, (node) =>
      typeof node.props?.className === 'string'
      && node.props.className.includes('dsh-oauth-mcp-command-line-'),
    ).map((node) => node.props.className.split('dsh-oauth-mcp-command-line-')[1])

    assert.ok(kinds.includes('meta'), 'the build line is rendered as meta')
    assert.ok(kinds.includes('text'), 'the prose lines are rendered as text')
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-action').length,
      1,
      'the authorization link is rendered as one action',
    )
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-url').length,
      1,
      'the raw URL is rendered as one code box',
    )
  })

  it('marks a warning line as a warning', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = render(React, CommandView, `${buildLine()}\n⚠ 宿主没有提供凭据服务（credentials）。`)
    const warnings = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-warning')
    assert.equal(warnings.length, 1)
    assert.match(texts(warnings[0]), /凭据服务/)
  })

  it('copies the authorization URL into the clipboard', async () => {
    const written = []
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: async (value) => { written.push(value) } } },
    })
    try {
      const React = createFakeReact()
      const CommandView = createCommandView(React)
      const tree = render(React, CommandView)
      const copyButtons = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-copy')
      assert.equal(copyButtons.length, 1, 'the URL is offered exactly one copy button')
      copyButtons[0].props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert.deepEqual(written, [AUTHORIZE_URL])

      const again = render(React, CommandView)
      const label = collect(
        again,
        (node) => node.props?.className === 'dsh-oauth-mcp-command-copy',
      )[0].children[0]
      assert.equal(label, '已复制')
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete globalThis.navigator
    }
  })

  it('renders the same card in the deployed browser copy', () => {
    const React = createFakeReact()
    const CommandView = loadDeployedCommandView(React)
    const tree = render(React, CommandView)
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-action').length,
      1,
    )
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-url').length,
      1,
    )
    const links = anchors(tree)
    assert.equal(links.length, 1)
    assert.equal(links[0].props.href, AUTHORIZE_URL)
  })

  it('offers every button once when the same URL appears twice', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React, {
      sidebar: { available: () => true, open: () => true },
    })
    const tree = render(React, CommandView)
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-copy').length,
      1,
      'the URL row carries the only copy button',
    )
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-sidebar').length,
      1,
      'the action row carries the only sidebar button',
    )
  })

  it('offers a copy button when the URL only appears as a link', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: {
        name: COMMAND_NAME,
        outcome: { kind: 'success', text: `[打开授权页面](<${AUTHORIZE_URL}>)` },
      },
    })
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-copy').length,
      1,
    )
  })

  it('draws a table row in a monospace font so the columns line up', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = render(React, CommandView, 'Server  Label  State\nnotion  Notion  authorized')
    const rows = collect(tree, (node) =>
      node.props?.className?.includes?.('dsh-oauth-mcp-command-line-table'),
    )
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.match(row.props.style.fontFamily, /monospace/)
      assert.equal(row.props.style.whiteSpace, 'pre')
    }
  })
})

describe('the language of the command row', () => {
  it('uses the translator of the host when there is one', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      t: (key) => `host:${key}`,
      node: { name: COMMAND_NAME, outcome: null },
    })
    assert.match(texts(tree), /host:command.running/)
  })

  it('falls back to the language of the browser', () => {
    withBrowser({ language: 'en-US', languages: ['en-US'] }, () => {
      const React = createFakeReact()
      const CommandView = createCommandView(React)
      const tree = React.render(CommandView, {
        node: { name: COMMAND_NAME, outcome: null },
      })
      assert.match(texts(tree), /Running/)
    })
  })

  it('keeps Chinese when the browser does not name a language', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: null },
    })
    assert.match(texts(tree), /执行中/)
  })
})

describe('the sidebar browser button', () => {
  const ANSWER = `点击下面的链接：\n[打开授权页面](<${AUTHORIZE_URL}>)`

  it('is offered when the host has a sidebar browser', () => {
    const React = createFakeReact()
    const opened = []
    const CommandView = createCommandView(React, {
      sidebar: { available: () => true, open: (url) => opened.push(url) },
    })
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'success', text: ANSWER } },
    })
    const buttons = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-sidebar')
    assert.equal(buttons.length, 1)
    buttons[0].props.onClick()
    assert.deepEqual(opened, [AUTHORIZE_URL])
  })

  it('is hidden when the host has no sidebar browser', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React, {
      sidebar: { available: () => false, open: () => true },
    })
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'success', text: ANSWER } },
    })
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-sidebar').length,
      0,
    )
  })

  it('is not offered at all without a sidebar handler', () => {
    const React = createFakeReact()
    const CommandView = createCommandView(React)
    const tree = React.render(CommandView, {
      node: { name: COMMAND_NAME, outcome: { kind: 'success', text: ANSWER } },
    })
    assert.equal(
      collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-command-sidebar').length,
      0,
    )
  })
})

describe('the deployed browser entry', () => {
  it('occupies the command row of the /oauth-mcp command', () => {
    const React = createFakeReact()
    const CommandView = loadDeployedCommandView(React)
    assert.equal(typeof CommandView, 'function')

    const tree = React.render(CommandView, {
      node: {
        name: COMMAND_NAME,
        outcome: {
          kind: 'success',
          text: `[打开授权页面](<${AUTHORIZE_URL}>)`,
        },
      },
    })
    const links = anchors(tree)
    assert.equal(links.length, 1)
    assert.equal(links[0].props.href, AUTHORIZE_URL)
    assert.equal(links[0].props.target, '_blank')
  })
})
