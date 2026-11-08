/**
 * Generate the vendor table of the browser entry.
 *
 * The vendor table lives in `lib/profiles/known-profiles.js`, the table of the
 * server half, and `lib/profiles/vendor-presets.js` projects it into the shape
 * the panel needs. The browser cannot read those modules, so the client half
 * needs a copy of the data, and a copy that is written by hand is a copy that
 * drifts.
 *
 * This script is the only writer of that copy. It renders the projection into
 * the data region of `client/index.js`, the one file the browser really runs,
 * and it copies the code region of `client/panel.js` into the browser entry,
 * which cannot import it. The ES module `client/panel.js` imports the same
 * projection and needs no copy at all.
 *
 * The document repeats the table for the reader; that table is written by
 * `scripts/build-vendor-table.mjs`, which this script calls.
 *
 * Usage: `node scripts/build-vendor-presets.mjs`
 *
 * @module dsh-oauth-mcp/scripts/build-vendor-presets
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PUBLIC_SUFFIXES } from '../lib/profiles/known-profiles.js'
import { VENDOR_PRESETS } from '../lib/profiles/vendor-presets.js'
import { buildVendorDoc } from './build-vendor-table.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** The opening marker of the generated data region. */
const DATA_START = '// >>> VENDOR_DATA'
/** The closing marker of the generated data region. */
const DATA_END = '// <<< VENDOR_DATA'
/** The opening marker of the hand written code region. */
const CODE_START = '// >>> VENDOR_CODE'
/** The closing marker of the hand written code region. */
const CODE_END = '// <<< VENDOR_CODE'
/** The indent of the factory body of the browser entry. */
const FACTORY_INDENT = '    '
/** The width a rendered line may have before it is broken over several lines. */
const LINE_WIDTH = 120

/**
 * Write one string as a JavaScript literal.
 *
 * @param {string} value The value.
 * @returns {string} The literal.
 */
function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Render one list of scopes.
 *
 * @param {string[]} values The scopes.
 * @param {string} indent The indent of the line the list belongs to.
 * @param {string} key The name of the property.
 * @returns {string} The rendered property.
 */
function renderList(values, indent, key) {
  const inline = `${key}: Object.freeze([${values.map(quote).join(', ')}]),`
  if (`${indent}${inline}`.length <= LINE_WIDTH) return `${indent}${inline}`
  const lines = [`${indent}${key}: Object.freeze([`]
  for (const value of values) lines.push(`${indent}  ${quote(value)},`)
  lines.push(`${indent}]),`)
  return lines.join('\n')
}

/**
 * Render one vendor preset.
 *
 * @param {object} preset The preset of the projection.
 * @param {string} indent The indent of the entry.
 * @returns {string} The rendered entry.
 */
function renderPreset(preset, indent) {
  const inner = `${indent}  `
  const lines = [`${indent}{`]
  lines.push(`${inner}id: ${quote(preset.id)},`)
  lines.push(`${inner}label: ${quote(preset.label)},`)
  lines.push(`${inner}endpoint: ${quote(preset.endpoint)},`)
  if (preset.authorizationServerUrl !== undefined) {
    lines.push(`${inner}authorizationServerUrl: ${quote(preset.authorizationServerUrl)},`)
  }
  lines.push(renderList(preset.scopes, inner, 'scopes'))
  lines.push(renderList(preset.defaultScopes, inner, 'defaultScopes'))
  lines.push(`${inner}needsClientId: ${preset.needsClientId ? 'true' : 'false'},`)
  lines.push(`${indent}},`)
  return lines.join('\n')
}

/**
 * Render the data region: the table of the vendors and the suffix list.
 *
 * @param {object} [options] The options.
 * @param {boolean} [options.exported] Whether the table is an exported
 *   constant (the ES module) or a plain one (the browser entry).
 * @param {string} [options.indent] The indent of the region.
 * @returns {string} The rendered region.
 */
