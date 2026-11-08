// Which vendors accept the redirect URI the plugin uses by default?
//
// A vendor may refuse a redirect URI whose path is not the one it expects.
// This script asks every vendor that offers dynamic client registration.
//
// The request carries a throwaway client name; a vendor that refuses the
// redirect URI creates nothing.

import { KNOWN_PROFILES } from '../lib/profiles/known-profiles.js'
import { PLUGIN_VERSION } from '../lib/build-info.js'

const REDIRECT = process.argv[2] ?? 'http://127.0.0.1:39271/oauth-mcp/callback'

let refused = 0
let failed = 0

for (const profile of KNOWN_PROFILES) {
  if (!profile.registrationEndpoint) continue
  const body = {
    client_name: 'dsh-oauth-mcp',
    redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    software_id: 'dsh-oauth-mcp',
    software_version: PLUGIN_VERSION,
  }
  try {
    const response = await fetch(profile.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let answer
    try {
      answer = JSON.parse(text)
    } catch {
      answer = undefined
    }
    if (response.ok && answer?.client_id) {
      process.stdout.write(`ACCEPTED  ${profile.id.padEnd(16)} ${REDIRECT}\n`)
    } else {
      refused += 1
      process.stdout.write(
        `REFUSED   ${profile.id.padEnd(16)} ${response.status} ${text.slice(0, 120)}\n`,
      )
    }
  } catch (error) {
    failed += 1
    process.stdout.write(`ERROR     ${profile.id.padEnd(16)} ${String(error?.message ?? error)}\n`)
  }
}

// A vendor that refuses the redirect URI is a finding, not a result.
if (refused > 0 || failed > 0) process.exitCode = 1
