import type { BrowserContext, Page, Route } from 'playwright-core'
import { getBrowser, setup, url, waitForHydration } from '@nuxt/test-utils/e2e'
import { afterEach, expect, inject } from 'vitest'
import type { Page as ApiPage } from '../../../shared/contracts/common'
import type { AdminSession } from '../../../shared/contracts/identity'
import type { MenuCategory } from '../../../shared/contracts/menu-categories'
import type { MenuItem, MenuItemSummary } from '../../../shared/contracts/menu-items'
import type { BranchOption, StaffMember } from '../../../shared/contracts/staff'

/** Requests no handler answered, across every `mockApi` of the current test. */
const unhandled: string[] = []

/** Browser contexts opened by `openTabs` in the current test; closed after it so they don't pile up. */
const contexts: BrowserContext[] = []

/**
 * Call at the top of every e2e file: a browser against the app served by `global-setup.ts`.
 * Each test then fails if the app made an API request that no handler answers (see `mockApi`).
 */
export function setupE2e() {
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(context => context.close().catch(() => {})))
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
 * Mocks the server in the browser: every `/api/**` request is answered from `handlers`. Keys are
 * `'METHOD /path'` without query:
 * - our API without its `/api` prefix: `'GET /admin/menu/categories'`;
 * - Better Auth as `/auth/...`: `'POST /auth/sign-in/email'`.
 * A segment containing a digit can be written `{id}` (`'PATCH /admin/menu/categories/{id}'`).
 *
 * A handler's return value is the JSON body (HTTP 200). Throw `MockFailure` (or a `failures.*`
 * preset) for an error response in the API's format.
 *
 * **Unknown endpoints fail visibly:** HTTP 501, and the test fails in `afterEach`.
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

// --- Fixtures ---

const STAMP = '2026-09-26T00:00:00.000Z'

export const ADMIN: AdminSession = {
  userId: 'user-1',
  email: 'admin@nukcafe.test',
  name: 'alice',
  role: 'admin',
  permissions: ['menu:read', 'menu:write', 'media:upload', 'branch:read', 'staff:read', 'staff:create', 'staff:update', 'staff:disable'],
  mustChangePassword: false,
}

