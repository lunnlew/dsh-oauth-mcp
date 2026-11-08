/**
 * The number of vendors in the prose has to be the number of the table.
 *
 * The vendor table grows; the sentence that names its size in the README and
 * in the usage guide would otherwise be wrong without anybody noticing. The
 * table itself is written by a generator, so only the hand written sentences
 * are checked here.
 *
 * @module dsh-oauth-mcp/test/unit/vendor-count
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { KNOWN_PROFILES } from '../../lib/profiles/known-profiles.js'

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

describe('the number of vendors in the prose', () => {
  for (const file of ['README.md', 'docs/usage.md']) {
    it(`matches the table in ${file}`, () => {
      const matches = [...read(file).matchAll(/(\d+) 家实测过的/g)]
      assert.ok(matches.length > 0, `${file} does not name the size of the vendor table`)
      for (const match of matches) {
        assert.equal(
          Number(match[1]),
          KNOWN_PROFILES.length,
          `${file} says ${match[1]} vendors, the table has ${KNOWN_PROFILES.length}`,
        )
      }
    })
  }
})
