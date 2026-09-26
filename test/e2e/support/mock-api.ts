import type { Page, Route } from 'playwright-core'
import { getBrowser, setup, url, waitForHydration } from '@nuxt/test-utils/e2e'
import { afterEach, expect, inject } from 'vitest'

/** Requests no handler answered, across every `mockApi` of the current test. */
const unhandled: string[] = []

/**
 * Call at the top of every e2e file: a browser against the app served by `global-setup.ts`.
 * Each test then fails if the app made an API request that no handler answers (see `mockApi`).
 */
export function setupE2e() {
  afterEach(() => {
    const missing = unhandled.splice(0)
    expect(missing, 'API requests without a mock handler (add them to the test explicitly)').toEqual([])
  })
  return setup({
    host: inject('e2eHost'),
    browser: true,
    browserOptions: { type: 'chromium', launch: { channel: 'chrome' } },
  })
}

/**
 * Mocks the backend in the browser. Every `/api/**` request is answered from `handlers`
 * (key: `'GET /staff/categories'`, path without the `/api` prefix and query; numeric segments
 * can be written `{id}`) wrapped in the backend envelope. Throw `MockFailure` (or a `failures.*`
 * preset) for `success: false` or an HTTP error.
 *
 * **Unknown endpoints fail visibly:** HTTP 501 with an error envelope, and the test fails in
 * `afterEach`. A silent `success: true, data: null` used to hide missing handlers.
 *
 * The pattern uses the full origin: a pattern starting with a wildcard would also match the
 * Vite chunk `/_nuxt/generated/api/...` in dev and break the app.
 */
export type MockHandler = (request: { url: URL, body: unknown }) => unknown | Promise<unknown>

export interface MockApi {
  /** Every request seen, as `'METHOD /path'`. */
  calls: string[]
  /** Requests no handler answered (they also fail the test). */
  unhandled: string[]
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

/** Backend failures seen on the dev API (codes in app/utils/api-error.ts → API_ERROR_CODES). */
export const failures = {
  /** HTTP 200 + NC0001: shown to the user as the reason. */
  validation: (reason = 'Required fields are missing') => new MockFailure('NC0001', reason),
  /** HTTP 200 + NC0011. */
  notFound: (reason = 'Category not found') => new MockFailure('NC0011', reason),
  /** HTTP 200 + NC0000: technical, the user sees a generic message. */
  technical: () => new MockFailure('NC0000', 'No static resource staff/categories.'),
  /** HTTP 401 + NC1000: triggers a token refresh. */
  unauthorized: () => new MockFailure('NC1000', 'Unauthorized', 401),
}

/**
 * A response held back until the test lets it go: for "while saving…" / out-of-order scenarios.
 * Each call to `handler` waits; `release` answers the oldest waiting call.
 *
 * @example
 * const save = deferred()
 * await mockApi(page, { 'PUT /staff/categories/{id}': save.handler })
 * … await save.started() … save.release({ id: 1 }) / save.fail(failures.validation())
 */
export function deferred() {
  const waiting: { resolve: (data: unknown) => void, reject: (error: unknown) => void }[] = []
  let notify: (() => void) | undefined
  let calls = 0
  return {
    handler: (() => new Promise((resolve, reject) => {
      calls++
      waiting.push({ resolve, reject })
      notify?.()
    })) as MockHandler,
    /** Resolves once at least `count` calls are waiting or were answered. */
    started: (count = 1) => new Promise<void>((resolve) => {
      const check = () => {
        if (calls >= count) resolve()
        else notify = check
      }
      check()
    }),
    release: (data: unknown = null) => waiting.shift()?.resolve(data),
    fail: (failure: MockFailure) => waiting.shift()?.reject(failure),
    get calls() {
      return calls
    },
  }
}

/**
 * A list endpoint that searches and paginates like the backend (0-based `page`, `size`).
 * Pass a function to let the rows change during the test (e.g. after deletes).
 */
export function paginatedHandler<T extends Record<string, unknown>>(rows: T[] | (() => T[]), searchField: keyof T = 'categoryName'): MockHandler {
  return ({ url }) => {
    const all = typeof rows === 'function' ? rows() : rows
    const search = url.searchParams.get('search')?.toLowerCase()
    const page = Number(url.searchParams.get('page') ?? 0)
    const size = Number(url.searchParams.get('size') ?? 20)
    const matching = search ? all.filter(r => String(r[searchField]).toLowerCase().includes(search)) : all
    const totalPages = Math.max(1, Math.ceil(matching.length / size))
    return {
      content: matching.slice(page * size, (page + 1) * size),
      totalElements: matching.length,
      totalPages,
      currentPage: page,
      pageSize: size,
      hasNext: page < totalPages - 1,
      hasPrevious: page > 0,
    }
  }
}

export async function mockApi(page: Page, handlers: Record<string, MockHandler> = {}): Promise<MockApi> {
  const active = { ...DEFAULT_HANDLERS, ...handlers }
  const calls: string[] = []
  const missing: string[] = []
  const origin = new URL(url('/')).origin

  await page.route(`${origin}/api/**`, async (route: Route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname.replace(/^\/api/, '')
    const key = `${request.method()} ${path}`
    calls.push(key)
    // 'DELETE /staff/categories/1' also matches a 'DELETE /staff/categories/{id}' handler.
    const handler = active[key] ?? active[key.replace(/\/\d+(?=\/|$)/g, '/{id}')]
    if (!handler) {
      missing.push(key)
      unhandled.push(key)
      await route.fulfill({ status: 501, json: { success: false, msg: 'UNMOCKED', reason: `No mock for ${key}` } }).catch(() => {})
      return
    }
    try {
      const data = await handler({ url: requestUrl, body: request.postDataJSON() })
      await route.fulfill({ status: 200, json: { success: true, msg: 'OK', data } })
    }
    catch (error) {
      if (!(error instanceof MockFailure)) throw error
      await route.fulfill({ status: error.status, json: { success: false, msg: error.msg, reason: error.reason } })
    }
  })

  return { calls, unhandled: missing, set: next => Object.assign(active, next) }
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