/** A category of the new menu API (`/api/admin/menu/categories`). */
export function menuCategoryOf(id: string, name: string, overrides: Partial<MenuCategory> = {}): MenuCategory {
  return { id, name, description: '', parentId: null, status: 'active', sortOrder: 1, childCount: 0, itemCount: 0, availabilityRules: [], version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

/** A menu item as the list shows it (`GET /api/admin/menu/items`): a draft in Tea at $3.50. */
export function menuItemSummaryOf(id: string, name: string, overrides: Partial<MenuItemSummary> = {}): MenuItemSummary {
  return { id, name, categoryId: 'cat-1', categoryName: 'Tea', status: 'draft', imageUrl: null, priceMinMinor: 350, priceMaxMinor: 350, sortOrder: 1, version: 1, updatedAt: STAMP, ...overrides }
}

/** A whole menu item (`GET /api/admin/menu/items/{id}`): one version at $3.50, no option sets or add-ons. */
export function menuItemOf(id: string, name: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    categoryId: 'cat-1',
    name,
    description: '',
    image: null,
    status: 'draft',
    sortOrder: 1,
    optionSets: [],
    variations: [{ id: `${id}-v`, valueIds: [], label: '', priceMinor: 350, status: 'active', sellable: true }],
    modifierGroups: [],
    availabilityRules: [],
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}

export const RIVERSIDE: BranchOption = { id: 'branch-1', name: 'Riverside' }
export const AIRPORT: BranchOption = { id: 'branch-2', name: 'Airport' }

export function staffOf(id: string, name: string, overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@nukcafe.test`,
    admin: false,
    memberships: [{ branchId: RIVERSIDE.id, branchName: RIVERSIDE.name, role: 'staff' }],
    mustChangePassword: false,
    version: 1790000000000,
    createdAt: STAMP,
    ...overrides,
  }
}

export const MENU_TEA = menuCategoryOf('cat-1', 'Tea')
export const MENU_COFFEE = menuCategoryOf('cat-2', 'Coffee', { sortOrder: 2 })

export function pageOf<T>(items: T[], page = 1, pageSize = 20): ApiPage<T> {
  return { items, page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) }
}

/** A signed-in admin with two categories. */
export const DEFAULT_HANDLERS: Record<string, MockHandler> = {
  // Better Auth's client plugin reads the session once at startup; the app itself uses /admin/me.
  'GET /auth/get-session': () => null,
  'POST /auth/sign-out': () => ({ success: true }),
  'GET /admin/me': () => ADMIN,
  'GET /admin/menu/categories': () => [MENU_TEA, MENU_COFFEE],
  'POST /admin/menu/categories': ({ body }) => menuCategoryOf('cat-3', String((body as { name?: string })?.name ?? 'New')),
  // The category and item forms' pickers and libraries.
  'GET /admin/menu/availability-rules': () => [],
  'GET /admin/menu/option-sets': () => [],
  'GET /admin/menu/modifier-groups': () => [],
}

/** Throw this from a handler to answer with an error in the API's format. */
export class MockFailure {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {}
}

/** Error responses our server sends (server/utils/api-error.ts). */
export const failures = {
  validation: (message = 'Some of the submitted data is invalid.', fieldErrors?: Record<string, string[]>) =>
    new MockFailure(400, 'VALIDATION_FAILED', message, fieldErrors),
  notFound: (message = 'The category was not found. It may have been deleted.') => new MockFailure(404, 'NOT_FOUND', message),
  conflict: (code = 'VERSION_CONFLICT', message = 'This category was changed by someone else. Reload it and try again.') =>
    new MockFailure(409, code, message),
  /** A crash: the user sees a generic message, never this text. */
  server: () => new MockFailure(500, 'INTERNAL', 'D1_ERROR: no such table: menu_categories'),
  /** No session (expired, or signed out elsewhere). */
  unauthorized: () => new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.'),
  /** Signed in, but not a platform admin (a customer, branch staff). */
  notAdmin: () => new MockFailure(403, 'NOT_ADMIN', 'This account doesn\'t have access to the admin app.'),
  /** The /api/admin route gate's answer to a non-admin. */
  forbidden: () => new MockFailure(403, 'FORBIDDEN', 'You don\'t have permission to do this.'),
  passwordChangeRequired: () => new MockFailure(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue.'),
}

/** Handlers for a signed-out browser: no session, and no staff session. */
export const SIGNED_OUT: Record<string, MockHandler> = {
  'GET /admin/me': () => {
    throw failures.unauthorized()
  },
}

/**
 * A response held back until the test lets it go: for "while saving…" / out-of-order scenarios.
 * Each call to `handler` waits; `release` answers the oldest waiting call.
 *
 * @example
 * const save = deferred()
 * await mockApi(page, { 'PATCH /admin/categories/{id}': save.handler })
 * … await save.started() … save.release(category) / save.fail(failures.validation())
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
 * A list endpoint that searches (`search`, on `searchField`), filters by `status` and paginates
 * like the server (1-based `page`, `pageSize`). Pass a function to let the rows change during the
 * test (e.g. after deletes).
 */
export function paginatedHandler<T extends Record<string, unknown>>(rows: T[] | (() => T[]), searchField: keyof T = 'name'): MockHandler {
  return ({ url }) => {
    const all = typeof rows === 'function' ? rows() : rows
    const search = url.searchParams.get('search')?.toLowerCase()
    const page = Number(url.searchParams.get('page') ?? 1)
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20)
    const status = url.searchParams.get('status')
    const matching = all
      .filter(r => !search || String(r[searchField]).toLowerCase().includes(search))
      // Like the server's `status` filter (also what status-tab counts ask for); `all` is every status.
      .filter(r => !status || status === 'all' || r.status === status)
    return {
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: matching.length,
      totalPages: Math.max(1, Math.ceil(matching.length / pageSize)),
    }
  }
}

/** The last path segment of a request: the record id of `/admin/categories/{id}`. */
export const lastSegment = (url: URL) => url.pathname.split('/').pop()!

/**
 * A JSON body parsed; any other body (multipart uploads) as its raw text, so a handler can still
 * check it; no body → `null`.
 */
function requestBody(request: ReturnType<Route['request']>): unknown {
  const raw = request.postData()
  if (raw === null) return null
  return request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : raw
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

export async function mockApi(page: Page, handlers: Record<string, MockHandler> = {}): Promise<MockApi> {
  const active = { ...DEFAULT_HANDLERS, ...handlers }
  const calls: string[] = []
  const missing: string[] = []
  const origin = new URL(url('/')).origin

  await page.route(`${origin}/api/**`, async (route: Route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    // Keys name the route without `/api`: 'GET /admin/me', 'GET /public/menu', 'POST /auth/sign-out'.
    const path = requestUrl.pathname.replace(/^\/api(?=\/(?:admin|public|shop|counter|auth)\b)/, '')
    const key = `${request.method()} ${path}`
    calls.push(key)
    // 'DELETE /admin/categories/cat-1' also matches a 'DELETE /admin/categories/{id}' handler.
    const handler = active[key] ?? active[key.replace(/\/[^/]*\d[^/]*(?=\/|$)/g, '/{id}')]
    if (!handler) {
      missing.push(key)
      unhandled.push(key)
      await route.fulfill({ status: 501, json: { statusCode: 501, message: `No mock for ${key}`, data: { code: 'UNMOCKED', message: `No mock for ${key}` } } }).catch(() => {})
      return
    }
    try {
      const data = await handler({ url: requestUrl, body: requestBody(request) })
      await route.fulfill({ status: 200, json: data ?? null })
    }
    catch (error) {
      if (!(error instanceof MockFailure)) throw error
      const data = { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }
      await route.fulfill({ status: error.status, json: { error: true, statusCode: error.status, message: error.message, data } })
    }
  })

  // Media is served by our own origin (`/media/<key>`, like the real server): any key answers with
  // a 1×1 PNG, so images render under the production CSP instead of failing to load.
  await page.route(`${origin}/media/**`, route => route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }))

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

/**
 * Open the admin at `/admin` and click through the sidebar, so back/forward stay in-app (SPA history).
 * Returns once the router has committed the last navigation: every link adds its history entry.
 */
export async function gotoViaSidebar(page: Page, links: (string | RegExp)[]) {
  await page.goto(url('/admin'), { waitUntil: 'hydration' })
  for (const name of links) {
    const link = page.getByRole('link', { name }).first()
    const path = await link.getAttribute('href')
    await link.click()
    // A route change isn't a page load (`waitForLoadState` returns at once). Wait until the router
    // commits it (the URL changes), or the next click cancels it while its page chunk or middleware
    // is still pending, and its history entry is never pushed (the "asks on browser forward" flake).
    await page.waitForURL(address => address.pathname === path)
  }
}

/**
 * A toast by its title. Nuxt UI also renders a hidden `aria-live` copy of each toast's text,
 * so a plain `getByText` matches twice.
 */
export function toast(page: Page, title: string | RegExp) {
  return page.locator('[data-slot="title"]', { hasText: title })
}

/**
 * A category in the Categories tree (`/admin/categories`), by name. The tree loads
 * `GET /admin/menu/categories`; the default handlers answer it with MENU_TEA and MENU_COFFEE.
 */
export function categoryItem(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true })
}

/** Tabs of one browser window: pages in one context share `BroadcastChannel`. */
export async function openTabs(count: number) {
  const context = await (await getBrowser()).newContext()
  contexts.push(context)
  return Promise.all(Array.from({ length: count }, () => context.newPage()))
}

/** `goto` for pages from `openTabs` (they lack test-utils' `waitUntil: 'hydration'` wrapper). */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(url(path))
  await waitForHydration(page, url(path), 'hydration')
}
