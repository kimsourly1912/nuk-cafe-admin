import { expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import gateway from '../../scripts/assistant-preview/gateway.mjs'

it('fails closed without a credential, after expiry and for incorrect credentials, including assets', async () => {
  const APP = { fetch: () => {
    throw new Error('Must not forward')
  } }
  const request = new Request('https://preview.test/_nuxt/app.js', { headers: { authorization: 'Basic bad' } })
  for (const env of [{ APP }, { APP, PREVIEW_AUTHORIZATION: 'Basic bad', PREVIEW_EXPIRES_AT: 'invalid' }, { APP, PREVIEW_AUTHORIZATION: 'Basic bad', PREVIEW_EXPIRES_AT: '1' }, { APP, PREVIEW_AUTHORIZATION: 'Basic correct', PREVIEW_EXPIRES_AT: String(Date.now() + 60_000) }]) {
    expect((await gateway.fetch(request, env)).status).toBe(401)
  }
})

it('forwards the real request/cookie but removes gateway credentials', async () => {
  const headers = { authorization: 'Basic correct', cookie: 'session=synthetic' }
  let forwarded: Request | undefined
  const env = { PREVIEW_AUTHORIZATION: headers.authorization, PREVIEW_EXPIRES_AT: String(Date.now() + 60_000), APP: { fetch: (request: Request) => {
    forwarded = request
    return new Response('app')
  } } }
  // Node and Workers both implement the Web Crypto API used by the gateway.
  expect(webcrypto.subtle).toBeDefined()
  expect(await (await gateway.fetch(new Request('https://preview.test/api/action', { method: 'POST', headers, body: 'content' }), env)).text()).toBe('app')
  expect(forwarded?.headers.get('authorization')).toBeNull()
  expect(forwarded?.headers.get('cookie')).toBe('session=synthetic')
  expect(await forwarded?.text()).toBe('content')
})
