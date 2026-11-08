/**
 * The guard of the published archive.
 *
 * Why this exists: the plugin is installed as a tarball in CI, on other
 * machines and by users, so a file that is missing from the archive is
 * invisible here — the file sits right next to the source. Only an install
 * from the packed archive breaks, with ERR_MODULE_NOT_FOUND.
 *
 * The test does not ask what the `files` whitelist of package.json says. It
 * asks whether every file of the runtime import graph is inside the archive
 * that npm itself computes. Both sides are pinned:
 *   under-shipping → the install fails;
 *   over-shipping  → development material (test / scripts / docs) travels
 *                     to every user of the package.
 *
 * The list comes from npm: `npm pack --dry-run --json` is the only algorithm
 * that agrees with a real publish. A second implementation of the whitelist
 * semantics would only be a second answer that can differ from the first.
 *
 * @module dsh-oauth-mcp/test/packaging
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * The shape of a real module specifier.
 *
 * A specifier never carries a comma, a space or a parenthesis. The filter
 * keeps compressed third party code — a string that merely looks like a
 * path — from being mistaken for a dependency.
 */
const SPECIFIER_SHAPE = /^[.@/:A-Za-z][A-Za-z0-9@._+:/-]*$/

/** The file extensions that carry JavaScript. */
const SCRIPT_EXTENSION = /\.(js|cjs|mjs)$/

/** The file extensions that are read as text by the repository scan. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])

/**
 * Read the manifest of the package.
 *
 * The manifest is read from disk on every call: the file may still change
 * while the tests run, and a value frozen into the test would only describe
 * the moment the test was written.
 *
 * @returns {object} The parsed package.json.
 */
function readPackageJson() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

/**
 * Parse the output of `npm pack --json`.
 *
 * npm answers with an array — one entry per package — and the shell may put
 * notice lines in front of it, so the JSON starts at the first bracket.
 *
 * @param {string} stdout The output of npm.
 * @returns {object|null} The pack manifest, or null when it cannot be read.
 */
function parsePackOutput(stdout) {
  const raw = String(stdout).trim()
  const candidates = [raw]
  const start = raw.search(/[[{]/)
  if (start > 0) candidates.push(raw.slice(start))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      return Array.isArray(parsed) ? parsed[0] : parsed
    } catch {
      // Try the next cut of the output.
    }
  }
  return null
}

/** The cached answer of npm; npm is asked once, not once per assertion. */
let packCache = null

/**
 * Ask npm for the list of files the archive would carry.
 *
 * The shell is on because npm is npm.cmd on Windows and Node refuses to
 * spawn a batch file without it. `--ignore-scripts` keeps the question
 * narrow: this test asks whether the list is right, not whether a build
 * works.
 *
 * @returns {{ manifest: object|null, error: Error|null }} The pack manifest, or the reason it is missing.
 */
function packResult() {
  if (packCache) return packCache
  const packed = spawnSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (packed.error) {
    packCache = { manifest: null, error: packed.error }
    return packCache
  }
  if (packed.status !== 0) {
    const reason = String(packed.stderr || packed.stdout || '').split('\n')[0]
    packCache = { manifest: null, error: new Error(`npm pack exited with ${packed.status}: ${reason}`) }
    return packCache
  }
  const manifest = parsePackOutput(packed.stdout)
  if (!manifest || !Array.isArray(manifest.files)) {
    packCache = { manifest: null, error: new Error('the output of npm pack --json cannot be read') }
    return packCache
  }
  packCache = { manifest, error: null }
  return packCache
}

/**
 * Read the pack manifest and fail the test when npm did not answer.
 *
 * A missing npm is not a reason to skip: CI installs Node, and publishing
 * needs npm, so a silent skip here would be a false green.
 *
 * @returns {object} The pack manifest.
 */
function requirePackManifest() {
  const { manifest, error } = packResult()
  assert.equal(error, null, error ? error.message : '')
  return manifest
}

/**
 * The paths the archive carries, with forward slashes.
 *
 * @param {object} manifest The pack manifest.
 * @returns {string[]} The paths inside the archive.
 */
