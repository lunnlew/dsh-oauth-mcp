/**
 * Re-verify the vendor table against the live metadata.
 *
 * The table in `lib/profiles/known-profiles.js` holds what the vendors
 * published on the day it was written. This script reads the same three
 * places a vendor publishes and reports where the table and the vendor no
 * longer agree.
 *
 * The three places, none of which needs an account or a token:
 *
 * 1. the MCP endpoint itself, which answers 401 with a `WWW-Authenticate`
 *    header naming the protected-resource metadata;
 * 2. the protected-resource metadata of RFC 9728, in the plain and the
 *    path-suffixed form;
 * 3. the authorization-server metadata of RFC 8414 (or OpenID Connect) of every
 *    issuer the resource metadata names, again in both forms.
 *
 * Usage:
 *
 *   node scripts/probe-vendors.mjs                 verify the table
 *   node scripts/probe-vendors.mjs <file.json>     probe a list of endpoints
 *
 * The JSON file holds an array of endpoints, or of `{ "endpoint": "..." }`.
 *
 * @module dsh-oauth-mcp/scripts/probe-vendors
 */

import { readFileSync } from 'node:fs'

import { KNOWN_PROFILES } from '../lib/profiles/known-profiles.js'
import { canonicalResource } from '../lib/oauth/resource.js'

/** How long a single request may take. */
const TIMEOUT_MS = 10_000

/**
 * Read one URL.
 *
 * A failed request is retried once: a single timeout must not look like a
 * vendor that stopped publishing its metadata.
 *
 * @param {string} url The URL.
 * @param {string} [method] The HTTP method.
 * @returns {Promise<object>} The status, the headers, the body and the parsed JSON.
 */
async function read(url, method = 'GET') {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await readOnce(url, method)
    if (result.status !== 0 && result.status < 500) return result
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return readOnce(url, method)
}

/**
 * Read one URL, once.
 *
 * @param {string} url The URL.
 * @param {string} [method] The HTTP method.
 * @returns {Promise<object>} The status, the headers, the body and the parsed JSON.
 */
async function readOnce(url, method = 'GET') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json, text/event-stream',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body:
        method === 'POST'
          ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
          : undefined,
      signal: controller.signal,
      redirect: 'manual',
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: response.status, headers: response.headers, text, json }
  } catch (error) {
    return { status: 0, error: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Follow redirects and return the last answer.
 *
 * @param {string} url The URL.
 * @returns {Promise<object>} The answer of the last hop.
 */
async function follow(url) {
  let current = url
  for (let hop = 0; hop < 3; hop += 1) {
    const result = await read(current)
    const location = result.headers?.get?.('location')
    if (result.status >= 300 && result.status < 400 && location) {
      current = new URL(location, current).toString()
      continue
    }
    return { ...result, finalUrl: current }
  }
  return { status: 0, finalUrl: current }
}

/**
 * Read the parameters of a `WWW-Authenticate` header.
 *
 * @param {string | undefined} value The header value.
 * @returns {object} The parameters, by name.
 */
function challengeParameters(value) {
  const out = {}
  if (!value) return out
  const scheme = value.split(/\s+/)[0] ?? ''
  out.scheme = scheme
  for (const part of value.slice(scheme.length).split(/,\s*/)) {
    const [key, ...rest] = part.split('=')
    if (key) out[key.trim()] = rest.join('=').replace(/^"|"$/g, '')
  }
  return out
}

/**
 * The well-known documents of one issuer.
 *
 * @param {string} issuer The issuer URL.
 * @returns {string[]} The URLs to try, in order.
 */
function issuerDocuments(issuer) {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/+$/, '')
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/oauth-authorization-server`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}/.well-known/openid-configuration`,
  ]
}

/**
 * The well-known documents of one resource.
 *
 * @param {string} endpoint The MCP endpoint.
 * @returns {string[]} The URLs to try, in order.
 */
