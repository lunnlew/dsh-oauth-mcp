import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderErrorPage, renderSuccessPage } from '../../lib/callback/pages.js'

/**
 * Extract the inner markup of one element of a rendered page.
 *
 * @param {string} html The rendered page.
 * @param {string} tag The tag of the element.
 * @param {string} className A class of the element.
 * @returns {string} The inner markup, empty when there is no such element.
 */
function element(html, tag, className) {
  const pattern = new RegExp(`<${tag} class="[^"]*\\b${className}\\b[^"]*">([\\s\\S]*?)</${tag}>`)
  const match = pattern.exec(html)
  return match ? match[1] : ''
}

test('the success page carries the headline of the resolved language', () => {
  const english = renderSuccessPage()
  const chinese = renderSuccessPage({ locale: 'zh-CN' })

  assert.ok(english.includes('<title>Authorization complete</title>'))
  assert.ok(english.includes('<h1>Authorization complete</h1>'))
  assert.ok(chinese.includes('<title>授权成功</title>'))
  assert.ok(chinese.includes('<h1>授权成功</h1>'))
})

test('the success page is written in one language only', () => {
  const english = renderSuccessPage({ serverLabel: 'Notion' })
  const chinese = renderSuccessPage({ serverLabel: 'Notion', locale: 'zh' })

  assert.equal(english.includes('授权成功'), false, 'the english page carries no chinese')
  assert.equal(chinese.includes('Authorization complete'), false, 'the chinese page carries no english')
})

test('the success page explains that the server is connected', () => {
  const english = renderSuccessPage()
  const chinese = renderSuccessPage({ locale: 'zh' })

  assert.ok(english.includes('The server is connected and its tools are ready to use.'))
  assert.ok(chinese.includes('这台服务器已经连上，它的工具可以直接使用了。'))
})

test('the success page names the authorized server', () => {
  const english = renderSuccessPage({ serverLabel: 'Notion MCP (Beta)' })
  const chinese = renderSuccessPage({ serverLabel: 'Notion MCP (Beta)', locale: 'zh' })

  assert.ok(english.includes('Authorized: Notion MCP (Beta)'))
  assert.ok(chinese.includes('已授权：Notion MCP (Beta)'))
})

test('the success page hides the server line without a label', () => {
  assert.equal(renderSuccessPage().includes('Authorized:'), false)
  assert.equal(renderSuccessPage({ serverLabel: '   ' }).includes('Authorized:'), false)
  assert.equal(renderSuccessPage({ locale: 'zh' }).includes('已授权：'), false)
  assert.equal(renderSuccessPage({ serverLabel: '   ', locale: 'zh' }).includes('已授权：'), false)
})

test('the success page shows the server id when one is given', () => {
  const english = renderSuccessPage({ serverId: 'notion' })
  const chinese = renderSuccessPage({ serverId: 'notion', locale: 'zh' })

  assert.ok(english.includes('Server id:'))
  assert.ok(english.includes('notion'))
  assert.ok(chinese.includes('服务器 ID：'))
  assert.ok(chinese.includes('notion'))
})

test('the success page lists the granted scopes', () => {
  const english = renderSuccessPage({ scopes: ['read:notes', 'write:notes'] })
  const chinese = renderSuccessPage({ scopes: ['read:notes', 'write:notes'], locale: 'zh' })

  assert.ok(english.includes('Granted scopes'))
  assert.ok(english.includes('<li class="mono">read:notes</li>'))
  assert.ok(chinese.includes('已授权的权限范围'))
  assert.ok(chinese.includes('<li class="mono">write:notes</li>'))
})

test('the success page drops empty and duplicate scopes', () => {
  const page = renderSuccessPage({ scopes: ['read:notes', '  ', 'read:notes', 42] })

  assert.equal(page.includes('Granted scopes'), true)
  assert.equal(page.includes('<li class="mono">read:notes</li>'), true)
  assert.equal(page.match(/<li class="mono">/g).length, 1)
})

test('the success page omits the scope list without scopes', () => {
  assert.equal(renderSuccessPage({ scopes: [] }).includes('Granted scopes'), false)
  assert.equal(renderSuccessPage({}).includes('Granted scopes'), false)
  assert.equal(renderSuccessPage({ scopes: [], locale: 'zh' }).includes('已授权的权限范围'), false)
})

