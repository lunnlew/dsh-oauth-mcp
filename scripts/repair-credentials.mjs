/**
 * Repair the credential keys of an earlier build of this plugin.
 *
 * An earlier build wrote its OAuth grants under `oauth-mcp:<id>`. The host
 * addresses every record as `<scope>/<id>` and refuses to read a document
 * whose keys break that grammar, so such a document takes the whole desktop
 * host down before this plugin is ever loaded:
 *
 * ```text
 * DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate
 * Failed plugins (1):
 *   credentials
 *     TypeError: credential key "oauth-mcp:notion" must be "<scope>/<id>"
 * ```
 *
 * The plugin cannot repair that file itself — the host is already dead when
 * the plugin would run. This script does it instead: it rewrites the legacy
 * keys into the shape the host accepts and leaves everything else — the
 * secrets, the payloads, the comments — byte for byte as it was.
 *
 * Usage:
 *   node scripts/repair-credentials.mjs [--file <path>] [--dry-run]
 *
 * The credentials file defaults to `$DSH_HOME/.credentials.yaml`, which is
 * `~/.dsh/.credentials.yaml` unless `DSH_HOME` says otherwise. The script
 * writes a backup next to the file before it changes anything.
 *
 * @module dsh-oauth-mcp/scripts/repair-credentials
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { migrateCredentialDocument } from '../lib/store/credential-migration.js'

/**
 * The credentials file of the current home.
 *
 * @returns {string} The path of the credentials document.
 */
function defaultCredentialsPath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, '.credentials.yaml')
}

/**
 * Read the command line arguments.
 *
 * @param {string[]} argv The arguments.
 * @returns {{ file: string, dryRun: boolean }} The parsed options.
 */
function parseArguments(argv) {
  let file = defaultCredentialsPath()
  let dryRun = false
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--file') {
      const value = argv[index + 1]
      if (!value) throw new Error('--file needs a path.')
      file = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument "${argument}".`)
  }
  return { file, dryRun }
}

const { file, dryRun } = parseArguments(process.argv.slice(2))

if (!existsSync(file)) {
  process.stderr.write(`There is no credentials file at "${file}".\n`)
  process.exit(1)
}

const original = readFileSync(file, 'utf8')
const result = migrateCredentialDocument(original)

if (result.migrated.length === 0) {
  process.stdout.write(`"${file}" carries no legacy credential key; nothing to repair.\n`)
  if (result.untouched.length > 0) {
    process.stdout.write(
      `Keys that are not ours and were left alone: ${result.untouched.join(', ')}\n`,
    )
  }
  process.exit(0)
}

for (const change of result.migrated) {
  process.stdout.write(`${change.from} -> ${change.to}\n`)
}

if (dryRun) {
  process.stdout.write('Dry run: the file was not changed.\n')
  process.exit(0)
}

const backup = `${file}.bak-repair`
copyFileSync(file, backup)
writeFileSync(file, result.text, 'utf8')
process.stdout.write(`Repaired "${file}". The old file is kept as "${backup}".\n`)
