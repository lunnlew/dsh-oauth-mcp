// Check every vendor of the table with the plugin's own discovery code.
//
// This answers the question that matters: would the plugin be able to
// authorize this vendor right now?

import { createHttpClient } from '../lib/http/client.js'
import {
  discoverAuthorizationServer,
  discoverProtectedResource,
  extractAuthorizationServerUrl,
} from '../lib/oauth/discovery.js'
import { KNOWN_PROFILES } from '../lib/profiles/known-profiles.js'

const http = createHttpClient()
let failed = 0

for (const profile of KNOWN_PROFILES) {
  const notes = []
  try {
    let issuer = profile.authorizationServerUrl
    let resource = '-'
    try {
      const found = await discoverProtectedResource(profile.endpoint, { http })
      resource = found.metadataUrl.replace(/^https?:\/\//, '')
      issuer = issuer ?? extractAuthorizationServerUrl(found.metadata)
    } catch (error) {
      // A vendor that publishes no protected-resource metadata still names its
      // authorization server in the table of the plugin.
      if (!profile.authorizationServerUrl) throw error
      notes.push('prm=none')
    }
    const server = await discoverAuthorizationServer(issuer, { http })
    if (resource !== '-') notes.push(`prm=${resource}`)
    notes.push(`as=${server.metadataUrl.replace(/^https?:\/\//, '')}`)
    notes.push(`reg=${server.metadata.registration_endpoint ?? 'none'}`)
    notes.push(`pkce=${(server.metadata.code_challenge_methods_supported ?? []).join('/')}`)
    process.stdout.write(`OK   ${profile.id.padEnd(16)} ${notes.join('  ')}\n`)
  } catch (error) {
    // The edge of a vendor may block an address that probes too often; a
    // second attempt tells a block apart from a real change.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const server = await discoverAuthorizationServer(
        profile.authorizationServerUrl ?? profile.endpoint,
        { http },
      )
      process.stdout.write(
        `OK   ${profile.id.padEnd(16)} (second attempt) as=${server.metadataUrl.replace(/^https?:\/\//, '')}\n`,
      )
    } catch {
      failed += 1
      process.stdout.write(`FAIL ${profile.id.padEnd(16)} ${error.message}\n`)
    }
  }
}

process.stdout.write(`\n${KNOWN_PROFILES.length} vendors checked, ${failed} failed\n`)
// A check that cannot fail is not a check.
if (failed > 0) process.exitCode = 1