test('the success page tells the user to close the tab', () => {
  const english = renderSuccessPage()
  const chinese = renderSuccessPage({ locale: 'zh' })

  assert.ok(english.includes('You can close this tab and return to DSH.'))
  assert.ok(chinese.includes('可以关掉这个标签页，回到 DSH 继续。'))
})

test('the success page carries no code, no token and no state', () => {
  const page = renderSuccessPage({
    serverLabel: 'Notion MCP (Beta)',
    serverId: 'notion',
    scopes: ['read:notes'],
  }).toLowerCase()

  assert.equal(page.includes('code'), false)
  assert.equal(page.includes('token'), false)
  assert.equal(page.includes('state'), false)
  assert.equal(page.includes('client_secret'), false)
})

test('the success page escapes markup in the server label', () => {
  const page = renderSuccessPage({ serverLabel: '<img src=x onerror=alert(1)>' })

  assert.equal(page.includes('<img'), false)
  assert.ok(page.includes('&lt;img'))
})

test('the success page is a standalone document', () => {
  const page = renderSuccessPage()

  assert.ok(page.includes('<!doctype html>'))
  assert.ok(page.includes('<html lang="en">'))
  assert.ok(page.includes('<meta charset="utf-8">'))
  assert.ok(page.includes('<style>'))
  assert.ok(page.includes('color-scheme: light dark'))
  assert.ok(page.includes('prefers-color-scheme: dark'))
  assert.equal(page.includes('http://'), false)
  assert.equal(page.includes('https://'), false)
})

test('the success page names the language of the document', () => {
  assert.ok(renderSuccessPage({ locale: 'zh-CN' }).includes('<html lang="zh-CN">'))
  assert.ok(renderSuccessPage({ locale: 'zh' }).includes('<html lang="zh-CN">'))
  assert.ok(renderSuccessPage({ locale: 'en-US' }).includes('<html lang="en">'))
})

test('the error page carries the headline of the resolved language', () => {
  const english = renderErrorPage('invalid_request', 'the request was incomplete')
  const chinese = renderErrorPage('invalid_request', 'the request was incomplete', { locale: 'zh' })

  assert.ok(english.includes('<title>Authorization failed</title>'))
  assert.ok(english.includes('<h1>Authorization failed</h1>'))
  assert.ok(chinese.includes('<title>授权失败</title>'))
  assert.ok(chinese.includes('<h1>授权失败</h1>'))
})

test('the error page shows the error code and the description', () => {
  const page = renderErrorPage('invalid_request', 'the request was incomplete')

  assert.ok(page.includes('<code'))
  assert.ok(page.includes('invalid_request'))
  assert.ok(page.includes('the request was incomplete'))
})

test('the error page escapes the description', () => {
  const page = renderErrorPage('invalid_request', '<b>bold</b>')

  assert.equal(page.includes('<b>bold</b>'), false)
  assert.ok(page.includes('&lt;b&gt;bold&lt;/b&gt;'))
})

test('the error page truncates a long description', () => {
  const page = renderErrorPage('invalid_request', 'a'.repeat(500))
  const detail = element(page, 'p', 'detail')

  assert.ok(detail.includes('…'))
  assert.ok(detail.length <= 200)
  assert.equal(page.includes('a'.repeat(201)), false)
})

test('the error page redacts a bearer credential', () => {
  const page = renderErrorPage('invalid_request', 'failed with Bearer super-secret-value')

  assert.equal(page.includes('super-secret-value'), false)
  assert.ok(page.includes('[REDACTED]'))
})

test('the error page redacts an access token', () => {
  const page = renderErrorPage('invalid_request', 'access_token=super-secret-value')

  assert.equal(page.includes('super-secret-value'), false)
  assert.ok(page.includes('[REDACTED]'))
})

test('the error page redacts an authorization code and a state', () => {
  const page = renderErrorPage('invalid_request', '?code=super-secret-value&state=other-secret-value')

  assert.equal(page.includes('super-secret-value'), false)
  assert.equal(page.includes('other-secret-value'), false)
  assert.ok(page.includes('[REDACTED]'))
})

test('the error page redacts a client secret', () => {
  const page = renderErrorPage('invalid_request', 'client_secret=super-secret-value')

  assert.equal(page.includes('super-secret-value'), false)
  assert.ok(page.includes('[REDACTED]'))
})

