import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { MockFailure, mockApi, setupE2e } from './support/mock-api'

await setupE2e()

// Browser-only fixture: enable the public setting before hydration. The existing HTTP server's
// guard is tested separately against real Better Auth handlers in human-check.test.ts (server).
// Stub only the external widget SDK; this is not evidence of a real Cloudflare challenge/token.
const sdk = `
let sequence = 0;
const widgets = new Map();
window.turnstile = {
  render(element, options) {
    const id = String(++sequence);
    const done = document.createElement('button');
    done.textContent = 'Complete test check';
    done.onclick = () => options.callback('test-browser-token-' + id);
    const expire = document.createElement('button');
    expire.textContent = 'Expire test check';
    expire.onclick = () => options['expired-callback']();
    element.append(done, expire);
    widgets.set(id, element);
    return id;
  },
  remove(id) { widgets.get(id)?.replaceChildren(); widgets.delete(id); }
};`

async function signInPage(failFirstScript = false) {
  const page = await createPage()
  const tokens: string[] = []
  const api = await mockApi(page, {
    'POST /auth/sign-in/email': ({ headers }) => {
      tokens.push(headers['x-captcha-response']!)
      throw new MockFailure(401, 'INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.')
    },
  })
  await page.route(url('/sign-in'), async (route) => {
    const response = await route.fetch()
    const html = await response.text()
    const configure = '<script>window.__NUXT__.config.public.humanCheck={enabled:true,siteKey:"browser-test-sitekey"}</script>'
    await route.fulfill({ response, body: html.replace('</body>', `${configure}</body>`) })
  })
  let scripts = 0
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async (route) => {
    if (failFirstScript && scripts++ === 0) return route.abort()
    await route.fulfill({ contentType: 'application/javascript', body: sdk })
  })
  await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
  await page.getByLabel('Email', { exact: true }).fill('dara@example.com')
  await page.getByLabel('Password', { exact: true }).fill('a long test password')
  return { page, tokens, api }
}

describe('on-demand account browser check', () => {
  it('Cancel preserves input and sends nothing; every retry after a refused sign-in uses a fresh token', async () => {
    const { page, tokens, api } = await signInPage()
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('dialog', { name: 'Browser check' }).waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    expect(tokens).toEqual([])
    expect(api.calls).not.toContain('POST /auth/sign-in/email')
    expect(await page.getByLabel('Email', { exact: true }).inputValue()).toBe('dara@example.com')
    expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe('a long test password')
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByRole('button', { name: 'Complete test check' }).click()
      await page.getByText('Wrong email or password.', { exact: true }).waitFor()
      await expect.poll(() => tokens.length).toBe(attempt + 1)
    }
    expect(new Set(tokens).size).toBe(2)
    expect(tokens.every(Boolean)).toBe(true)
  })

  it('a blocked script and an expired challenge can be retried without sending an auth request', async () => {
    const { page, tokens } = await signInPage(true)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Couldn\'t complete the browser check', { exact: true }).waitFor()
    expect(tokens).toEqual([])
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await page.getByRole('button', { name: 'Expire test check' }).click()
    await page.getByText('Couldn\'t complete the browser check', { exact: true }).waitFor()
    expect(tokens).toEqual([])
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await page.getByRole('button', { name: 'Complete test check' }).click()
    await expect.poll(() => tokens.length).toBe(1)
  })
})
