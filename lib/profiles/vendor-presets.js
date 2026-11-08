/**
 * The client facing projection of the known vendor profiles.
 *
 * The panel offers a picker of well-known vendors. The table of those vendors
 * lives in `lib/profiles/known-profiles.js`; this module turns a server
 * profile into the shape the panel needs and is the only place that knows how
 * the two are related.
 *
 * The browser entry cannot read a host module, so
 * `scripts/build-vendor-presets.mjs` renders this table into `client/panel.js`
 * and into the deployed copy `client/index.js`. The module therefore stays
 * free of browser APIs and of node built-ins: it is the source of a file that
 * runs in the browser.
 *
 * @module dsh-oauth-mcp/profiles/vendor-presets
 */

import { KNOWN_PROFILES } from './known-profiles.js'

/**
 * Turn one server profile into the preset the panel offers.
 *
 * The published scopes are the ones the vendor documents, not the smaller list
 * the plugin asks for by default: the panel offers every scope the vendor
 * supports and ticks the default ones.
 *
 * @param {object} profile One entry of `KNOWN_PROFILES`.
 * @returns {object} The preset of the panel.
 */
export function projectVendorPreset(profile) {
  const preset = {
    id: profile.id,
    label: profile.label,
    endpoint: profile.endpoint,
  }
  // A vendor without a published authorization server has no field for it, so
  // the panel leaves that field empty.
  if (profile.authorizationServerUrl) preset.authorizationServerUrl = profile.authorizationServerUrl
  const scopes = Array.isArray(profile.scopesSupported)
    ? profile.scopesSupported
    : Array.isArray(profile.defaultScopes)
      ? profile.defaultScopes
      : []
  const defaultScopes = Array.isArray(profile.defaultScopes) ? profile.defaultScopes : []
  preset.scopes = Object.freeze([...scopes])
  preset.defaultScopes = Object.freeze([...defaultScopes])
  preset.needsClientId = profile.requiresClientId === true
  return preset
}

/**
 * The vendor presets the panel offers in its picker.
 *
 * @type {ReadonlyArray<object>}
 */
export const VENDOR_PRESETS = Object.freeze(KNOWN_PROFILES.map(projectVendorPreset))
