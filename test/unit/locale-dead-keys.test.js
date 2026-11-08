/**
 * A locale key that nothing renders is a sentence that never reaches a user.
 *
 * The client dictionaries carry one entry per message the interface can show.
 * When a message is dropped from the interface but its entry stays in the
 * dictionary, the entry is dead weight: the language files grow, the two
 * languages have to be kept in step, and a reader of the table cannot tell
 * which sentences the interface really shows.
 *
 * This test finds those entries by looking for the key in the code that renders
 * it. A key that only appears in a dictionary is dead.
 *
 * @module dsh-oauth-mcp/test/unit/locale-dead-keys
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Read one file of the package.
 *
 * @param {string} relative The path inside the package.
 * @returns {string} The content.
 */
function read(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

/**
 * Cut the dictionary object literals out of a source.
 *
 * @param {string} source The source.
 * @returns {{ keys: string[], code: string }} The keys of the dictionaries and the
 *   source without them.
 */
function splitDictionaries(source) {
  const keys = new Set()
  let code = ''
  let index = 0
  const marker =
    /const (PANEL_STRINGS|TOOLVIEW_STRINGS|COMMANDVIEW_STRINGS|ZH|EN) = (?:Object\.freeze\()?\{/g
  let match = marker.exec(source)
  while (match !== null) {
    const from = match.index
    let depth = 0
    let at = source.indexOf('{', from)
    const start = at
    for (; at < source.length; at += 1) {
      if (source[at] === '{') depth += 1
      else if (source[at] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    for (const entry of source.slice(start, at).matchAll(/'([a-zA-Z0-9_.-]+)':/g)) {
      keys.add(entry[1])
    }
    code += `${source.slice(index, from)}\n`
    index = at + 1
    match = marker.exec(source)
  }
  code += source.slice(index)
  return { keys: [...keys], code }
}

const files = [
  'client/panel.js',
  'client/index.js',
  'client/toolview.js',
  'client/commandview.js',
]

describe('the client language tables', () => {
  it('carry no key that nothing renders', () => {
    const owners = new Map()
    let code = ''
    for (const file of files) {
      const result = splitDictionaries(read(file))
      for (const key of result.keys) {
        if (!owners.has(key)) owners.set(key, [])
        owners.get(key).push(file)
      }
      code += `${result.code}\n`
    }

    const dead = [...owners.keys()].filter((key) => !code.includes(key)).sort()
    assert.deepEqual(
      dead,
      [],
      `these keys are never rendered: ${dead.join(', ')}`,
    )
  })
})
