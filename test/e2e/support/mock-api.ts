import type { Page, Route } from 'playwright-core'
import { getBrowser, setup, url, waitForHydration } from '@nuxt/test-utils/e2e'
import { inject } from 'vitest'

/** Call at the top of every e2e file: a browser against the app served by `global-setup.ts`. */
export function setupE2e() {
  return setup({
    host: inject('e2eHost'),
    browser: true,
    browserOptions: { type: 'chromium', launch: { channel: 'chrome' } },
  })
}

/**
 * Mocks the backend in the browser. Every `/api/**` request is answered from `handlers`
 * (key: `'GET /staff/categories'`, path without the `/api` prefix and query; numeric segments
 * can be written `{id}`) wrapped in the backend envelope. Unknown endpoints answer
 * `{ success: true, data: null }`. Throw `MockFailure` for `success: false` or an HTTP error.
 *
 * The pattern uses the full origin: a pattern starting with a wildcard would also match the
 * Vite chunk `/_nuxt/generated/api/...` in dev and break the app.
 */
export type MockHandler = (request: { url: URL, body: unknown }) => unknown | Promise<unknown>

export interface MockApi {
  /** Every request seen, as `'METHOD /path'`. */
  calls: string[]
  /** Replace or add handlers mid-test. */
  set: (handlers: Record<string, MockHandler>) => void
}

export const TEA = { id: 1, categoryName: 'Tea', status: 'ACTIVE', type: 'MAIN' }
export const COFFEE = { id: 2, categoryName: 'Coffee', status: 'ACTIVE', type: 'MAIN' }

export function pageOf<T>(content: T[], page = 0, pageSize = 20) {
  const totalPages = Math.max(1, Math.ceil(content.length / pageSize))
  return { content, totalElements: content.length, totalPages, currentPage: page, pageSize, hasNext: page < totalPages - 1, hasPrevious: page > 0 }
}

/** A logged-in admin with two categories. */
export const DEFAULT_HANDLERS: Record<string, MockHandler> = {
  'GET /staff/auth/session': () => ({ staffId: 1, username: 'admin', groups: ['ADMIN'] }),
  'POST /staff/auth/logout': () => null,
  'GET /staff/categories': () => pageOf([TEA, COFFEE]),
  'GET /staff/categories/all': () => [TEA, COFFEE],
  'POST /staff/categories': () => ({ ...TEA, id: 3 }),
}

/** Throw this from a handler to answer `success: false`. */
export class MockFailure {
  constructor(public msg: string, public reason: string, public status = 200) {}
}

export async function mockApi(page: Page, handlers: Record<string, MockHandler> = {}): Promise<MockApi> {
  const active = { ...DEFAULT_HANDLERS, ...handlers }
  const calls: string[] = []
  const origin = new URL(url('/')).origin

  await page.route(`${origin}/api/**`, async (route: Route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname.replace(/^\/api/, '')
    const key = `${request.method()} ${path}`
    calls.push(key)
    // 'DELETE /staff/categories/1' also matches a 'DELETE /staff/categories/{id}' handler.
    const handler = active[key] ?? active[key.replace(/\/\d+(?=\/|$)/g, '/{id}')]
    try {
      const data = handler ? await handler({ url: requestUrl, body: request.postDataJSON() }) : null
      await route.fulfill({ status: 200, json: { success: true, msg: 'OK', data } })
    }
    catch (error) {
      if (!(error instanceof MockFailure)) throw error
      await route.fulfill({ status: error.status, json: { success: false, msg: error.msg, reason: error.reason } })
    }
  })

  return { calls, set: next => Object.assign(active, next) }
}

/**
 * Whether the page would show the browser's "Leave site?" dialog. Headless Chrome never shows
 * it, so dispatch a cancelable `beforeunload` and check whether a listener prevented it.
 */
export function beforeUnloadPrevented(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
}

/** Open the app at `/` and reach `path` through the sidebar, so back/forward stay in-app (SPA history). */
export async function gotoViaSidebar(page: Page, links: (string | RegExp)[]) {
  await page.goto(url('/'), { waitUntil: 'hydration' })
  for (const name of links) {
    await page.getByRole('link', { name }).first().click()
    await page.waitForLoadState('networkidle')
  }
}

/**
 * A toast by its title. Nuxt UI also renders a hidden `aria-live` copy of each toast's text,
 * so a plain `getByText` matches twice.
 */
export function toast(page: Page, title: string | RegExp) {
  return page.locator('[data-slot="title"]', { hasText: title })
}

/** Tabs of one browser window: pages in one context share `BroadcastChannel`. */
export async function openTabs(count: number) {
  const context = await (await getBrowser()).newContext()
  return Promise.all(Array.from({ length: count }, () => context.newPage()))
}

/** `goto` for pages from `openTabs` (they lack test-utils' `waitUntil: 'hydration'` wrapper). */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(url(path))
  await waitForHydration(page, url(path), 'hydration')
}