test('the error page redacts a token in the json shape', () => {
  const page = renderErrorPage('invalid_request', '{"access_token": "super-secret-value"}')

  assert.equal(page.includes('super-secret-value'), false)
  assert.ok(page.includes('[REDACTED]'))
})

test('the error page advises the user to retry after a denial', () => {
  const english = renderErrorPage('access_denied', 'the user said no')
  const chinese = renderErrorPage('access_denied', 'the user said no', { locale: 'zh' })

  assert.ok(english.includes('You declined this authorization; start it again whenever you are ready.'))
  assert.ok(english.includes('Next:'))
  assert.ok(chinese.includes('你拒绝了这次授权，重新发起一次即可。'))
  assert.ok(chinese.includes('下一步：'))
})

test('the error page explains an expired or replaced request', () => {
  const page = renderErrorPage('state_invalid', 'the state did not match', { locale: 'zh' })

  assert.ok(page.includes('这次授权请求已经过期或被别的请求覆盖了，请重新发起授权。'))
})

test('the error page explains an incomplete request', () => {
  const page = renderErrorPage('invalid_request', 'missing parameter', { locale: 'zh' })

  assert.ok(page.includes('请求参数不完整或被截断，请重新发起授权。'))
})

test('the error page explains an unsupported response type', () => {
  const page = renderErrorPage('unsupported_response_type', 'only code is supported', { locale: 'zh' })

  assert.ok(page.includes('授权服务器不支持这种授权方式，请更换服务器或联系厂商。'))
})

test('the error page explains a temporarily unavailable server', () => {
  const serverError = renderErrorPage('server_error', 'the server is busy', { locale: 'zh' })
  const unavailable = renderErrorPage('temporarily_unavailable', 'the server is busy', { locale: 'zh' })

  assert.ok(serverError.includes('授权服务器暂时不可用，稍后重试。'))
  assert.ok(unavailable.includes('授权服务器暂时不可用，稍后重试。'))
})

test('the error page explains an invalid client', () => {
  const page = renderErrorPage('invalid_client', 'unknown client', { locale: 'zh' })

  assert.ok(page.includes('客户端凭据无效，请检查 client id / client secret 配置。'))
})

test('the error page gives generic advice for an unknown code', () => {
  const english = renderErrorPage('something_else_happened', 'no idea')
  const chinese = renderErrorPage('something_else_happened', 'no idea', { locale: 'zh' })

  assert.ok(english.includes('Return to DSH and start the authorization again'))
  assert.ok(english.includes('Next: Return to DSH'))
  assert.ok(chinese.includes('返回 DSH 重新发起一次授权；如果反复失败，请查看插件日志。'))
})

test('the error page looks up the advice case-insensitively', () => {
  const page = renderErrorPage('ACCESS_DENIED', 'the user said no', { locale: 'zh' })

  assert.ok(page.includes('你拒绝了这次授权，重新发起一次即可。'))
})

test('the error page names the server when a label is given', () => {
  const english = renderErrorPage('access_denied', 'the user said no', { serverLabel: 'Notion MCP (Beta)' })
  const chinese = renderErrorPage('access_denied', 'the user said no', {
    serverLabel: 'Notion MCP (Beta)',
    locale: 'zh',
  })

  assert.ok(english.includes('Server: Notion MCP (Beta)'))
  assert.ok(chinese.includes('服务器：Notion MCP (Beta)'))
})

test('the error page escapes markup in the server label', () => {
  const page = renderErrorPage('access_denied', 'no', { serverLabel: '<b>x</b>' })

  assert.equal(page.includes('<b>x</b>'), false)
  assert.ok(page.includes('&lt;b&gt;x&lt;/b&gt;'))
})

test('the error page survives a missing code and description', () => {
  const page = renderErrorPage()

  assert.ok(page.includes('Authorization failed'))
  assert.ok(page.includes('authorization_failed'))
  assert.ok(page.includes('Next:'))
})

test('the error page tells the user to close the tab', () => {
  const english = renderErrorPage('access_denied', 'the user said no')
  const chinese = renderErrorPage('access_denied', 'the user said no', { locale: 'zh' })

  assert.ok(english.includes('You can close this tab and return to DSH.'))
  assert.ok(chinese.includes('可以关掉这个标签页，回到 DSH 继续。'))
})
