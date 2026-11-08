/**
 * Tests of the keyboard of the draft dialog.
 *
 * A dialog the mouse can reach but the keyboard cannot is half a dialog: the
 * focus has to move into it when it opens, the Escape key has to close it and
 * the Tab key has to stay inside it.
 *
 * @module dsh-oauth-mcp/test/unit/panel-keyboard
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanel } from '../../client/panel.js'
import { buttons, collect, createFakeReact } from '../support/fake-react.js'
import {
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
  renderDraft,
} from '../support/panel-harness.js'

/**
 * Find the dialog of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object} The dialog node.
 */
function dialogOf(tree) {
  const dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(dialog, 'the draft form is shown in a dialog')
  return dialog
}

/**
 * Find the overlay of a rendered tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object} The overlay node.
 */
function overlayOf(tree) {
  const overlay = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-overlay')[0]
  assert.ok(overlay, 'the draft form has an overlay')
  return overlay
}

test('the dialog takes the focus when it opens', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })

  const tree = renderDraft(React, Panel)
  const dialog = dialogOf(tree)

  assert.ok(dialog.ref, 'the dialog holds a reference')
  assert.equal(typeof dialog.ref.current?.focus, 'function', 'the reference can take the focus')
})

test('the Escape key closes the dialog', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })

  let tree = renderDraft(React, Panel)
  const overlay = overlayOf(tree)
  assert.equal(typeof overlay.props.onKeyDown, 'function', 'the overlay handles the keys')

  overlay.props.onKeyDown({ key: 'Escape' })
  tree = React.render(Panel, {})
  assert.equal(
    collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog').length,
    0,
    'the dialog is gone',
  )
})

test('the dialog is a modal one', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })

  const dialog = dialogOf(renderDraft(React, Panel))

  assert.equal(dialog.props.role, 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
})

test('the Tab key stays inside the dialog', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })

  const tree = renderDraft(React, Panel)
  const dialog = dialogOf(tree)

  // The dialog has to know which elements can take the focus.
  const focusable = []
  for (const button of buttons(dialog)) {
    focusable.push({ ...button, getAttribute: () => null })
  }
  const node = {
    querySelectorAll: () => focusable,
    ownerDocument: { activeElement: focusable[focusable.length - 1] },
  }
  dialog.ref.current = node

  let prevented = false
  dialog.props.onKeyDown({
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(prevented, true, 'the focus does not leave the dialog')
})

test('the deployed browser entry behaves the same way', () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React)

  const tree = renderDraft(React, Panel)
  const dialog = dialogOf(tree)

  assert.equal(dialog.props.role, 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  assert.ok(dialog.ref, 'the dialog holds a reference')
  assert.equal(typeof overlayOf(tree).props.onKeyDown, 'function', 'the overlay handles the keys')
})
