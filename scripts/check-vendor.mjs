// Walk the whole authorization path of one vendor with the plugin's own code.
//
// This is the check that the plugin would really authorize the vendor: it
// discovers the metadata, registers a client, builds the authorization request
// and confirms that the callback receiver answers on the path the vendor
// redirects the browser to.

import { createHttpClient } from '../lib/http/client.js'
import { startLoopbackServer } from '../lib/callback/loopback-server.js'
import { discoverProtectedResource, discoverAuthorizationServer } from '../lib/oauth/discovery.js'
import { registerClient } from '../lib/oauth/registration.js'
import { buildAuthorizeRequest } from '../lib/oauth/authorize-request.js'
import { createPkce, createState } from '../lib/oauth/pkce.js'
import { matchProfileByEndpoint, redirectUriForProfile, requiredCallbackPaths } from '../lib/profiles/known-profiles.js'

const endpoint = process.argv[2] ?? 'https://mcp.feishu.cn/mcp'
const http = createHttpClient()

const profile = matchProfileByEndpoint(endpoint)
if (!profile) throw new Error(`no profile for ${endpoint}`)

const receiver = await startLoopbackServer({
  port: 0,
  path: '/oauth-mcp/callback',
  paths: requiredCallbackPaths('/oauth-mcp/callback'),
  onRequest({ respond }) {
    respond({ status: 200, body: '<p>ok</p>' })
  },
})

try {
  const base = receiver.url
  const redirectUri = redirectUriForProfile(base, profile)
  console.log('vendor       :', profile.id)
  console.log('redirect uri :', redirectUri)

  const resource = await discoverProtectedResource(profile.endpoint, { http })
  console.log('prm          :', resource.metadataUrl)

  const server = await discoverAuthorizationServer(profile.authorizationServerUrl, { http })
  console.log('as metadata  :', server.metadataUrl)

  const client = await registerClient({
    metadata: server.metadata,
    redirectUris: [redirectUri],
    clientName: 'dsh-oauth-mcp',
    scopes: profile.defaultScopes,
    http,
  })
  console.log('registered   :', client.clientId)

  const pkce = createPkce()
  const state = createState()
  const request = buildAuthorizeRequest({
    authorizationEndpoint: server.metadata.authorization_endpoint,
    clientId: client.clientId,
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: 'S256',
    scopes: profile.defaultScopes,
    resource: profile.resource,
  })
  const url = new URL(request.url ?? request)
  console.log('authorize url:', url.toString().slice(0, 120), '…')
  console.log('redirect_uri :', url.searchParams.get('redirect_uri'))
  console.log('scope        :', url.searchParams.get('scope')?.slice(0, 80), '…')

  const answered = await fetch(`${redirectUri}?code=abc&state=xyz`)
  console.log('callback     :', answered.status, '(the receiver answers on the path of the vendor)')
} finally {
  await receiver.close()
}
