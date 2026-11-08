/**
 * Tests of the settings panel layout.
 *
 * The draft form used to stack every field in its own row and every input kept
 * its intrinsic width, so the form showed a lot of empty space. It is now a
 * dialog whose fields sit in grids and whose inputs fill their cell. The
 * layout is checked here for both copies of the panel: the ES module
 * `client/panel.js` and the deployed classic script `client/index.js`, which is
 * the file the browser really loads. Both copies have to stay in sync.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanel } from '../../client/panel.js'
import { buttons, collect, createFakeReact, inputs } from '../support/fake-react.js'
import {
  PANEL_CONFIG,
  createFakeConfigForm,
  loadDeployedPanel,
  renderDraft,
} from '../support/panel-harness.js'

/**
 * Assert that the draft dialog is compact.
 *
 * @param {object} tree The rendered tree.
 * @returns {void}
 */
function assertCompactLayout(tree) {
  const overlay = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-overlay')[0]
  assert.ok(overlay, 'the draft form is shown in a dialog')
  const dialog = collect(tree, (node) => node.props?.className === 'dsh-oauth-mcp-panel-dialog')[0]
  assert.ok(dialog, 'the dialog is rendered')

  const grids = collect(dialog, (node) => node.props?.className === 'dsh-oauth-mcp-panel-grid')
  assert.equal(grids.length, 2, 'the draft fields are laid out in two grids')
  for (const grid of grids) {
    assert.equal(grid.props.style.display, 'grid', 'a grid lays the fields out side by side')
    assert.match(grid.props.style.gridTemplateColumns, /auto-fit/, 'the grid adapts to the panel width')
  }

  const full = collect(
    dialog,
    (node) =>
      node.props?.className === 'dsh-oauth-mcp-panel-field' && node.props?.style?.width === '100%',
  )
  assert.equal(full.length, 2, 'the vendor and the address use the whole width')

  for (const input of inputs(dialog)) {
    if (input.props.type === 'checkbox') continue
    assert.equal(input.props.style.width, '100%', 'the input fills its cell')
  }

  const actions = dialog.children.at(-1)
  assert.ok(actions, 'the dialog has an action row')
  assert.equal(actions.props.style.justifyContent, 'space-between')
  assert.ok(
    collect(actions, (node) => node.props?.key === 'enabled')[0],
    'the enabled checkbox shares the action row',
  )
  assert.equal(buttons(actions).length, 2, 'the action row holds the save and cancel buttons')
}

test('the draft form of the panel module uses a grid and full width inputs', () => {
  const React = createFakeReact()
  const Panel = createPanel(React, { getConfigForm: () => createFakeConfigForm(PANEL_CONFIG) })
  assertCompactLayout(renderDraft(React, Panel))
})

test('the deployed browser entry uses the same compact draft form', () => {
  const React = createFakeReact()
  const Panel = loadDeployedPanel(React)
  assertCompactLayout(renderDraft(React, Panel))
})