function resourceDocuments(endpoint) {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  return [
    `${url.origin}/.well-known/oauth-protected-resource${path}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
  ]
}

/**
 * Probe one endpoint.
 *
 * @param {string} endpoint The MCP endpoint.
 * @param {string} [fallbackIssuer] The issuer to try when the endpoint
 *   publishes no protected-resource metadata.
 * @returns {Promise<object>} What the endpoint and its issuers publish.
 */
async function probe(endpoint, fallbackIssuer) {
  const direct = await follow(endpoint)
  const posted = await read(endpoint, 'POST')
  const challenge = challengeParameters(
    posted.headers?.get?.('www-authenticate') ?? direct.headers?.get?.('www-authenticate'),
  )

  const result = {
    endpoint,
    status: posted.status || direct.status,
    unauthorized: posted.status === 401 || direct.status === 401,
    challenge,
    resource: undefined,
    resources: [],
    scopesSupported: undefined,
    authorizationServers: undefined,
    registrationEndpoint: undefined,
    registrationEndpoints: [],
    pkce: undefined,
  }

  // A vendor may publish several protected-resource documents with different
  // resource identifiers, so every document is read and the table is compared
  // against the set.
  const documents = []
  for (const candidate of [...resourceDocuments(endpoint), challenge.resource_metadata].filter(Boolean)) {
    const answer = await read(candidate)
    if (answer.json?.authorization_servers) documents.push({ url: candidate, doc: answer.json })
  }

  const issuers = [...new Set(documents.flatMap((entry) => entry.doc.authorization_servers))]
  if (fallbackIssuer && issuers.length === 0) issuers.push(fallbackIssuer)

  result.resources = documents.map((entry) => entry.doc.resource).filter(Boolean)
  result.scopesSupported = documents.find((entry) => entry.doc.scopes_supported?.length)?.doc
    .scopes_supported
  result.authorizationServers = issuers.length > 0 ? issuers : undefined

  for (const issuer of issuers) {
    for (const candidate of issuerDocuments(issuer)) {
      const answer = await read(candidate)
      if (answer.status === 200 && answer.json?.token_endpoint) {
        // A vendor may publish several issuers; each of them may offer its own
        // registration endpoint.
        if (answer.json.registration_endpoint) {
          result.registrationEndpoints.push(answer.json.registration_endpoint)
        }
        result.pkce = answer.json.code_challenge_methods_supported
        // Some vendors publish the scope list in the authorization-server
        // metadata rather than in the protected-resource metadata.
        if (!result.scopesSupported?.length && answer.json.scopes_supported) {
          result.scopesSupported = answer.json.scopes_supported
        }
        break
      }
    }
  }
  result.registrationEndpoint = result.registrationEndpoints[0]
  return result
}

/**
 * Compare what the vendor publishes with what the table says.
 *
 * @param {object} profile One entry of the table.
 * @param {object} found What the probe found.
 * @returns {string[]} The differences, one per line.
 */
function differences(profile, found) {
  const problems = []
  if (!found.resources.length && !found.registrationEndpoints.length) {
    problems.push('the vendor publishes no OAuth metadata any more')
    return problems
  }
  if (profile.resource && found.resources.length > 0) {
    const live = found.resources.map((value) => canonicalResource(value))
    if (!live.includes(canonicalResource(profile.resource))) {
      problems.push(`resource: table ${profile.resource} / live ${found.resources.join(', ')}`)
    }
  }
  // A vendor may publish several issuers; the table names one of them.
  const issuers = found.authorizationServers ?? []
  if (
    profile.authorizationServerUrl &&
    issuers.length > 0 &&
    !issuers.includes(profile.authorizationServerUrl)
  ) {
    problems.push(`issuer: table ${profile.authorizationServerUrl} / live ${issuers.join(', ')}`)
  }
  if (
    profile.registrationEndpoint !== undefined &&
    !found.registrationEndpoints.includes(profile.registrationEndpoint)
  ) {
    problems.push(
      `registration: table ${profile.registrationEndpoint} / live ${found.registrationEndpoints.join(', ') || 'none'}`,
    )
  }
  if (found.registrationEndpoints.length === 0 && profile.registrationEndpoint !== undefined) {
    problems.push('the vendor no longer publishes a registration endpoint')
  }
  if (found.scopesSupported?.length) {
    const live = new Set(found.scopesSupported)
    for (const scope of profile.defaultScopes ?? []) {
      if (!live.has(scope)) problems.push(`the default scope ${scope} is no longer published`)
    }
  }
  return problems
}

const candidateFile = process.argv[2]
if (candidateFile) {
  const candidates = JSON.parse(readFileSync(candidateFile, 'utf8').replace(/^﻿/, ''))
  const endpoints = candidates.map((entry) => (typeof entry === 'string' ? entry : entry.endpoint))
  for (const endpoint of endpoints) {
    const found = await probe(endpoint)
    if (!found.unauthorized && !found.resources.length) {
      process.stdout.write(`SKIP ${endpoint} (status ${found.status})\n`)
      continue
    }
    process.stdout.write(
      `OK   ${endpoint}\n     resources=${JSON.stringify(found.resources)}\n     scopes=${JSON.stringify(found.scopesSupported ?? [])}\n     issuers=${JSON.stringify(found.authorizationServers ?? [])}\n     registration=${found.registrationEndpoint ?? '-'}\n     pkce=${JSON.stringify(found.pkce ?? [])}\n`,
    )
  }
} else {
  let drifted = 0
  for (const profile of KNOWN_PROFILES) {
    const found = await probe(profile.endpoint, profile.authorizationServerUrl)
    const problems = differences(profile, found)
    if (problems.length === 0) {
      process.stdout.write(`OK   ${profile.id}\n`)
      continue
    }
    drifted += 1
    process.stdout.write(`DRIFT ${profile.id}\n`)
    for (const problem of problems) process.stdout.write(`       ${problem}\n`)
  }
  process.stdout.write(`\n${KNOWN_PROFILES.length} vendors checked, ${drifted} drifted\n`)
  // A probe that cannot fail is not a probe.
  if (drifted > 0) process.exitCode = 1
}
