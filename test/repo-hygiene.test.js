/**
 * The guard of the repository hygiene.
 *
 * Why this exists:
 *   A machine-local path, a stale package name or a foreign plugin name
 *   travels with the plugin once it is written into a file. The reader of
 *   the repository cannot run the path, cannot install the package under the
 *   old name, and learns about a project that has nothing to do with this
 *   one.
 *   A replacement character (U+FFFD) means a file was written with the wrong
 *   encoding at some point; the text around it is then silently wrong.
 *
 * The checks:
 *   1. no machine-local absolute path
 *   2. no stale package identity
 *   3. no damaged encoding
 *   4. no foreign plugin name
 *   5. the identifiers the documentation names exist in the source
 *   6. every test file is really run
 *
 * @module dsh-oauth-mcp/test/repo-hygiene
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** The file extensions that are read as text. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])

/** The directories that are not part of the repository content. */
const SKIPPED_DIRECTORIES = ['node_modules', '.git', 'coverage']

/**
 * Collect the text files of the repository.
 *
 * The dependencies and the version control data are not repository content,
 * and a packed archive is a binary file.
 *
 * @returns {string[]} The paths inside the repository.
 */
function repositoryFiles() {
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (entry.name.endsWith('.tgz')) continue
      const dot = entry.name.lastIndexOf('.')
      const extension = dot > 0 ? entry.name.slice(dot) : ''
      const isText = TEXT_EXTENSIONS.has(extension) || (dot <= 0 && entry.name === 'LICENSE')
      if (!isText) continue
      files.push(absolute)
    }
  }
  walk(root)
  return files
}

/**
 * Collect the test files of the repository.
 *
 * @returns {string[]} The paths of the files under test/.
 */
function testFiles() {
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      files.push(absolute)
    }
  }
  walk(join(root, 'test'))
  return files
}

/**
 * Find the lines of a set of files that carry a needle.
 *
 * @param {string[]} files The files to read.
 * @param {string} needle The text to look for.
 * @param {boolean} [ignoreCase] Whether the letter case is ignored.
 * @returns {string[]} One entry per hit: the file, the line and the text.
 */
function findHits(files, needle, ignoreCase = false) {
  const hits = []
  const wanted = ignoreCase ? needle.toLowerCase() : needle
  for (const file of files) {
    const name = relative(root, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const haystack = ignoreCase ? line.toLowerCase() : line
      if (!haystack.includes(wanted)) return
      hits.push(`${name}:${index + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  return hits
}

/**
 * Read the manifest of the package.
 *
 * @returns {object} The parsed package.json.
 */
function readPackageJson() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

/** The files the scan looks at. */
const scanned = repositoryFiles()

describe('the repository of the plugin', () => {
  it('carries no machine-local absolute path', () => {
    // A path of this machine works here and nowhere else. The reader of the
    // repository cannot follow it, and the path tells the reader more about
    // the machine than about the project.
    const hits = []
    for (const file of scanned) {
      const name = relative(root, file).replace(/\\/g, '/')
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        // The slashes of a URL are not a path: those fragments are taken
        // out before the search, so only real paths are reported.
        const plain = line.replace(/\b(?:https?|file):\/\/\S+/g, '')
        if (!/\b[A-Za-z]:[\\/][A-Za-z0-9_.-]+[\\/]/.test(plain)) return
        hits.push(`${name}:${index + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    assert.deepEqual(
      hits,
      [],
      `machine-local paths in ${hits.length} place(s): ${hits.slice(0, 5).join(' | ')}`,
    )
  })

  it('carries no stale package name', () => {
    // The needles are assembled at run time: this file is part of the scan,
    // and a name written down in full would make the test fail on itself.
    const staleName = '@' + 'local/' + 'dsh-oauth-mcp'
    const staleScope = '@' + 'local/' + readPackageJson().name
    const hits = findHits(scanned, staleName)
    assert.deepEqual(
      hits,
      [],
      `the old package name is still in ${hits.length} place(s): ${hits.slice(0, 5).join(' | ')}`,
    )
    const scoped = findHits(scanned, staleScope)
    assert.deepEqual(
      scoped,
      [],
      `the package name still carries the old scope in ${scoped.length} place(s): ${scoped.slice(0, 5).join(' | ')}`,
    )
  })

  it('carries no damaged encoding', () => {
    // U+FFFD is the character a decoder writes when it cannot read a byte.
    // The line around it is then wrong without saying so.
    const hits = []
    for (const file of scanned) {
      const name = relative(root, file).replace(/\\/g, '/')
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('\uFFFD')) return
        hits.push(`${name}:${index + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    assert.deepEqual(
      hits,
      [],
      `damaged encoding in ${hits.length} place(s): ${hits.slice(0, 5).join(' | ')}`,
    )
  })

  it('carries no foreign plugin name', () => {
    // Another plugin of the same family is a different product. Its name in
    // this repository sends the reader to the wrong code.
    // The needle is assembled at run time so that this file does not match
    // itself.
    const foreign = 'dsh-voice-' + 'typing'
    const hits = findHits(scanned, foreign, true)
    assert.deepEqual(
      hits,
      [],
      `a foreign plugin name is in ${hits.length} place(s): ${hits.slice(0, 5).join(' | ')}`,
    )
  })

  it('names only identifiers the source really has', () => {
    // The documentation, the panel and the host command speak about the
    // command, the tools and the callback path. A name that is only written
    // down somewhere is a name the user cannot use.
    const shipped = [join(root, 'index.js')]
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name)
        if (entry.isDirectory()) {
          walk(absolute)
          continue
        }
        if (entry.name.endsWith('.js')) shipped.push(absolute)
      }
    }
    walk(join(root, 'lib'))
    const text = shipped.map((file) => readFileSync(file, 'utf8')).join('\n')
    // The quotes are part of the needle: the bare word also sits inside the
    // callback path, so a bare search would find nothing that the path does
    // not already carry.
    for (const identifier of [
      "'oauth-mcp'",
      "'dsh_oauth_mcp_authorize'",
      "'dsh_oauth_mcp_status'",
      "'/oauth-mcp/callback'",
    ]) {
      assert.ok(
        text.includes(identifier),
        `the shipped source does not mention ${identifier}`,
      )
    }
  })

  it('runs every test file', () => {
    // The test script runs one glob. A file whose name does not match the
    // glob is never executed, and a guard that never runs is the same as no
    // guard at all.
    const manifest = readPackageJson()
    const script = String(manifest.scripts?.test ?? '')
    assert.ok(script.includes('node --test'), `the test script is: ${script}`)
    const match = /--test\s+"?([^"\s]+)"?/.exec(script)
    assert.ok(match, `the test script names no file pattern: ${script}`)
    assert.equal(
      match[1],
      'test/**/*.test.js',
      'the pattern of the test script does not cover every test file',
    )
    const files = testFiles()
    const covered = files.filter((file) => file.endsWith('.test.js'))
    assert.ok(covered.length > 0, 'the repository carries no test file at all')
    const uncovered = files
      .filter((file) => file.endsWith('.test.mjs') || file.endsWith('.test.cjs'))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
    assert.deepEqual(
      uncovered,
      [],
      `these test files are not matched by the pattern and would never run: ${uncovered.join(', ')}`,
    )
  })
})
