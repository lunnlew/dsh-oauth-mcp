/**
 * Dynamic client registration (RFC 7591).
 *
 * When the user did not configure a client identifier, the plugin registers
 * itself with the authorization server. The answer may carry a client secret;
 * that secret is returned to the caller, which stores it in the host
 * credential record, and never in plugin config.
 *
 * @module dsh-oauth-mcp/oauth/registration
 */

import {
  CLIENT_NAME,
  SOFTWARE_ID,
  SOFTWARE_VERSION,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  formatScope,
} from './types.js'
import { RegistrationError, RegistrationUnsupportedError } from './errors.js'
import { redactUrl } from '../util/redact.js'

/**
 * Read a numeric field of a registration answer.
 *
 * @param {unknown} value The raw value.
 * @returns {number | undefined} The number, when the value carries one.
 */
function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Register this plugin as an OAuth client.
 *
 * @param {object} options Registration options.
 * @param {object} options.metadata The authorization-server metadata.
 * @param {string[]} options.redirectUris The redirect URIs to register.
 * @param {string} [options.clientName] The client name to register.
 * @param {string[]} [options.scopes] The scopes to request.
 * @param {object} options.http The HTTP client.
 * @param {AbortSignal} [options.signal] Abort signal.
 * @param {string} [options.softwareId] Software identifier to register.
 * @param {string} [options.softwareVersion] Software version to register.
 * @returns {Promise<{ clientId: string, clientSecret?: string, clientIdIssuedAt?: number, clientSecretExpiresAt?: number, registrationAccessToken?: string, registrationClientUri?: string }>} The registered client.
 * @throws {RegistrationUnsupportedError} When the server publishes no registration endpoint.
 * @throws {RegistrationError} When the registration was refused or answered without a client identifier.
 */
export async function registerClient({
  metadata,
  redirectUris,
  clientName,
  scopes,
  http,
  signal,
  softwareId,
  softwareVersion,
} = {}) {
  if (!http || typeof http.postJson !== 'function') {
    throw new TypeError('registerClient requires an HTTP client.')
  }
  const endpoint = typeof metadata?.registration_endpoint === 'string' ? metadata.registration_endpoint : ''
  if (endpoint.length === 0) {
    throw new RegistrationUnsupportedError(
      'The authorization server does not support dynamic client registration.',
    )
  }
  const scope = formatScope(scopes)
  const body = {
    client_name: typeof clientName === 'string' && clientName.length > 0 ? clientName : CLIENT_NAME,
    redirect_uris: Array.isArray(redirectUris) ? redirectUris.filter((uri) => typeof uri === 'string') : [],
    grant_types: [...SUPPORTED_GRANT_TYPES],
    response_types: [...SUPPORTED_RESPONSE_TYPES],
    token_endpoint_auth_method: 'none',
    ...(scope.length > 0 ? { scope } : {}),
    software_id: typeof softwareId === 'string' && softwareId.length > 0 ? softwareId : SOFTWARE_ID,
    software_version:
      typeof softwareVersion === 'string' && softwareVersion.length > 0 ? softwareVersion : SOFTWARE_VERSION,
  }
  let answer
  try {
    answer = await http.postJson(endpoint, body, { signal })
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : undefined
    const detail = typeof error?.detail === 'string' && error.detail.length > 0 ? error.detail : undefined
    throw new RegistrationError(
      `Dynamic client registration failed at ${redactUrl(endpoint)}.`,
      { status, detail, cause: error },
    )
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new RegistrationError(
      `Dynamic client registration at ${redactUrl(endpoint)} returned an unusable answer.`,
    )
  }
  const clientId = typeof answer.client_id === 'string' ? answer.client_id : ''
  if (clientId.length === 0) {
    throw new RegistrationError(
      `Dynamic client registration at ${redactUrl(endpoint)} returned no client_id.`,
    )
  }
  const clientSecret = typeof answer.client_secret === 'string' && answer.client_secret.length > 0
    ? answer.client_secret
    : undefined
  const clientIdIssuedAt = toNumber(answer.client_id_issued_at)
  const clientSecretExpiresAt = toNumber(answer.client_secret_expires_at)
  const registrationAccessToken =
    typeof answer.registration_access_token === 'string' && answer.registration_access_token.length > 0
      ? answer.registration_access_token
      : undefined
  const registrationClientUri =
    typeof answer.registration_client_uri === 'string' && answer.registration_client_uri.length > 0
      ? answer.registration_client_uri
      : undefined
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    ...(clientIdIssuedAt === undefined ? {} : { clientIdIssuedAt }),
    ...(clientSecretExpiresAt === undefined ? {} : { clientSecretExpiresAt }),
    ...(registrationAccessToken ? { registrationAccessToken } : {}),
    ...(registrationClientUri ? { registrationClientUri } : {}),
  }
}