function publishedPaths(manifest) {
  return manifest.files.map((file) => String(file.path).replace(/\\/g, '/'))
}

/**
 * Remove the comments of a source file.
 *
 * @param {string} text The source.
 * @returns {string} The source without block and line comments.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Collect the module specifiers a source file mentions.
 *
 * All four writings are caught, and every one of them asks for a syntax
 * position: a path named in prose is not a dependency.
 *   from './x.js'                       import and re-export
 *   import('./x.js')                    dynamic import
 *   require('./x.js')                   CommonJS
 *   new URL('./x.js', import.meta.url)  a file loaded by path
 *
 * @param {string} text The source.
 * @returns {string[]} The specifiers.
 */
function specifiersOf(text) {
  const out = []
  const source = stripComments(text)
  for (const match of source.matchAll(/(?<![\w.$])(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"\n]+)['"]/g)) {
    const specifier = match[1].trim()
    if (SPECIFIER_SHAPE.test(specifier)) out.push(specifier)
  }
  for (const match of source.matchAll(/new URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g)) {
    const specifier = match[1].trim()
    if (SPECIFIER_SHAPE.test(specifier)) out.push(specifier)
  }
  return out
}

/**
 * The entry points of the package.
 *
 * The host loads the package through `main` and through the `exports` map,
 * so those are the files the runtime starts from. Only JavaScript is walked;
 * the locale files and the icon are data.
 *
 * @param {object} manifest The package manifest.
 * @returns {string[]} The entry points, as paths inside the package.
 */
function entryPoints(manifest) {
  const targets = new Set()
  if (typeof manifest.main === 'string') targets.add(manifest.main)
  const walk = (value) => {
    if (typeof value === 'string') targets.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(manifest.exports ?? {})
  return [...targets]
    .map((target) => posix.normalize(target.startsWith('./') ? target.slice(2) : target))
    .filter((target) => SCRIPT_EXTENSION.test(target))
}

/**
 * Walk the runtime import graph from the entry points.
 *
 * @param {object} manifest The package manifest.
 * @returns {{ files: Set<string>, bare: Map<string, string>, outside: string[], missing: string[] }}
 *   The files of the graph, the bare specifiers with the file that asked for
 *   them, the imports that leave the package and the imports with no target.
 */
function crawlImportGraph(manifest) {
  const files = new Set()
  const bare = new Map()
  const outside = []
  const missing = []
  const queue = entryPoints(manifest)
  while (queue.length > 0) {
    const relativePath = queue.shift()
    if (files.has(relativePath)) continue
    files.add(relativePath)
    const absolute = join(root, ...relativePath.split('/'))
    if (!existsSync(absolute)) {
      missing.push(relativePath)
      continue
    }
    for (const specifier of specifiersOf(readFileSync(absolute, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        if (!bare.has(specifier)) bare.set(specifier, relativePath)
        continue
      }
      const next = posix.normalize(posix.join(posix.dirname(relativePath), specifier))
      if (next.startsWith('..')) {
        outside.push(`${relativePath} -> ${specifier}`)
        continue
      }
      if (/\.(js|cjs|mjs|json)$/.test(next)) queue.push(next)
    }
  }
  return { files, bare, outside, missing }
}

/**
 * Collect the text files of the repository.
 *
 * The dependencies and the version control data are not part of the
 * repository content, and a packed archive is a binary file.
 *
 * @returns {string[]} The paths inside the repository.
 */
function repositoryFiles() {
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'coverage'].includes(entry.name)) continue
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

/** The CI workflow files, empty when the directory does not exist yet. */
const workflowDirectory = join(root, '.github', 'workflows')
const workflowFiles = existsSync(workflowDirectory)
  ? readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name)).sort()
  : []

/** The reason the workflow check is skipped, empty when it runs. */
const skip = workflowFiles.length === 0 ? 'the directory .github/workflows does not exist' : false

