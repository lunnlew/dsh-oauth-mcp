/**
 * Copy the browser-facing parts of the client modules into `client/index.js`.
 *
 * The browser entry is served as a classic script and cannot import sibling
 * files, so it carries copies of the components. Those copies used to be edited
 * by hand, which is exactly how the two drifted apart before: the panel module
 * dropped two fields on save while the copy the browser runs kept them. This
 * script regenerates the copies from the sources of truth instead.
 *
 * Two regions are copied:
 *
 * * the command row of `client/commandview.js` (`SYNC_BLOCK`);
 * * the settings panel of `client/panel.js` (`PANEL_BLOCK`).
 *
 * The vendor code inside the panel region is written by
 * `scripts/build-vendor-presets.mjs` into the entry as well, so the copy skips
 * it.
 *
 * Usage: `node scripts/sync-client.mjs`
 *
 * @module dsh-oauth-mcp/scripts/sync-client
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const targetPath = join(root, 'client', 'index.js')

/**
 * Take the part of a source between two markers.
 *
 * @param {string} source The source file.
 * @param {string} start The marker that opens the part.
 * @param {string} end The marker that closes it.
 * @returns {string} The marked part.
 */
function extractBlock(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end)
  if (from < 0 || to < 0) {
    throw new Error(`The markers ${start} / ${end} are missing.`)
  }
  return source.slice(source.indexOf('\n', from) + 1, to).trim()
}

/**
 * Turn an ES module into a plain script fragment.
 *
 * Only the `export ` keyword is removed; the browser entry keeps the same
 * names and the same code.
 *
 * @param {string} block The marked part of the source.
 * @returns {string} The script fragment.
 */
function toScript(block) {
  return block.replace(/^export\s+/gm, '')
}

/**
 * Put a fragment into the marked region of the target.
 *
 * @param {string} target The target file.
 * @param {string} start The marker that opens the region.
 * @param {string} end The marker that closes the region.
 * @param {string} body The fragment.
 * @returns {string} The target file with the new region.
 */
function putBlock(target, start, end, body) {
  const from = target.indexOf(start)
  const to = target.indexOf(end)
  if (from < 0 || to < 0) {
    throw new Error(`The markers ${start} / ${end} are missing from client/index.js.`)
  }
  const header = target.slice(0, from + start.length)
  const footer = target.slice(to)
  return `${header}\n    ${body}\n    ${footer}`
}

/**
 * Put a merged table into the target.
 *
 * The browser entry registers one dictionary with the locale service, so it
 * needs the tables of every client module in one place.
 *
 * @param {string} target The target file.
 * @param {string} name The name of the table.
 * @param {string[]} entries The entries of the table.
 * @returns {string} The target file with the new table.
 */
function putTable(target, name, entries) {
  const marker = new RegExp(`const ${name} = \\{`)
  const match = marker.exec(target)
  if (!match) throw new Error(`The table ${name} is missing from client/index.js.`)
  let depth = 0
  let at = target.indexOf('{', match.index)
  const start = at
  for (; at < target.length; at += 1) {
    if (target[at] === '{') depth += 1
    else if (target[at] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const lineStart = target.lastIndexOf('\n', match.index) + 1
  const indent = ' '.repeat(match.index - lineStart)
  // The closing line of a module table does not belong to a flat table.
  const cleaned = entries.filter((entry) => entry !== '}),' && entry !== '})')
  const body = cleaned.map((entry) => `${indent}  ${entry}`).join('\n')
  return `${target.slice(0, start + 1)}\n${body}${target.slice(at)}`
}

/**
 * Take the two languages of a table of a module.
 *
 * @param {string} source The source.
 * @param {string} name The name of the table.
 * @returns {{ zh: string[], en: string[] }} The entries of the two languages.
 */
function takeTable(source, name) {
  const marker = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\{`)
  const match = marker.exec(source)
  if (!match) throw new Error(`The table ${name} is missing.`)
  let depth = 0
  let at = source.indexOf('{', match.index)
  const start = at
  for (; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1
    else if (source[at] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(start, at + 1)
  const zhAt = body.indexOf('zh:')
  const enAt = body.indexOf('en:')
  if (zhAt < 0 || enAt < 0) throw new Error(`The table ${name} has no language.`)
  const zh = body.slice(body.indexOf('{', zhAt) + 1, body.lastIndexOf('}', enAt))
  const en = body.slice(body.indexOf('{', enAt) + 1, body.length - 1)

  /**
   * The entries of one table body.
   *
   * @param {string} text The body.
   * @returns {string[]} The entries.
   */
  const entries = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== '}),' && line !== '})')

  return { zh: entries(zh), en: entries(en) }
}

const commandView = readFileSync(join(root, 'client', 'commandview.js'), 'utf8')
const panel = readFileSync(join(root, 'client', 'panel.js'), 'utf8')
const toolView = readFileSync(join(root, 'client', 'toolview.js'), 'utf8')
let target = readFileSync(targetPath, 'utf8')

// The helpers both components share. The browser entry has one copy of them.
target = putBlock(
  target,
  '// >>> SHARED_HELPERS',
  '// <<< SHARED_HELPERS',
  `${toScript(extractBlock(panel, '// >>> SHARED_HELPERS', '// <<< SHARED_HELPERS'))}\n    `,
)

// The command row.
target = putBlock(
  target,
  '// >>> COMMAND_VIEW',
  '// <<< COMMAND_VIEW',
  `${toScript(extractBlock(commandView, '// >>> SYNC_BLOCK', '// <<< SYNC_BLOCK'))}\n    `,
)

// The tool views.
target = putBlock(
  target,
  '// >>> TOOL_VIEW',
  '// <<< TOOL_VIEW',
  `${toScript(extractBlock(toolView, '// >>> TOOLVIEW_BLOCK', '// <<< TOOLVIEW_BLOCK'))}\n    `,
)

// The settings panel. The vendor code inside the region is written into the
// entry by the vendor generator, so the copy leaves it out.
const panelBlock = extractBlock(panel, '// >>> PANEL_BLOCK', '// <<< PANEL_BLOCK')
const vendorFrom = panelBlock.indexOf('// >>> VENDOR_CODE')
const vendorTo = panelBlock.indexOf('// <<< VENDOR_CODE')
let panelBody
if (vendorFrom >= 0 && vendorTo > vendorFrom) {
  panelBody = [
    panelBlock.slice(0, vendorFrom).trimEnd(),
    panelBlock.slice(vendorTo + '// <<< VENDOR_CODE'.length).trim(),
  ]
    .filter((part) => part.length > 0)
    .join('\n\n')
} else {
  panelBody = panelBlock
}
target = putBlock(
  target,
  '// >>> PANEL_VIEW',
  '// <<< PANEL_VIEW',
  `${toScript(panelBody)}\n    `,
)

// The dictionary the entry registers with the locale service: the tables of
// all three client modules, merged.
const tables = [
  takeTable(panel, 'PANEL_STRINGS'),
  takeTable(toolView, 'TOOLVIEW_STRINGS'),
  takeTable(commandView, 'COMMANDVIEW_STRINGS'),
]
target = putTable(target, 'ZH', tables.flatMap((table) => table.zh))
target = putTable(target, 'EN', tables.flatMap((table) => table.en))

writeFileSync(targetPath, target, 'utf8')
process.stdout.write(
  'synced client/commandview.js, client/panel.js and client/toolview.js -> client/index.js\n',
)
