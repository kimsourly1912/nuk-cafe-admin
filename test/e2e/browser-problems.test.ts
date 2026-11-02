import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { allowBrowserProblems, browserProblems } from './support/browser-problems'
import { setupE2e } from './support/mock-api'

await setupE2e()

// The check every e2e test gets (D251, support/browser-problems.ts): what the browser reported that
// no assertion looks at. These tests read it directly; each closes its page before the end, so the
// problems it causes on purpose don't fail it in the shared check.

const origin = new URL(inject('e2eHost')).origin

describe('browser problems (D251)', () => {
  it('reports console errors, hydration messages, uncaught errors, our 5xx and failed requests; not 4xx, aborts or plain warnings', async () => {
    const page = await createPage()
    await page.route(`${origin}/api/test/500`, route => route.fulfill({ status: 500, json: {} }))
    await page.route(`${origin}/api/test/404`, route => route.fulfill({ status: 404, json: {} }))
    await page.route(`${origin}/api/test/fail`, route => route.abort('failed'))
    await page.route(`${origin}/api/test/slow`, route => new Promise(resolve => setTimeout(resolve, 2000)).then(() => route.fulfill({ json: {} })).catch(() => {}))
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })

    const uncaught = page.waitForEvent('pageerror')
    await page.evaluate(async () => {
      console.error('boom from the test')
      console.warn('[Vue warn]: Hydration text content mismatch on <p>')
      console.warn('only a warning')
      setTimeout(() => {
        throw new Error('uncaught from the test')
      })
      await fetch('/api/test/500')
      await fetch('/api/test/404')
      await fetch('/api/test/fail').catch(() => {})
      const controller = new AbortController()
      const slow = fetch('/api/test/slow', { signal: controller.signal }).catch(() => {})
      controller.abort()
      await slow
    })
    await uncaught

    const problems = await browserProblems(page, origin)
    await page.close()
    expect(problems).toEqual([
      expect.stringMatching(/^console\.error: boom from the test/),
      expect.stringMatching(/^console\.warning: \[Vue warn\]: Hydration text content mismatch/),
      'pageerror: uncaught from the test',
      'GET /api/test/500 → 500',
      'request failed: GET /api/test/fail (net::ERR_FAILED)',
    ])
  })

  it('names the element of a real hydration mismatch on a server-rendered page (the e2e build keeps Vue\'s details)', async () => {
    const page = await createPage()
    // The server's HTML with one extra element at the root: the browser's render can't match it.
    await page.route(url('/sign-in'), async (route) => {
      const response = await route.fetch()
      const html = await response.text()
      expect(html).toContain('<div id="__nuxt">')
      await route.fulfill({ response, body: html.replace('<div id="__nuxt">', '<div id="__nuxt"><span>not rendered by the app</span>') })
    })
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })

    const problems = await browserProblems(page, origin)
    await page.close()
    // Vue's detailed warning, kept by `debug.hydration` in the e2e build (nuxt.config.ts)…
    expect(problems).toContainEqual(expect.stringMatching(/^console\.warning: \[Vue warn\]: Hydration \w+ mismatch/))
    // …and the one line a production build logs.
    expect(problems).toContainEqual(expect.stringMatching(/^console\.error: Hydration completed but contains mismatches\./))
  })

  it('lets a test allow the problems it causes on purpose', async () => {
    const page = await createPage()
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
    allowBrowserProblems(/expected by the test/)
    // The page stays open: the shared check reads it after the test and must find nothing unexpected.
    await page.evaluate(() => console.error('expected by the test'))
    expect(await browserProblems(page, origin)).toContainEqual(expect.stringMatching(/^console\.error: expected by the test/))
  })
})
