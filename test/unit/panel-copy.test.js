/**
 * Tests of the feedback of the copy button of the settings panel.
 *
 * The button answers for itself: after a copy it shows what happened, so the
 * user does not have to look away from the button to see that it worked. The
 * answer stays for a moment and then the button goes back to its usual label.
 *
 * The panel exists in two copies (the ES module and the deployed classic
 * script) and both are checked here, because the browser only ever runs the
 * second one.
 *
 * @module dsh-oauth-mcp/test/unit/panel-copy
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { COPY_FEEDBACK_MS, createPanel } from '../../client/panel.js'
import {
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
} from '../support/panel-harness.js'
import { buttons, createFakeReact } from '../support/fake-react.js'

const SERVERS = [
  {
    id: 'notion',
    label: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    scopes: ['default'],
    enabled: true,
  },
]

const CONFIG = { ...PANEL_CONFIG, servers: SERVERS }

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
 * Install a clipboard that records what it was given.
 *
 * @param {object} [options] The options.
 * @param {boolean} [options.fail] Whether the clipboard refuses.
 * @returns {{ written: string[] }} The recorded writes.
 */
function installClipboard(options = {}) {
  const written = []
  // `navigator` is a getter-only property on the global object, so it is
  // replaced rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: async (value) => {
          if (options.fail) throw new Error('no clipboard')
          written.push(value)
        },
      },
    },
  })
  return { written }
}

/**
 * Find the copy button of a rendered tree.
 *
 * The button changes its label while it answers, so it is found by its
 * position among the buttons of a server row.
 *
 * @param {object} tree The rendered tree.
 * @returns {object} The button node.
 */
function copyButton(tree) {
  const found = buttons(tree).find((button) => {
    const text = textOf(button.children)
    return (
      text.includes('复制授权命令') ||
      text.includes('Copy the authorization command') ||
      text.includes('已复制') ||
      text.includes('Copied') ||
      text.includes('复制失败') ||
      text.includes('Copy failed')
    )
  })
  assert.ok(found, 'the panel shows the copy button')
  return found
}

/**
 * Wait for the pending work of the panel to settle.
 *
 * The copy is asynchronous: the button answers once the clipboard answered.
 *
 * @returns {Promise<void>} Resolves after the next turn of the event loop.
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Assert that the copy button answers on its own.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @returns {void}
 */
async function assertButtonAnswers(React, Panel) {
  const form = createFakeConfigForm(CONFIG)
  const clipboard = installClipboard()

  let tree = React.render(Panel, {})
  const button = copyButton(tree)
  assert.ok(textOf(button.children).includes('复制授权命令'), 'the button starts with its usual label')

  await button.props.onClick()
  await flush()
  tree = React.render(Panel, {})
  const answered = copyButton(tree)
  assert.ok(textOf(answered.children).includes('已复制'), 'the button says that it copied')
  assert.equal(
    answered.props.style.color,
    'var(--dsw-alias-state-success-primary)',
    'the button shows the success colour',
  )
  assert.deepEqual(clipboard.written, ['/oauth-mcp authorize https://mcp.notion.com/mcp'])

  // The answer goes away on its own.
  await new Promise((resolve) => setTimeout(resolve, COPY_FEEDBACK_MS + 50))
  tree = React.render(Panel, {})
  assert.ok(
    textOf(copyButton(tree).children).includes('复制授权命令'),
    'the button goes back to its usual label',
  )
}

/**
 * Assert that the copy button reports a failure.
 *
 * @param {object} React The fake React runtime.
 * @param {Function} Panel The panel component.
 * @returns {void}
 */
async function assertButtonReportsFailure(React, Panel) {
  const form = createFakeConfigForm(CONFIG)
  installClipboard({ fail: true })

  let tree = React.render(Panel, {})
  await copyButton(tree).props.onClick()
  await flush()
  tree = React.render(Panel, {})
  const answered = copyButton(tree)
  assert.ok(textOf(answered.children).includes('复制失败'), 'the button says that it failed')
  assert.equal(
    answered.props.style.color,
    'var(--dsw-alias-state-error-primary)',
    'the button shows the error colour',
  )
}

test('the copy button of the panel answers on its own', async () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(CONFIG) })
  await assertButtonAnswers(React, Panel)
})

test('the copy button of the deployed browser entry answers on its own', async () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React, CONFIG)
  await assertButtonAnswers(React, Panel)
})

test('the copy button reports a failure', async () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(CONFIG) })
  await assertButtonReportsFailure(React, Panel)
})

test('the copy button of the deployed browser entry reports a failure', async () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React, CONFIG)
  await assertButtonReportsFailure(React, Panel)
})