describe('the published archive of the plugin', () => {
  it('is computed by npm itself', () => {
    const pack = requirePackManifest()
    const paths = publishedPaths(pack)
    assert.ok(paths.length > 0, 'the archive carries files')
    assert.ok(paths.includes('index.js'), 'the entry point is in the archive')
    assert.ok(paths.includes('package.json'), 'the manifest itself is in the archive')
  })

  it('carries every file of the runtime import graph', () => {
    const pack = requirePackManifest()
    const published = new Set(publishedPaths(pack))
    const graph = crawlImportGraph(readPackageJson())
    const notShipped = [...graph.files].filter((file) => !published.has(file))
    assert.deepEqual(
      notShipped,
      [],
      `the archive is missing ${notShipped.length} file(s) of the import graph: ${notShipped.join(', ')}`,
    )
  })

  it('has no import that leaves the package', () => {
    const graph = crawlImportGraph(readPackageJson())
    assert.deepEqual(
      graph.outside,
      [],
      `these imports point outside the package: ${graph.outside.join(', ')}`,
    )
  })

  it('has no import without a target', () => {
    const graph = crawlImportGraph(readPackageJson())
    assert.deepEqual(
      graph.missing,
      [],
      `these imports point at a file that does not exist: ${graph.missing.join(', ')}`,
    )
  })

  it('covers the whole import graph', () => {
    // The check above is worthless when the scanner finds nothing, so the
    // graph is asked to be bigger than a handful of files and to carry at
    // least one bare specifier — the runtime dependency of the package.
    const manifest = readPackageJson()
    const graph = crawlImportGraph(manifest)
    assert.ok(graph.files.size >= 10, `the graph has ${graph.files.size} file(s) only`)
    assert.ok(graph.bare.size >= 1, 'the graph carries no bare specifier at all')
    for (const entry of entryPoints(manifest)) {
      assert.ok(graph.files.has(entry), `the entry point ${entry} is not part of the graph`)
    }
  })

  it('carries no development material', () => {
    const pack = requirePackManifest()
    const paths = publishedPaths(pack)
    for (const directory of ['test/', 'scripts/', 'docs/']) {
      const leaked = paths.filter((file) => file.startsWith(directory))
      assert.deepEqual(leaked, [], `the archive carries ${leaked.length} file(s) of ${directory}`)
    }
    for (const file of ['DESIGN.md', 'TASKS.md', 'package-lock.json', '.npmrc', '.gitattributes']) {
      assert.ok(!paths.includes(file), `the archive carries ${file}`)
    }
    const withModules = paths.filter((file) => file.split('/').includes('node_modules'))
    assert.deepEqual(withModules, [], `the archive carries ${withModules.length} file(s) of node_modules`)
  })

  it('declares every bare dependency of the shipped source', () => {
    const manifest = readPackageJson()
    const graph = crawlImportGraph(manifest)
    const declared = new Set(
      [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ].map((name) => name.split('/')[0]),
    )
    const undeclared = [...graph.bare.keys()].filter((specifier) => {
      // The built-in modules of Node are not packages and cannot be declared.
      if (specifier.startsWith('node:')) return false
      return !declared.has(specifier.split('/')[0])
    })
    assert.deepEqual(
      undeclared,
      [],
      `these packages are used but not declared: ${undeclared.join(', ')}`,
    )
  })

  it('takes the browser runtime from the host', () => {
    // The host resolves the browser modules from its own table. A runtime
    // dependency would install a second copy of the library and the host
    // would stop recognising the module the browser asks for.
    const manifest = readPackageJson()
    assert.ok(
      'react' in (manifest.peerDependencies ?? {}),
      'the browser runtime is a peer dependency',
    )
    assert.ok(
      !('react' in (manifest.dependencies ?? {})),
      'the browser runtime is not a runtime dependency',
    )
  })

  it('takes the version from one source', async () => {
    // The version is written in package.json and in lib/build-info.js. Two
    // files with one value drift apart the first time one of them is edited.
    const manifest = readPackageJson()
    const buildInfo = await import('../lib/build-info.js')
    assert.equal(
      manifest.version,
      buildInfo.PLUGIN_VERSION,
      'package.json and lib/build-info.js carry different versions',
    )
  })

  it('registers the browser module under the package name', () => {
    // The host resolves the browser module by the package name. A different
    // id means the browser half is never loaded.
    const manifest = readPackageJson()
    const source = readFileSync(join(root, 'client', 'index.js'), 'utf8')
    const match = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(source)
    assert.ok(match, 'the browser entry registers itself through the module loader')
    assert.equal(match[1], manifest.name, 'the browser module is registered under another name')
  })

  it('loads the package under the package name', () => {
    // The host resolves the row of the loader patch by its name. Another
    // name means the host loads a package that is not this one.
    const manifest = readPackageJson()
    const source = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    const match = /^\s*name:\s*'([^']+)'/m.exec(source)
    assert.ok(match, 'the loader patch names the package it loads')
    assert.equal(match[1], manifest.name, 'the loader patch loads another package')
  })

  it('gives the loader row the id of the settings namespace', async () => {
    // The row id is the namespace the host writes the settings into. The
    // client half reads the same namespace, so the two must be one string.
    const manifest = readPackageJson()
    const source = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    const match = /^\s*-\s+id:\s*(\S+)\s*$/m.exec(source)
    assert.ok(match, 'the loader patch names the row')
    const { PLUGIN_SETTINGS_NAMESPACE } = await import('../lib/i18n/index.js')
    assert.equal(match[1], PLUGIN_SETTINGS_NAMESPACE, 'the row id is another namespace')
    assert.equal(match[1], manifest.name, 'the row id is another name')
  })

  it('stays below the size ceiling', () => {
    // Two megabytes. Crossing the line usually means that sources or tests
    // are published again, not that the plugin grew.
    const pack = requirePackManifest()
    assert.ok(
      pack.size < 2 * 1024 * 1024,
      `the packed archive is ${(pack.size / 1024 / 1024).toFixed(2)} MB`,
    )
    assert.ok(
      pack.unpackedSize < 2 * 1024 * 1024,
      `the unpacked archive is ${(pack.unpackedSize / 1024 / 1024).toFixed(2)} MB`,
    )
  })

  it('names the package manager version once', () => {
    // Two sources of the package manager version mean two different
    // behaviours on the machine and in the pipeline, and the difference
    // only shows up when the pipeline turns red.
    const manifest = readPackageJson()
    assert.match(
      String(manifest.packageManager ?? ''),
      /^pnpm@\d+\.\d+\.\d+(?:\+.*)?$/,
      'the package manager version is missing or is not a full version',
    )
  })

  it('lets the workflows read the package manager version', { skip }, () => {
    // action-setup reads the version from package.json when the step does
    // not carry one. A version in the step is a second source.
    for (const name of workflowFiles) {
      const lines = readFileSync(join(workflowDirectory, name), 'utf8').split('\n')
      const starts = lines
        .map((line, index) => (/uses:\s*pnpm\/action-setup/.test(line) ? index : -1))
        .filter((index) => index >= 0)
      for (const start of starts) {
        const indent = lines[start].match(/^\s*/)[0].length
        const pinned = []
        for (let index = start + 1; index < lines.length; index += 1) {
          const line = lines[index]
          if (line.trim() === '') continue
          const lineIndent = line.match(/^\s*/)[0].length
          // The step ends where the next step of the same level begins.
          if (lineIndent <= indent && /^\s*-\s/.test(line)) break
          if (line.trim().startsWith('#')) continue
          if (/^\s*version:/.test(line)) pinned.push(line.trim())
        }
        assert.deepEqual(
          pinned,
          [],
          `${name} pins the package manager version itself: ${pinned.join(', ')}`,
        )
      }
    }
  })

  it('writes the package manager version in one file only', () => {
    // Every other place that names a version is a second source of truth.
    const pattern = new RegExp(['pnpm', '@'].join('') + '\\d')
    const hits = []
    for (const file of repositoryFiles()) {
      const relativePath = relative(root, file).replace(/\\/g, '/')
      if (relativePath === 'package.json') continue
      if (relativePath === 'pnpm-lock.yaml') continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          hits.push(`${relativePath}:${index + 1}: ${line.trim().slice(0, 80)}`)
        }
      })
    }
    assert.deepEqual(
      hits,
      [],
      `the package manager version is written in ${hits.length} other place(s): ${hits.join(' | ')}`,
    )
  })
})
