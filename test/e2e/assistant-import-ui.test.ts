import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { AssistantImportReview, AssistantImportReviewRow } from '../../shared/contracts/assistant-import'
import { deferred, failures, menuCategoryOf, MockFailure, mockApi, pageOf, setupE2e } from './support/mock-api'

await setupE2e()
const BASE = '/admin/assistant/imports'
const PAGE = '/c/nuk/admin/products/import'
const CATEGORY = crypto.randomUUID()
const PNG = readFileSync(new URL('../../server/features/assistant/eval/fixtures/columns-and-sizes.png', import.meta.url))
const screenshots = fileURLToPath(new URL('../../docs/plans/assets/ai-assistant/d155/', import.meta.url))

function row(name: string): AssistantImportReviewRow {
  return { id: crypto.randomUUID(), selected: true, source: { name, description: 'Source description', category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] }, draft: { name, description: '', categoryId: CATEGORY, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] } }
}
function fixture(): AssistantImportReview {
  return { source: { id: crypto.randomUUID(), fileName: 'English menu.png', mimeType: 'image/png', byteSize: PNG.length, version: 3, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }, state: 'ready', retryAt: null, error: null, rows: [row('Coffee'), row('Tea')] }
}

async function open(options: { width?: number, state?: AssistantImportReview, upload?: boolean, enabled?: boolean, duplicate?: string, conflict?: boolean, failure?: string, extraction?: boolean } = {}) {
  const page = await createPage()
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 })
  const state = options.state ?? fixture()
  const writes: { rowId: string, body: { version: number, confirmDuplicate?: boolean }, key?: string }[] = []
  const edits: unknown[] = []
  let conflict = options.conflict
  const held = deferred()
  const api = await mockApi(page, {
    'GET /admin/assistant/import-status': () => ({ enabled: options.enabled !== false, pdfProcessing: false }),
    'GET /admin/menu/categories': () => [menuCategoryOf(CATEGORY, 'Drinks')],
    'GET /admin/menu/items': () => pageOf([]),
    'GET /admin/menu/items/status-counts': () => ({ all: 0, draft: 0, active: 0, archived: 0 }),
    [`GET ${BASE}`]: () => [state.source],
    [`POST ${BASE}`]: ({ headers }) => {
      state.source.fileName = decodeURIComponent(headers['x-file-name']!)
      state.source.mimeType = headers['content-type'] as AssistantImportReview['source']['mimeType']
      state.state = 'none'
      state.rows = []
      return state.source
    },
    [`GET ${BASE}/{id}/review`]: () => structuredClone(state),
    [`PATCH ${BASE}/{id}/review/{id}`]: ({ url: requestUrl, body }) => {
      const command = body as { version: number, draft?: AssistantImportReviewRow['draft'], selected?: boolean }
      edits.push(command)
      if (conflict) {
        conflict = false
        state.source.version++
        throw failures.conflict()
      }
      if (command.version !== state.source.version) throw failures.conflict()
      const target = state.rows.find(r => r.id === requestUrl.pathname.split('/').at(-1))!
      if (target.createdItemId) throw failures.conflict('AI_IMPORT_ROW_CREATED')
      if (command.draft) target.draft = command.draft
      if (command.selected !== undefined) target.selected = command.selected
      state.source.version++
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/review/{id}/create-draft`]: ({ url: requestUrl, body, headers }) => {
      const command = body as { version: number, confirmDuplicate?: boolean }
      const id = requestUrl.pathname.split('/').at(-2)!
      writes.push({ rowId: id, body: command, key: headers['idempotency-key'] })
      if (command.version !== state.source.version) throw failures.conflict()
      if (id === options.duplicate && !command.confirmDuplicate) throw failures.conflict('ITEM_NAME_EXISTS', 'A menu item with this name already exists. Confirm the duplicate before creating another draft.')
      if (id === options.failure) throw new MockFailure(422, 'CATEGORY_NOT_AVAILABLE', 'This category is no longer available. Choose another category.')
      const target = state.rows.find(r => r.id === id)!
      target.createdItemId ??= crypto.randomUUID()
      state.source.version++
      return { sourceId: state.source.id, rowId: id, itemId: target.createdItemId, version: state.source.version, alreadyCreated: false, replayed: false }
    },
    [`POST ${BASE}/{id}/extract`]: async (request) => {
      state.state = 'processing'
      state.source.version++
      if (options.extraction) await held.handler(request)
      else state.state = 'ready'
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/cancel`]: () => {
      state.state = 'failed'
      state.error = 'AI_IMPORT_CANCELLED'
      state.retryAt = new Date(Date.now() + 60000).toISOString()
      state.source.version++
      held.release()
      return structuredClone(state)
    },
    [`POST ${BASE}/{id}/discard`]: () => ({ cleanupPending: false }),
  })
  await page.route('**/api/c/*/admin/assistant/imports/*/source', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto(url(options.upload ? PAGE : `${PAGE}?source=${state.source.id}`), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Import menu', exact: true }).waitFor()
  return { page, state, writes, edits, api }
}
async function createSelected(page: Page, count = 2) {
  await page.getByRole('button', { name: `Create ${count} ${count === 1 ? 'draft' : 'drafts'}`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Create drafts', exact: true }).click()
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

describe('private menu import workspace', () => {
  it('keeps entry hidden and direct import unavailable when the switch is off', async () => {
    const { page, api } = await open({ enabled: false })
    await page.getByText('Menu import is not available yet').waitFor()
    expect(api.calls.some(c => c.startsWith(`GET ${BASE}`))).toBe(false)
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    expect(await page.getByRole('link', { name: 'Import menu', exact: true }).count()).toBe(0)
  })
  it('opens import from the enabled Menu items entry at phone width', async () => {
    const { page } = await open({ upload: true, width: 320 })
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    const entry = page.getByRole('link', { name: 'Import menu', exact: true })
    await entry.waitFor()
    expect(await entry.getAttribute('href')).toBe(PAGE)
    await noOverflow(page)
    await entry.click()
    await page.getByRole('heading', { name: 'Upload a menu', exact: true }).waitFor()
  })
  it('uploads an image without a question, then resumes after reload', async () => {
    const { page, state, api } = await open({ upload: true })
    await page.locator('input[type=file]').setInputFiles({ name: 'English image.png', mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: 'Upload source', exact: true }).click()
    await page.getByRole('button', { name: 'Extract menu', exact: true }).waitFor()
    expect(page.url()).toContain(`source=${state.source.id}`)
    expect(api.calls.filter(c => c === `POST ${BASE}`)).toHaveLength(1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('English image.png', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Extract menu', exact: true }).waitFor()
  })
  it('stores PDF sources with an honest pending notice and no extraction action', async () => {
    const { page } = await open({ upload: true })
    await page.locator('input[type=file]').setInputFiles({ name: 'Menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') })
    await page.getByText('PDF extraction is coming next', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Upload source', exact: true }).click()
    await page.getByRole('link', { name: 'Download source PDF', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: /Extract menu|Retry extraction/ }).count()).toBe(0)
  })
  it('guards phone corrections, applies to the private review with the keyboard, and creates no menu item', async () => {
    const { page, state, edits, writes } = await open({ width: 390 })
    await page.getByRole('button', { name: 'Correct item', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Corrected coffee')
    await page.getByRole('button', { name: 'Back to review', exact: true }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
    expect(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue()).toBe('Corrected coffee')
    await page.keyboard.press('Control+Enter')
    await page.getByRole('heading', { name: 'Review items', exact: true }).waitFor()
    expect(state.rows[0]!.draft.name).toBe('Corrected coffee')
    expect(edits).toHaveLength(1)
    expect(writes).toHaveLength(0)
    expect(state.rows[0]!.source.name).toBe('Coffee')
    await noOverflow(page)
  })
  it('keeps conflict input until an explicit reload and uses the resumed version', async () => {
    const { page, state } = await open({ conflict: true })
    await page.getByRole('button', { name: 'Correct item', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved coffee')
    await page.getByRole('button', { name: 'Apply to review', exact: true }).click()
    await page.getByRole('button', { name: 'Reload review', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => page.getByRole('textbox', { name: 'Name', exact: true }).inputValue()).toBe('Coffee')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Resumed coffee')
    await page.getByRole('button', { name: 'Apply to review', exact: true }).click()
    await page.getByRole('heading', { name: 'Review items', exact: true }).waitFor()
    expect(state.rows[0]!.draft.name).toBe('Resumed coffee')
  })
  it('serially creates only selected drafts, locks receipts and links to normal editors', async () => {
    const { page, state, writes } = await open()
    await createSelected(page)
    await page.getByText('2 drafts created. Open each draft to review and publish through Menu items.').waitFor()
    expect(writes.map(w => w.body.version)).toEqual([3, 4])
    expect(writes.every(w => Boolean(w.key))).toBe(true)
    expect(writes.every(w => Object.keys(w.body).every(k => ['version', 'confirmDuplicate'].includes(k)))).toBe(true)
    expect(await page.getByRole('button', { name: 'Correct item', exact: true }).count()).toBe(0)
    expect(await page.getByRole('checkbox').first().isDisabled()).toBe(true)
    expect(await page.getByRole('link', { name: 'Open draft', exact: true }).first().getAttribute('href')).toBe(`/c/nuk/admin/products/${state.rows[0]!.createdItemId}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: 'Open draft', exact: true }).first().waitFor()
    expect(writes).toHaveLength(2)
  })
  it('keeps a partial success and explicitly confirms only the duplicate row on retry', async () => {
    const state = fixture()
    const { page, writes } = await open({ state, duplicate: state.rows[1]!.id })
    await createSelected(page)
    await page.getByRole('button', { name: 'Confirm duplicate', exact: true }).waitFor()
    expect(await page.getByRole('link', { name: 'Open draft', exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: 'Confirm duplicate', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create another draft', exact: true }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Open draft', exact: true }).count()).toBe(2)
    expect(writes.map(w => w.rowId)).toEqual([state.rows[0]!.id, state.rows[1]!.id, state.rows[1]!.id])
    expect(writes[2]!.body.confirmDuplicate).toBe(true)
  })
  it('keeps incomplete rows out of creation until corrected or excluded', async () => {
    const state = fixture()
    state.rows[0]!.draft.categoryId = null
    const { page, writes } = await open({ state })
    await page.getByText('1 selected item needs correction. Fix or exclude before creating drafts.').waitFor()
    expect(await page.getByRole('button', { name: 'Create 2 drafts', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('checkbox', { name: 'Include Coffee', exact: true }).click()
    await expect.poll(() => page.getByRole('checkbox', { name: 'Include Coffee', exact: true }).getAttribute('aria-checked')).toBe('false')
    await createSelected(page, 1)
    await page.getByRole('link', { name: 'Open draft', exact: true }).waitFor()
    expect(writes.map(w => w.rowId)).toEqual([state.rows[1]!.id])
  })
  it('stops extraction and respects the recoverable lease before retry', async () => {
    const state = fixture()
    state.state = 'none'
    state.rows = []
    const { page, api } = await open({ state, extraction: true })
    await page.getByRole('button', { name: 'Extract menu', exact: true }).click()
    await expect.poll(() => state.state).toBe('processing')
    await page.getByRole('button', { name: 'Stop extraction', exact: true }).click()
    await page.getByText('Extraction stopped. Your private source is still available.').waitFor()
    expect(await page.getByRole('button', { name: 'Retry extraction', exact: true }).isDisabled()).toBe(true)
    expect(api.calls.filter(c => c.endsWith('/cancel'))).toHaveLength(1)
  })
  it('does not offer writes for an expired review', async () => {
    const state = fixture()
    state.source.expiresAt = new Date(Date.now() - 1000).toISOString()
    const { page, writes } = await open({ state })
    await page.getByText('This private import has expired').waitFor()
    expect(await page.getByRole('button', { name: 'Create 2 drafts', exact: true }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Correct item', exact: true }).first().isDisabled()).toBe(true)
    expect(writes).toHaveLength(0)
  })
  it('confirms private discard and explains that menu drafts remain', async () => {
    const { page, api } = await open()
    await page.getByRole('button', { name: 'Discard import', exact: true }).click()
    await page.getByText('The private source and review will be deleted. Menu drafts already created will stay in Menu items.').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard import', exact: true }).click()
    await page.getByRole('heading', { name: 'Upload a menu', exact: true }).waitFor()
    expect(api.calls.filter(c => c.endsWith('/discard'))).toHaveLength(1)
  })
  it('shows a load failure with retry', async () => {
    const { page, api, state } = await open()
    api.set({ [`GET ${BASE}/{id}/review`]: () => {
      throw failures.server()
    } })
    await page.getByRole('button', { name: 'Reload review', exact: true }).click()
    await page.getByText('Could not load data', { exact: true }).waitFor()
    api.set({ [`GET ${BASE}/{id}/review`]: () => state })
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByRole('heading', { name: 'Review items', exact: true }).waitFor()
  })
  it('shows the protected source on a phone and returns focus after Escape', async () => {
    const { page } = await open({ width: 390 })
    await page.getByRole('button', { name: 'View source', exact: true }).click()
    await page.getByRole('dialog').getByRole('img', { name: 'Uploaded menu source', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'View source', exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
  })
  it('preserves a successful draft when a library becomes unavailable and allows correction', async () => {
    const state = fixture()
    const { page, writes } = await open({ state, failure: state.rows[1]!.id })
    await createSelected(page)
    await page.getByRole('button', { name: 'Retry this draft', exact: true }).waitFor()
    expect(await page.getByRole('link', { name: 'Open draft', exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: 'Correct item', exact: true }).click()
    expect(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue()).toBe('Tea')
    expect(writes.map(w => w.rowId)).toEqual(state.rows.map(r => r.id))
  })
  it('explains empty reviews and quota failures without starting a call automatically', async () => {
    const state = fixture()
    state.rows = []
    const { page, api } = await open({ state })
    await page.getByText('No items to review', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Create 0 drafts', exact: true }).isDisabled()).toBe(true)
    state.state = 'failed'
    state.error = 'AI_LIMIT_REACHED'
    await page.getByRole('button', { name: 'Reload review', exact: true }).click()
    await page.getByText('Today’s assistant limit has been reached. Your source is saved; try again tomorrow.', { exact: true }).waitFor()
    expect(api.calls.some(c => c.endsWith('/extract'))).toBe(false)
  })
  it('shows saved prices separately from immutable source prices', async () => {
    const state = fixture()
    state.rows[0]!.draft.variations[0]!.priceMinor = 325
    const { page } = await open({ state })
    await page.getByText('Saved prices (USD): $3.25 · 1 offered version', { exact: true }).waitFor()
    expect(await page.getByText('Price: $2.50 · USD', { exact: true }).count()).toBe(2)
    await page.getByText('Saved category: Drinks', { exact: true }).first().waitFor()
  })
  it('keeps long names and 200 percent text usable on a phone', async () => {
    const state = fixture()
    state.source.fileName = `${'menu'.repeat(38)}.png`
    state.rows[0]!.draft.name = 'Coffee'.repeat(13)
    const { page } = await open({ state, width: 390 })
    await noOverflow(page)
    await page.getByRole('button', { name: 'Correct item', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor()
    await page.evaluate(() => document.documentElement.style.fontSize = '200%')
    await noOverflow(page)
    await page.getByRole('textbox', { name: 'Name', exact: true }).focus()
    await page.getByRole('textbox', { name: 'Name', exact: true }).evaluate(el => el.blur())
    await page.getByRole('button', { name: 'Apply to review', exact: true }).waitFor()
  })
  it('keeps upload, review and correction usable at all standard widths, in dark mode and landscape', async () => {
    mkdirSync(screenshots, { recursive: true })
    const { page, state } = await open()
    for (const [width, height] of [[320, 900], [390, 900], [768, 900], [1024, 900], [1440, 900], [1920, 1080], [844, 390]]) {
      await page.setViewportSize({ width: width!, height: height! })
      await page.getByRole('heading', { name: 'Review items', exact: true }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: `${screenshots}/review-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Correct item', exact: true }).first().click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: `${screenshots}/correction-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Back to review', exact: true }).first().click()
      await page.goto(url(PAGE), { waitUntil: 'hydration' })
      await page.getByRole('heading', { name: 'Upload a menu', exact: true }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: `${screenshots}/upload-${width}.png`, fullPage: true })
      await page.goto(url(`${PAGE}?source=${state.source.id}`), { waitUntil: 'hydration' })
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await noOverflow(page)
    await page.screenshot({ path: `${screenshots}/review-dark-390.png`, fullPage: true })
  }, 120_000)
})
