import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { ClientErrorReport } from '#shared/contracts/client-errors'
import { mockApi, setupE2e } from './support/mock-api'

// The reliability pack (D149): a new build deployed while a tab is open, and browser errors reported
// to the server. The counter's parts (the screen kept on, the tab's count, the queue's last update)
// are in counter.test.ts. Cases: docs/reference/app-behavior.md.
await setupE2e()

const origin = new URL(url('/')).origin

/**
 * What Nuxt does when its check finds a newer deployed build (`app:manifest:update`). The check
 * itself (every 5 minutes, `checkOutdatedBuildInterval`) is compiled out of a test build
 * (`import.meta.test`), so the tests call the hook as the check would.
 */
function newBuildDeployed(page: Page) {
  return page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { $nuxt: { hooks: { callHook: (name: string, meta: unknown) => Promise<void> } } } }).__vue_app__
    return app.$nuxt.hooks.callHook('app:manifest:update', { id: 'a-newer-build', timestamp: Date.now() })
  })
}

async function adminWithNewBuild() {
  const page = await createPage()
  await mockApi(page)
  await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
  await newBuildDeployed(page)
  return page
}

/** A mark on `window` that a full page load clears and an in-app route change keeps. */
const mark = (page: Page) => page.evaluate(() => {
  (window as { e2eMark?: boolean }).e2eMark = true
})
const marked = (page: Page) => page.evaluate(() => Boolean((window as { e2eMark?: boolean }).e2eMark))

describe('a new version deployed while the tab is open', () => {
  it('offers Reload, which loads the page again', async () => {
    const page = await adminWithNewBuild()
    const banner = page.getByRole('status').filter({ hasText: 'A new version of the app is ready' })
    await banner.waitFor({ timeout: 8000 })
    await mark(page)
    await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: 'Reload' }).click()])
    await page.waitForLoadState('domcontentloaded')
    expect(await marked(page)).toBe(false)
    expect(new URL(page.url()).pathname).toBe('/c/nuk/admin')
  })

  it('Later hides it; the next move to another page is a full page load at that page', async () => {
    const page = await adminWithNewBuild()
    const banner = page.getByText('A new version of the app is ready')
    await banner.waitFor({ timeout: 8000 })
    await page.getByRole('button', { name: 'Later' }).click()
    await banner.waitFor({ state: 'hidden' })
    await mark(page)
    await Promise.all([page.waitForEvent('load'), page.getByRole('link', { name: 'Categories' }).first().click()])
    await page.waitForURL(address => address.pathname === '/c/nuk/admin/categories')
    expect(await marked(page)).toBe(false)
  })

  it('the customer site says nothing (a visit is short; the next page loads the new build)', async () => {
    const page = await createPage()
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    await newBuildDeployed(page)
    await page.waitForTimeout(300)
    expect(await page.getByText('A new version of the app is ready').count()).toBe(0)
  })

  it('without a new build, moving between pages stays in the app', async () => {
    const page = await createPage()
    await mockApi(page)
    await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
    await mark(page)
    await page.getByRole('link', { name: 'Categories' }).first().click()
    await page.waitForURL(address => address.pathname === '/c/nuk/admin/categories')
    expect(await marked(page)).toBe(true)
  })
})

describe('browser errors reported to the server', () => {
  async function adminRecordingReports() {
    const reports: ClientErrorReport[] = []
    const page = await createPage()
    await mockApi(page, { 'POST /client-errors': ({ body }) => void reports.push(body as ClientErrorReport) })
    await page.goto(url('/c/nuk/admin?q=private'), { waitUntil: 'hydration' })
    return { page, reports }
  }

  it('an error thrown outside Vue: its message and stack, the page without its query, the build', async () => {
    const { page, reports } = await adminRecordingReports()
    await page.evaluate(() => setTimeout(() => {
      throw new Error('boom from a timer')
    }))
    await expect.poll(() => reports.length).toBe(1)
    expect(reports[0]).toMatchObject({ kind: 'error', message: 'Error: boom from a timer', page: '/c/nuk/admin' })
    expect(reports[0]!.stack).toContain('boom from a timer')
    expect(reports[0]!.build).toBeTruthy()
  })

  it('an unhandled rejection; the same error twice is sent once', async () => {
    const { page, reports } = await adminRecordingReports()
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) setTimeout(() => void Promise.reject(new TypeError('a promise nobody caught')))
    })
    await expect.poll(() => reports.length).toBe(1)
    await page.waitForTimeout(300)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ kind: 'rejection', message: 'TypeError: a promise nobody caught' })
  })

  it('the server takes a report from this site only, and checks it', async () => {
    const report = { kind: 'error', message: 'Error: boom', page: '/c/nuk', build: 'b' }
    const post = (body: unknown, headers: Record<string, string> = { origin }) =>
      fetch(url('/api/client-errors'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    expect((await post(report)).status).toBe(204)
    expect((await post(report, { origin: 'https://elsewhere.example' })).status).toBe(403)
    expect((await post({ ...report, kind: 'other' })).status).toBe(400)
    expect((await post({ ...report, message: 'x'.repeat(1001) })).status).toBe(400)
  })
})
