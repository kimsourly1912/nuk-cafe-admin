import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantImportReview, AssistantImportReviewRow, AssistantPdfPage } from '../../shared/contracts/assistant-import'
import { deferred, failures, menuCategoryOf, mockApi, setupE2e } from './support/mock-api'

await setupE2e()
const BASE = '/admin/assistant/imports'
const PAGE = '/c/nuk/admin/products/import'
const CATEGORY = crypto.randomUUID()
const PDF = readFileSync(new URL('../../server/features/assistant/eval/fixtures/mixed.pdf', import.meta.url))
let lastPage: Page | undefined
const shots = fileURLToPath(new URL('../../docs/plans/assets/ai-assistant/d158/', import.meta.url))
function row(pageNumber: number): AssistantImportReviewRow {
  return { id: crypto.randomUUID(), sourcePageNumber: pageNumber, selected: true,
    source: { name: pageNumber === 1 ? 'Coffee' : 'Tea', description: null, category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] },
    draft: { name: pageNumber === 1 ? 'Coffee' : 'Tea', description: '', categoryId: CATEGORY, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] } }
}
const pendingPage = (pageNumber: number): AssistantPdfPage => ({ pageNumber, state: 'pending', attempts: 0, itemCount: 0, error: null })
function fixture(): AssistantImportReview {
  return { source: { id: crypto.randomUUID(), fileName: 'English menu.pdf', mimeType: 'application/pdf', byteSize: PDF.length, version: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }, state: 'none', rows: [], error: null, retryAt: null }
}
async function open(options: { width?: number, pages?: string, state?: AssistantImportReview, failPage?: number, quota?: boolean, heldPage?: number, encodingHeld?: boolean, enabled?: boolean } = {}) {
  const page = await createPage()
  lastPage = page
  page.on('pageerror', error => console.info('PDF browser page error:', error.message))
  await page.setViewportSize({ width: options.width ?? 390, height: 900 })
  if (options.encodingHeld) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    const callbacks: BlobCallback[] = []
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callbacks.push(callback)
    }
    Object.assign(window, { pdfEncoding: { callbacks, restore: () => {
      HTMLCanvasElement.prototype.toBlob = original
    } } })
  })
  const state = options.state ?? fixture()
  const manifests: { version: number, pageNumbers: number[] }[] = []
  const payloads: { pageNumber: number, version: number, size: number, width: number, height: number }[] = []
  const finishes: unknown[] = []
  const drafts: string[] = []
  const edits: unknown[] = []
  const held = deferred()
  let failPage = options.failPage
  const api = await mockApi(page, {
    'GET /admin/assistant/import-status': () => ({ enabled: options.enabled !== false, pdfProcessing: true }),
    'GET /admin/menu/categories': () => [menuCategoryOf(CATEGORY, 'Drinks')],
    [`GET ${BASE}`]: () => [state.source],
    [`GET ${BASE}/{id}/review`]: () => structuredClone(state),
    [`POST ${BASE}/{id}/pdf-pages`]: ({ body }) => {
      const command = body as { version: number, pageNumbers: number[] }
      manifests.push(command)
      if (command.version !== state.source.version) throw failures.conflict()
      state.pdf = { pages: command.pageNumbers.map(pendingPage) }
      state.source.version++
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/pdf-pages/finish`]: ({ body }) => {
      finishes.push(body)
      const command = body as { version: number, confirmPartial: true }
      if (command.version !== state.source.version || !command.confirmPartial) throw failures.conflict()
      state.pdf!.pages = state.pdf!.pages.map(p => p.state === 'ready' ? p : { ...p, state: 'skipped' })
      state.state = 'ready'
      state.error = null
      state.source.version++
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/cancel`]: () => {
      state.pdf!.pages = state.pdf!.pages.map(p => p.state === 'processing' ? { ...p, state: 'failed', error: 'AI_IMPORT_CANCELLED' } : p)
      state.state = 'failed'
      state.error = 'AI_IMPORT_CANCELLED'
      state.retryAt = new Date(Date.now() + 60000).toISOString()
      state.source.version++
      return structuredClone(state)
    },
    [`PATCH ${BASE}/{id}/review/{id}`]: ({ url: requestUrl, body }) => {
      const command = body as { version: number, draft?: AssistantImportReviewRow['draft'], selected?: boolean }
      edits.push(command)
      if (state.state !== 'ready' || command.version !== state.source.version) throw failures.conflict()
      const target = state.rows.find(r => r.id === requestUrl.pathname.split('/').at(-1))!
      if (command.draft) target.draft = command.draft
      if (command.selected !== undefined) target.selected = command.selected
      state.source.version++
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/review/{id}/create-draft`]: ({ url: requestUrl, body }) => {
      const id = requestUrl.pathname.split('/').at(-2)!
      const command = body as { version: number }
      if (state.state !== 'ready' || command.version !== state.source.version) throw failures.conflict()
      const target = state.rows.find(r => r.id === id)!
      target.createdItemId ??= crypto.randomUUID()
      drafts.push(id)
      state.source.version++
      return { sourceId: state.source.id, rowId: id, itemId: target.createdItemId, version: state.source.version, replayed: false, alreadyCreated: false }
    },
  })
  let sourceReads = 0
  await page.route('**/api/c/*/admin/assistant/imports/*/source', async (route) => {
    sourceReads++
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF })
  })
  await page.route('**/api/c/*/admin/assistant/imports/*/pdf-pages/*/extract', async (route) => {
    const request = route.request()
    const number = Number(new URL(request.url()).pathname.split('/').at(-2))
    const bytes = request.postDataBuffer()!
    expect(request.headers()['content-type']).toBe('image/png')
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const version = Number(request.headers()['x-source-version'])
    payloads.push({ pageNumber: number, version, size: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
    if (version !== state.source.version) return route.fulfill({ status: 409, json: { statusCode: 409, data: { code: 'VERSION_CONFLICT', message: 'Reload the review.' } } })
    const entry = state.pdf!.pages.find(p => p.pageNumber === number)!
    entry.state = 'processing'
    entry.attempts++
    state.state = 'processing'
    state.source.version++
    const attemptVersion = state.source.version
    if (options.heldPage === number) await held.handler({ url: new URL(request.url()), body: null, headers: {} })
    if (state.source.version !== attemptVersion) return route.fulfill({ status: 409, json: { statusCode: 409, data: { code: 'AI_IMPORT_CANCELLED', message: 'Processing was cancelled.' } } }).catch(() => {})
    if (failPage === number) {
      failPage = undefined
      entry.state = 'failed'
      entry.error = options.quota ? 'AI_LIMIT_REACHED' : 'AI_IMPORT_RESULT_INVALID'
      if (options.quota) entry.attempts--
      state.state = 'failed'
      state.error = entry.error
      state.source.version++
      return route.fulfill({ status: options.quota ? 429 : 502, json: { statusCode: options.quota ? 429 : 502, data: { code: entry.error, message: options.quota ? 'Daily limit reached.' : 'Could not read this page.' } } })
    }
    entry.state = 'ready'
    entry.itemCount = 1
    entry.error = null
    state.rows.push(row(number))
    state.state = state.pdf!.pages.every(p => p.state === 'ready') ? 'ready' : 'none'
    state.error = null
    state.source.version++
    await route.fulfill({ json: structuredClone(state) }).catch(() => {})
  })
  await page.goto(url(`${PAGE}?source=${state.source.id}${options.pages !== undefined ? `&pages=${encodeURIComponent(options.pages)}` : ''}`), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Import menu', exact: true }).waitFor()
  return { page, state, api, manifests, payloads, finishes, edits, drafts, held, sourceReads: () => sourceReads }
}
async function preview(page: Page) {
  await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
  await page.getByRole('img', { name: /PDF source page/ }).waitFor()
  await expect.poll(() => page.getByText('Preparing page preview…', { exact: true }).count()).toBe(0)
}
async function ready(page: Page) {
  await page.getByRole('heading', { name: 'Review items', exact: true }).waitFor()
}

describe('supplied PDF page processing in the approved import workflow', () => {
  afterEach(async (context) => {
    if (context.task.result?.state === 'fail' && lastPage && !lastPage.isClosed()) {
      console.info('PDF browser failure state:', (await lastPage.locator('body').innerText()).slice(-5000))
      await lastPage.screenshot({ path: '/tmp/assistant-d158-failure-' + context.task.name.slice(0, 30).replace(/[^a-z]/g, '-') + '.png' })
    }
  })
  it('serially posts bounded real PNGs with fresh versions, then reuses corrections and explicit draft creation', async () => {
    const { page, payloads, manifests, state, edits, drafts } = await open()
    expect(payloads).toEqual([])
    expect(await page.getByRole('button', { name: 'Extract menu', exact: true }).isDisabled()).toBe(true)
    await preview(page)
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}pdf-select-390.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: `${shots}pdf-select-1440.png` })
    await page.setViewportSize({ width: 390, height: 900 })
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await expect.poll(() => payloads.length).toBe(2)
    await ready(page)
    expect(manifests).toEqual([{ version: 1, pageNumbers: [1, 2] }])
    expect(payloads.map(p => [p.pageNumber, p.version])).toEqual([[1, 2], [2, 4]])
    for (const payload of payloads) {
      expect(payload.size).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(Math.max(payload.width, payload.height)).toBeLessThanOrEqual(1400)
      expect(payload.width * payload.height).toBeLessThanOrEqual(2_000_000)
    }
    await page.getByText('Source page 2 · Source: Tea · Drinks', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Correct item', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Correct menu item', exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Corrected coffee')
    await page.keyboard.press('Control+Enter')
    await ready(page)
    expect(edits).toHaveLength(1)
    await page.getByRole('button', { name: 'Create 2 drafts', exact: true }).click()
    await page.getByRole('button', { name: 'Create drafts', exact: true }).click()
    await expect.poll(() => drafts.length).toBe(2)
    expect(state.rows.map(r => r.sourcePageNumber)).toEqual([1, 2])
    expect(state.rows.every(r => Boolean(r.createdItemId))).toBe(true)
    expect(payloads).toHaveLength(2)
  })
  it('uses saved manifest labels after reload even when the address selects different pages', async () => {
    const state = fixture()
    state.source.version = 4
    state.pdf = { pages: [{ ...pendingPage(1), state: 'ready', itemCount: 1, attempts: 1 }, pendingPage(2)] }
    state.rows = [row(1)]
    const original = structuredClone(state.rows)
    const { page, payloads, manifests } = await open({ state, pages: '1' })
    await preview(page)
    await expect.poll(() => page.getByRole('checkbox', { name: 'Select page 2', exact: true }).isChecked()).toBe(true)
    expect(await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).click()
    await ready(page)
    expect(payloads.map(p => p.pageNumber)).toEqual([2])
    expect(manifests).toEqual([])
    expect(state.rows[0]).toEqual(original[0])
  })
  it('persists successful evidence through a failed page and explicitly retries only the unfinished page', async () => {
    const { page, state, payloads } = await open({ failPage: 2 })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await page.getByRole('heading', { name: 'Items from successful pages', exact: true }).waitFor()
    await expect.poll(() => state.state).toBe('failed')
    const first = structuredClone(state.rows[0])
    expect(await page.getByRole('button', { name: 'Correct item', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Retry failed', exact: true }).click()
    await ready(page)
    expect(payloads.map(p => p.pageNumber)).toEqual([1, 2, 2])
    expect(state.rows[0]).toEqual(first)
  })
  it('requires explicit partial confirmation, locks skipped pages and guards a direct correction link', async () => {
    const state = fixture()
    state.source.version = 4
    state.pdf = { pages: [{ ...pendingPage(1), state: 'ready', itemCount: 1 }, { ...pendingPage(2), state: 'failed', attempts: 3 }] }
    state.rows = [row(1)]
    state.state = 'failed'
    const { page, finishes, payloads } = await open({ state })
    await page.goto(url(`${PAGE}?source=${state.source.id}&row=${state.rows[0]!.id}`), { waitUntil: 'hydration' })
    await expect.poll(async () => await page.getByRole('heading', { name: 'Items from successful pages', exact: true }).count() + await page.getByRole('heading', { name: 'Correct menu item', exact: true }).count()).toBe(1)
    expect(await page.getByRole('heading', { name: 'Correct menu item', exact: true }).count()).toBe(0)
    await page.getByRole('heading', { name: 'Items from successful pages', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: /^Create \d+ drafts?$/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'Review successful pages', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect.poll(async () => await dialog.count() + await page.getByRole('heading', { name: 'Correct menu item', exact: true }).count()).toBe(1)
    expect(await dialog.count()).toBe(1)
    await dialog.getByText('Only items from completed pages will be reviewed.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(finishes).toEqual([])
    await page.getByRole('button', { name: 'Review successful pages', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Review successful pages', exact: true }).click()
    // The original direct link becomes usable only after explicit finalization.
    await page.getByRole('heading', { name: 'Correct menu item', exact: true }).waitFor()
    expect(finishes).toEqual([{ version: 4, confirmPartial: true }])
    expect(state.pdf.pages[1]!.state).toBe('skipped')
    expect(payloads).toEqual([])
  })
  it('refuses empty finalization and capped pages without invoking rendering or extraction', async () => {
    const state = fixture()
    state.pdf = { pages: [{ ...pendingPage(1), state: 'failed', attempts: 3 }, pendingPage(2)] }
    state.state = 'failed'
    const { page, payloads, finishes } = await open({ state })
    await page.getByText('Attempt limit reached', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Review successful pages', exact: true }).count()).toBe(0)
    await preview(page)
    await page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).click()
    await expect.poll(() => payloads.length).toBe(1)
    expect(payloads[0]!.pageNumber).toBe(2)
    expect(finishes).toEqual([])
  })
  it('stops queued calls at quota admission and offers an explicit retry with the saved successes', async () => {
    const { page, payloads, state } = await open({ failPage: 1, quota: true })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await page.getByText('Daily limit reached. Try again tomorrow.', { exact: true }).waitFor()
    await expect.poll(() => page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).isEnabled()).toBe(true)
    expect(payloads.map(p => p.pageNumber)).toEqual([1])
    expect(state.pdf!.pages[0]!.attempts).toBe(0)
    await page.getByRole('button', { name: 'Retry failed', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).isEnabled()).toBe(true)
    expect(payloads.map(p => p.pageNumber)).toEqual([1])
    await page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).click()
    await ready(page)
    expect(payloads.map(p => p.pageNumber)).toEqual([1, 1, 2])
  })
  it('stops stalled PNG encoding before any page request and ignores late callbacks', async () => {
    const { page, payloads, api } = await open({ encodingHeld: true })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { pdfEncoding: { callbacks: BlobCallback[] } }).pdfEncoding.callbacks.length)).toBe(1)
    await page.screenshot({ path: `${shots}pdf-processing-390.png` })
    await page.getByRole('button', { name: 'Stop extraction', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).isEnabled()).toBe(true)
    await page.evaluate(() => {
      const encoding = (window as unknown as { pdfEncoding: { callbacks: BlobCallback[], restore: () => void } }).pdfEncoding
      encoding.callbacks[0]!(new Blob(['late'], { type: 'image/png' }))
      encoding.restore()
    })
    expect(payloads).toEqual([])
    expect(api.calls.some(c => c.endsWith('/cancel'))).toBe(false)
    await page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).click()
    await ready(page)
    expect(payloads.map(p => p.pageNumber)).toEqual([1, 2])
  })
  it('cancels an active page, preserves prior success, and keeps partial acceptance separate from a held lease', async () => {
    const { page, state, payloads, held } = await open({ heldPage: 2 })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await held.started()
    const first = structuredClone(state.rows[0])
    await page.getByRole('button', { name: 'Stop extraction', exact: true }).click()
    await page.getByText('Waiting for the previous extraction to finish. Retry will become available shortly.', { exact: true }).waitFor()
    await expect.poll(() => page.getByRole('button', { name: 'Review successful pages', exact: true }).isEnabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Retry unfinished pages', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'Review successful pages', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Review successful pages', exact: true }).click()
    await ready(page)
    held.release()
    expect(state.rows).toEqual([first])
    expect(payloads.map(p => p.pageNumber)).toEqual([1, 2])
    expect(state.pdf!.pages[1]!.state).toBe('skipped')
  })
  it('disables extraction for forged/empty URL choices until a valid selection is made', async () => {
    const { page, manifests, payloads } = await open({ pages: '1,1,99' })
    await preview(page)
    await page.getByText('0 of 2 pages selected', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Extract menu', exact: true }).isDisabled()).toBe(true)
    expect(manifests).toEqual([])
    expect(payloads).toEqual([])
    await page.getByRole('checkbox', { name: 'Select page 2', exact: true }).click()
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await ready(page)
    expect(manifests[0]!.pageNumbers).toEqual([2])
    expect(payloads.map(p => p.pageNumber)).toEqual([2])
  })
  it('keeps completed PDF reviews replay-free and source pages available in the compact modal', async () => {
    const state = fixture()
    state.state = 'ready'
    state.pdf = { pages: [{ ...pendingPage(1), state: 'ready', itemCount: 1 }] }
    state.rows = [row(1)]
    state.rows[0]!.createdItemId = crypto.randomUUID()
    const { page, payloads, manifests } = await open({ state })
    await ready(page)
    expect(await page.getByRole('button', { name: /Extract menu|Retry unfinished pages/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'View source pages', exact: true }).click()
    await preview(page)
    await page.getByRole('img', { name: 'PDF source page 1', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    expect(payloads).toEqual([])
    expect(manifests).toEqual([])
    expect(await page.getByRole('link', { name: 'Open draft', exact: true }).count()).toBe(1)
  })
  it.each(['expiry', 'disabled'])('aborts stalled raster encoding and queued pages when %s changes', async (reason) => {
    const { page, state, api, payloads } = await open({ encodingHeld: true })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { pdfEncoding: { callbacks: BlobCallback[] } }).pdfEncoding.callbacks.length)).toBe(1)
    if (reason === 'expiry') state.source.expiresAt = new Date(Date.now() - 1).toISOString()
    else api.set({ 'GET /admin/assistant/import-status': () => ({ enabled: false, pdfProcessing: false }) })
    await page.evaluate(() => {
      const channel = new BroadcastChannel('nuk-cafe-admin:data-changed')
      channel.postMessage({ features: ['assistant-import'] })
      channel.close()
    })
    await page.getByText(reason === 'expiry' ? 'This private import has expired' : 'Menu import is not available yet', { exact: true }).waitFor()
    await expect.poll(() => page.locator('canvas').count()).toBe(0)
    await page.evaluate(() => {
      (window as unknown as { pdfEncoding: { callbacks: BlobCallback[] } }).pdfEncoding.callbacks[0]!(new Blob(['late'], { type: 'image/png' }))
    })
    expect(payloads).toEqual([])
    expect(await page.getByRole('heading', { name: 'Review items', exact: true }).count()).toBe(0)
  })
  it('terminates raster preparation and queued work when signing out', async () => {
    const { page, payloads } = await open({ encodingHeld: true, width: 1440 })
    await preview(page)
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { pdfEncoding: { callbacks: BlobCallback[] } }).pdfEncoding.callbacks.length)).toBe(1)
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
    expect(payloads).toEqual([])
    expect(await page.locator('canvas').count()).toBe(0)
  })
  it('captures selection, partial and ready review states across the required widths, keyboard, dark and 200 percent text', async () => {
    mkdirSync(shots, { recursive: true })
    const state = fixture()
    state.source.version = 4
    state.pdf = { pages: [{ ...pendingPage(1), state: 'ready', itemCount: 1 }, { ...pendingPage(2), state: 'failed', attempts: 1, error: 'AI_IMPORT_RESULT_INVALID' }] }
    state.rows = [row(1)]
    state.state = 'failed'
    const { page } = await open({ state, width: 1440 })
    await preview(page)
    for (const [width, height] of [[320, 900], [390, 900], [768, 900], [1024, 900], [1440, 900], [1920, 1000], [844, 390]]) {
      await page.setViewportSize({ width, height })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `${shots}pdf-partial-${width}.png` })
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.getByRole('button', { name: 'View page 2', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('img', { name: 'PDF source page 2', exact: true }).waitFor()
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = ''
    })
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
    })
    await page.screenshot({ path: `${shots}pdf-partial-dark-390.png` })
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.getByRole('button', { name: 'Review successful pages', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Review successful pages', exact: true }).click()
    await ready(page)
    await expect.poll(() => page.getByRole('button', { name: 'Create 1 draft', exact: true }).isEnabled()).toBe(true)
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    for (const [width, height] of [[320, 900], [390, 900], [768, 900], [1024, 900], [1440, 900], [1920, 1000], [844, 390]]) {
      await page.setViewportSize({ width, height })
      const previewButton = page.getByRole('button', { name: 'Preview PDF pages', exact: true })
      if (await previewButton.count()) await preview(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 1440) expect(await page.getByRole('img', { name: 'PDF source page 1', exact: true }).evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(400)
      await page.screenshot({ path: `${shots}pdf-review-${width}.png` })
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: `${shots}pdf-review-dark-390.png` })
  })
})