export function renderVendorData(options = {}) {
  const indent = options.indent ?? ''
  const exported = options.exported !== false
  const lines = [
    `${indent}/**`,
    `${indent} * The vendor presets the panel offers in its picker.`,
    `${indent} *`,
    `${indent} * This table is generated from \`lib/profiles/vendor-presets.js\`, the`,
    `${indent} * projection of the server table. \`scripts/build-vendor-presets.mjs\` writes`,
    `${indent} * it: never edit it by hand, the generator is the only writer.`,
    `${indent} */`,
    `${indent}${exported ? 'export const' : 'const'} VENDOR_PRESETS = Object.freeze([`,
  ]
  for (const preset of VENDOR_PRESETS) lines.push(renderPreset(preset, `${indent}  `))
  lines.push(`${indent}])`)
  lines.push('')
  lines.push(`${indent}/**`)
  lines.push(`${indent} * The public suffixes the id derivation knows.`)
  lines.push(`${indent} *`)
  lines.push(`${indent} * The list comes from \`lib/profiles/known-profiles.js\`, so the panel`)
  lines.push(`${indent} * and the server half derive the same identifier from the same`)
  lines.push(`${indent} * address. A classic script cannot import it, so it is written out here.`)
  lines.push(`${indent} */`)
  lines.push(`${indent}${exported ? 'export const' : 'const'} PUBLIC_SUFFIXES = Object.freeze([`)
  for (const suffix of PUBLIC_SUFFIXES) lines.push(`${indent}  ${quote(suffix)},`)
  lines.push(`${indent}])`)
  return lines.join('\n')
}

/**
 * Take the part of a file between two markers.
 *
 * @param {string} source The file content.
 * @param {string} startMarker The opening marker.
 * @param {string} endMarker The closing marker.
 * @returns {string} The marked part, without the newline of its last line.
 */
export function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`The markers ${startMarker} and ${endMarker} are missing.`)
  }
  const from = source.indexOf('\n', start)
  return source.slice(from + 1, end).replace(/\n+$/, '')
}

/**
 * Replace the part of a file between two markers.
 *
 * @param {string} source The file content.
 * @param {string} startMarker The opening marker.
 * @param {string} endMarker The closing marker.
 * @param {string} body The new content of the region.
 * @returns {string} The new file content.
 */
export function replaceRegion(source, startMarker, endMarker, body) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`The markers ${startMarker} and ${endMarker} are missing.`)
  }
  const header = source.slice(0, source.indexOf('\n', start) + 1)
  // The closing marker keeps the indent of its own line.
  const footer = source.slice(source.lastIndexOf('\n', end) + 1)
  return `${header}${body}\n${footer}`
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
export function stripExports(block) {
  return block.replace(/^export\s+/gm, '')
}

/**
 * Indent every line of a fragment.
 *
 * @param {string} block The fragment.
 * @param {string} indent The indent.
 * @returns {string} The indented fragment.
 */
export function indentBlock(block, indent) {
  return block
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : indent + line))
    .join('\n')
}

/**
 * Render the code region of the browser entry.
 *
 * The code region of `client/panel.js` is hand written; the browser entry
 * cannot import it, so the same code is copied into it.
 *
 * @param {string} panelSource The source of `client/panel.js`.
 * @returns {string} The rendered region.
 */
export function renderVendorCode(panelSource) {
  const block = extractBlock(panelSource, CODE_START, CODE_END)
  return indentBlock(stripExports(block), FACTORY_INDENT)
}

/**
 * Build the next source of the deployed browser entry.
 *
 * Only the browser entry needs a written out copy of the data: a classic
 * script cannot import it. The ES module `client/panel.js` imports the same
 * table from `lib/profiles/vendor-presets.js`.
 *
 * @param {string} indexSource The source of `client/index.js`.
 * @param {string} panelSource The source of `client/panel.js`.
 * @returns {string} The new source.
 */
export function buildIndexSource(indexSource, panelSource) {
  const withData = replaceRegion(
    indexSource,
    DATA_START,
    DATA_END,
    renderVendorData({ exported: false, indent: FACTORY_INDENT }),
  )
  return replaceRegion(withData, CODE_START, CODE_END, renderVendorCode(panelSource))
}

/**
 * Write the vendor table into the browser entry and into the document.
 */
function main() {
  const panelPath = join(root, 'client', 'panel.js')
  const indexPath = join(root, 'client', 'index.js')
  const docPath = join(root, 'docs', 'vendors.md')
  const panelSource = readFileSync(panelPath, 'utf8')
  const indexSource = readFileSync(indexPath, 'utf8')
  const docSource = readFileSync(docPath, 'utf8')

  const nextIndex = buildIndexSource(indexSource, panelSource)
  const nextDoc = buildVendorDoc(docSource)

  writeFileSync(indexPath, nextIndex, 'utf8')
  writeFileSync(docPath, nextDoc, 'utf8')

  process.stdout.write(
    `wrote client/index.js: ${VENDOR_PRESETS.length} vendor presets, ${PUBLIC_SUFFIXES.length} suffixes, 1 code region\n` +
      `wrote docs/vendors.md: ${VENDOR_PRESETS.length} vendors\n`,
  )
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) main()
