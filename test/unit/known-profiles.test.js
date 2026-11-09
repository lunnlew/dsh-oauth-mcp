/**
 * Tests of the advisory table of known OAuth-enabled MCP vendors.
 *
 * @module dsh-oauth-mcp/test/unit/known-profiles
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWN_PROFILES,
  PUBLIC_SUFFIXES,
  deriveServerId,
  findProfile,
  redirectUriForProfile,
  requiredCallbackPaths,
} from '../../lib/profiles/known-profiles.js'

test('the table lists at least one known vendor', () => {
  assert.ok(Array.isArray(KNOWN_PROFILES))
  assert.ok(KNOWN_PROFILES.length > 0)
})

test('every profile carries the documented fields', () => {
  for (const profile of KNOWN_PROFILES) {
    assert.match(profile.id, /^[a-z0-9][a-z0-9_-]*$/, `bad id: ${profile.id}`)
    assert.equal(typeof profile.label, 'string')
    assert.ok(profile.label.trim().length > 0, `missing label: ${profile.id}`)
    assert.ok(Array.isArray(profile.defaultScopes), `missing defaultScopes: ${profile.id}`)
    for (const scope of profile.defaultScopes) {
      assert.equal(typeof scope, 'string')
      assert.ok(scope.trim().length > 0, `empty scope in ${profile.id}`)
    }
    assert.equal(typeof profile.notes, 'string')
    assert.ok(profile.notes.trim().length > 0, `missing notes: ${profile.id}`)
    assert.equal(typeof profile.note, 'string')
    assert.ok(profile.note.trim().length > 0, `missing chinese note: ${profile.id}`)
  }
})

test('a note talks about one vendor only', () => {
  // A note that carries the note of another vendor means one of the two was
  // lost: the reader of the table then reads two remarks in one cell. Two
  // vendors may of course carry the same remark.
  for (const profile of KNOWN_PROFILES) {
    for (const other of KNOWN_PROFILES) {
      if (other.id === profile.id) continue
      if (other.note.length < 20) continue
      if (profile.note === other.note) continue
      assert.ok(
        !profile.note.endsWith(other.note),
        `the note of ${profile.id} carries the note of ${other.id}`,
      )
    }
  }
})

test('the profile identifiers are unique', () => {
  const ids = KNOWN_PROFILES.map((profile) => profile.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('an authorization server url is either absent or a real https url', () => {
  for (const profile of KNOWN_PROFILES) {
    if (profile.authorizationServerUrl === undefined) continue
    assert.equal(typeof profile.authorizationServerUrl, 'string')
    const url = new URL(profile.authorizationServerUrl)
    assert.equal(url.protocol, 'https:', `not https: ${profile.authorizationServerUrl}`)
    assert.ok(url.hostname.length > 0)
  }
})

test('no profile carries a secret', () => {
  for (const profile of KNOWN_PROFILES) {
    // `tokenEndpointAuthMethods` holds published method names such as
    // "client_secret_basic" — a method name is documentation, not a secret.
    const { tokenEndpointAuthMethods, ...rest } = profile
    const serialized = JSON.stringify(rest)
    assert.ok(
      !/"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]+"/.test(serialized),
      `${profile.id} carries a secret value`,
    )
    assert.ok(!/Bearer\s/.test(serialized), `${profile.id} carries an authorization header`)
    assert.ok(!/\b(ghp_|sk-|xox[bpsa]-|eyJ)/.test(serialized), `${profile.id} carries a token`)
  }
})

test('findProfile returns the entry of a known identifier', () => {
  const profile = findProfile('atlassian')
  assert.ok(profile)
  assert.equal(profile.id, 'atlassian')
  assert.equal(findProfile('ATLASSIAN'), profile)
  assert.equal(findProfile('  atlassian  '), profile)
})

test('findProfile returns undefined for an unknown identifier', () => {
  assert.equal(findProfile('does-not-exist'), undefined)
  assert.equal(findProfile(''), undefined)
  assert.equal(findProfile(undefined), undefined)
  assert.equal(findProfile(null), undefined)
  assert.equal(findProfile(42), undefined)
})

test('every profile carries the measured endpoint, verification date and notes', () => {
  for (const profile of KNOWN_PROFILES) {
    assert.equal(typeof profile.endpoint, 'string', `missing endpoint: ${profile.id}`)
    const endpoint = new URL(profile.endpoint)
    assert.equal(endpoint.protocol, 'https:', `not https: ${profile.endpoint}`)
    assert.match(profile.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `bad verifiedOn: ${profile.id}`)
  }
})

test('the endpoints are unique per vendor', () => {
  const endpoints = KNOWN_PROFILES.map((profile) => profile.endpoint)
  assert.equal(new Set(endpoints).size, endpoints.length)
})

test('a published registration endpoint is an https url that comes with an issuer', () => {
  for (const profile of KNOWN_PROFILES) {
    if (profile.registrationEndpoint === undefined) continue
    const registration = new URL(profile.registrationEndpoint)
    assert.equal(registration.protocol, 'https:', `not https: ${profile.registrationEndpoint}`)
    assert.ok(profile.authorizationServerUrl, `no issuer for ${profile.id}`)
  }
})

test('a vendor that needs a hand-made client has no registration endpoint', () => {
  for (const profile of KNOWN_PROFILES) {
    if (!profile.requiresClientId) continue
    assert.equal(
      profile.registrationEndpoint,
      undefined,
      `${profile.id} needs a client id but publishes a registration endpoint`,
    )
  }
})

test('the requested scopes are part of the published scopes', () => {
  for (const profile of KNOWN_PROFILES) {
    // A vendor that publishes no scope list leaves the choice to its
    // authorization server, so the plugin asks for nothing.
    if (!profile.scopesSupported || profile.scopesSupported.length === 0) continue
    const published = new Set(profile.scopesSupported)
    for (const scope of profile.defaultScopes) {
      assert.ok(published.has(scope), `${scope} is not published by ${profile.id}`)
    }
    assert.ok(profile.defaultScopes.length > 0, `${profile.id} publishes scopes but requests none`)
  }
})

test('the table covers the vendors that were probed', () => {
  assert.ok(KNOWN_PROFILES.length >= 10, 'the table should cover the probed vendors')
  for (const id of [
    'notion',
    'linear',
    'atlassian',
    'sentry',
    'figma',
    'github',
    'stripe',
    'datadog',
    'cloudflare',
    'vercel',
    'grafana',
    'newrelic',
    'canva',
    'intercom',
    'context7',
    'pagerduty',
    'zendesk',
    'todoist',
  ]) {
    assert.ok(findProfile(id), `missing profile: ${id}`)
  }
})

test('the measured facts of the tricky vendors are recorded', () => {
  const atlassian = findProfile('atlassian')
  assert.equal(atlassian.authorizationServerUrl, 'https://mcp.atlassian.com')
  assert.equal(atlassian.resource, undefined, 'Atlassian publishes no protected resource metadata')
  assert.equal(atlassian.registrationEndpoint, 'https://mcp.atlassian.com/v1/register')

  const notion = findProfile('notion')
  assert.equal(notion.registrationEndpoint, 'https://mcp.notion.com/register')
  assert.deepEqual([...notion.defaultScopes], ['default'])

  const github = findProfile('github')
  assert.equal(github.requiresClientId, true)
  assert.equal(github.registrationEndpoint, undefined)
  assert.equal(github.authorizationServerUrl, 'https://github.com/login/oauth')

  const zendesk = findProfile('zendesk')
  assert.equal(zendesk.requiresClientId, true)
  assert.equal(zendesk.registrationEndpoint, undefined)
})

test('a vendor that demands a path of its own changes the redirect URI', () => {
  const feishu = findProfile('feishu')
  assert.equal(feishu.callbackPath, '/callback')
  assert.equal(
    redirectUriForProfile('http://127.0.0.1:39271/oauth-mcp/callback', feishu),
    'http://127.0.0.1:39271/callback',
    'the path of the vendor replaces the configured one',
  )
  assert.equal(
    redirectUriForProfile('http://127.0.0.1:39271/oauth-mcp/callback', findProfile('notion')),
    'http://127.0.0.1:39271/oauth-mcp/callback',
    'a vendor without a requirement keeps the configured path',
  )
  assert.equal(
    redirectUriForProfile('', feishu),
    '',
    'no callback URI stays no callback URI',
  )
})

test('the callback receiver serves the paths the vendors demand', () => {
  const paths = requiredCallbackPaths('/oauth-mcp/callback')
  assert.ok(paths.includes('/oauth-mcp/callback'), 'the configured path is served')
  assert.ok(paths.includes('/callback'), 'the path of Feishu is served')
  for (const profile of KNOWN_PROFILES) {
    if (!profile.callbackPath) continue
    assert.ok(
      paths.includes(profile.callbackPath),
      `${profile.id} has its path served`,
    )
  }
})

test('the identifier of a known endpoint is the identifier of the vendor', () => {  for (const profile of KNOWN_PROFILES) {
    assert.equal(
      deriveServerId(profile.endpoint),
      profile.id,
      `${profile.id} keeps its identifier`,
    )
  }
})

test('the identifier of an unknown endpoint comes from the host', () => {
  // The leading `mcp.` is dropped, the public suffix is dropped when the list
  // knows it and a suffix it does not know stays part of the name.
  assert.equal(deriveServerId('https://example.org/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.example.com/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.mycompany.internal/mcp'), 'mycompany-internal')
  assert.equal(deriveServerId('https://mcp.example.com.cn/mcp'), 'example')
  assert.equal(deriveServerId('https://mcp.mycompany.example.com/mcp'), 'mycompany-example')
  assert.equal(deriveServerId('https://unknown.example.org/mcp'), 'unknown-example')
  assert.equal(deriveServerId(''), '')
  assert.equal(deriveServerId('not a url'), '')
})

test('the list of public suffixes is a short list of common ones', () => {
  for (const suffix of ['com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'ai', 'app']) {
    assert.ok(PUBLIC_SUFFIXES.includes(suffix), `${suffix} is a known suffix`)
  }
  for (const suffix of ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn']) {
    assert.ok(PUBLIC_SUFFIXES.includes(suffix), `${suffix} is a known suffix`)
  }
  assert.ok(!PUBLIC_SUFFIXES.includes('internal'), 'a private domain keeps its last label')
  assert.ok(PUBLIC_SUFFIXES.length < 60, 'the list stays short enough to be read')
})
