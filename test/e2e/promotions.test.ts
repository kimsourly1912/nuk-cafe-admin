import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page, Request } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { Promotion, PromotionResults } from '../../shared/contracts/menu-promotions'
import { AIRPORT, failures, MENU_COFFEE, MENU_TEA, menuItemSummaryOf, mockApi, pageOf, RIVERSIDE, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Promotions (M1, D163): the library by phase, the editor (what's included, dates, poster,
// publish), the promotion's page with its results, ending and deleting.

const today = new Date().toLocaleDateString('en-CA')
const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const promotionOf = (id: string, name: string, over: Partial<Promotion> = {}): Promotion => ({
  id,
  name,
  description: '',
  status: 'published',
  phase: 'live',
  discount: { kind: 'percent', percent: 20 },
  label: '20% off',
  scope: 'selected',
  items: [],
  categories: [{ id: MENU_COFFEE.id, name: 'Coffee', status: 'active' }],
  branches: [],
  startsOn: day(-1),
  endsOn: day(5),
  poster: null,
  endedAt: null,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

const COFFEE_WEEK = promotionOf('promo-1', 'Coffee week')
const LATE = promotionOf('promo-2', 'Late treats', { phase: 'scheduled', startsOn: day(3), endsOn: day(4), discount: { kind: 'amount', amountMinor: 100 }, label: '$1.00 off' })
const DRAFT = promotionOf('promo-3', 'Tea time', { status: 'draft', phase: 'draft', categories: [{ id: MENU_TEA.id, name: 'Tea', status: 'active' }] })
const OLD = promotionOf('promo-4', 'Opening week', { status: 'ended', phase: 'ended', startsOn: '2026-09-01', endsOn: '2026-09-07' })

const LATTE = menuItemSummaryOf('item-1', 'Latte', { categoryId: MENU_COFFEE.id, categoryName: 'Coffee', status: 'active', priceMinMinor: 350 })
const GREEN = menuItemSummaryOf('item-2', 'Green tea', { categoryId: MENU_TEA.id, categoryName: 'Tea', status: 'active', priceMinMinor: 250 })

interface Options {
  promotions?: Promotion[]
  results?: PromotionResults
  conflictOnce?: boolean
}

async function open(path: string, options: Options = {}) {
  const store = new Map((options.promotions ?? [COFFEE_WEEK, LATE, DRAFT, OLD]).map(p => [p.id, p]))
  const sent: { method: string, path: string, body: unknown }[] = []
  let conflict = options.conflictOnce ?? false
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  const idOf = (u: URL) => u.pathname.split('/promotions/')[1]!.split('/')[0]!
  const api = await mockApi(page, {
    'GET /admin/menu/promotions': () => [...store.values()],
    'GET /admin/menu/promotions/{id}': ({ url: u }) => store.get(idOf(u)) ?? (() => {
      throw failures.notFound()
    })(),
    'GET /admin/menu/promotions/{id}/results': () => options.results ?? { orders: 0, units: 0, discountMinor: 0, salesMinor: 0, bySource: { telegram: 0, facebook: 0 } },
    'GET /admin/menu/promotions/{id}/posts': () => [],
    'POST /admin/menu/promotions': ({ body }) => {
      sent.push({ method: 'POST', path: '', body })
      const input = body as Promotion & { publish: boolean }
      const created = promotionOf('promo-9', input.name, { status: input.publish ? 'published' : 'draft', phase: input.publish ? 'live' : 'draft', startsOn: input.startsOn, endsOn: input.endsOn })
      store.set(created.id, created)
      return created
    },
    'PUT /admin/menu/promotions/{id}': ({ url: u, body }) => {
      sent.push({ method: 'PUT', path: idOf(u), body })
      if (conflict) {
        conflict = false
        const current = store.get(idOf(u))!
        store.set(current.id, { ...current, version: current.version + 1, name: 'Someone else' })
        throw failures.conflict('VERSION_CONFLICT', 'This promotion was changed by someone else.')
      }
      const current = store.get(idOf(u))!
      const next = { ...current, name: (body as { name: string }).name, version: current.version + 1 }
      store.set(current.id, next)
      return next
    },
    'POST /admin/menu/promotions/{id}/end': ({ url: u, body }) => {
      sent.push({ method: 'POST', path: `${idOf(u)}/end`, body })
      const next = { ...store.get(idOf(u))!, status: 'ended' as const, phase: 'ended' as const, endedAt: new Date().toISOString(), version: 2 }
      store.set(next.id, next)
      return next
    },
    'POST /admin/menu/promotions/{id}/publish': ({ url: u, body }) => {
      sent.push({ method: 'POST', path: `${idOf(u)}/publish`, body })
      const next = { ...store.get(idOf(u))!, status: 'published' as const, phase: 'live' as const, version: 2 }
      store.set(next.id, next)
      return next
    },
    'DELETE /admin/menu/promotions/{id}': ({ url: u, body }) => {
      sent.push({ method: 'DELETE', path: idOf(u), body })
      store.delete(idOf(u))
      return null
    },
    'GET /admin/menu/items': () => pageOf([LATTE, GREEN], 1, 100),
    'GET /admin/branches/options': () => [RIVERSIDE],
    'POST /admin/media': () => ({ id: 'asset-9', url: '/media/asset-9.png', mimeType: 'image/png', byteSize: 100 }),
  })
  await page.goto(url(`/c/nuk${path}`), { waitUntil: 'hydration' })
  return { page, sent, store, api }
}

/** Picks a real PNG poster of `width` × `height` (drawn in the page) in the file dialog. */
async function choosePoster(page: Page, width: number, height: number) {
  const bytes = await page.evaluate(async ([w, h]) => {
    const canvas = document.createElement('canvas')
    canvas.width = w!
    canvas.height = h!
    const context = canvas.getContext('2d')!
    context.fillStyle = '#7a4b2a'
    context.fillRect(0, 0, w!, h!)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, [width, height])
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /^(Upload|Replace) poster$/ }).click()])
  await chooser.setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
}

const card = (page: Page, name: string) => page.getByRole('article').filter({ has: page.getByRole('link', { name, exact: true }) })

describe('Promotions', () => {
  it('lists promotions running first, by phase, with tabs that count them', async () => {
    const { page } = await open('/admin/promotions')
    await card(page, 'Coffee week').waitFor()
    const names = await page.getByRole('article').getByRole('link').allTextContents()
    expect(names.map(n => n.trim())).toEqual(['Coffee week', 'Late treats', 'Tea time', 'Opening week'])
    await expect.poll(() => card(page, 'Coffee week').textContent()).toContain('Ends in 5 days')
    expect(await card(page, 'Late treats').textContent()).toContain('Starts in 3 days')

    await page.getByRole('tab', { name: /Live/ }).click()
    await expect.poll(() => page.getByRole('article').count()).toBe(1)
    expect(await page.getByRole('tab', { name: /Drafts/ }).textContent()).toContain('1')
    await page.getByRole('tab', { name: /Ended/ }).click()
    await card(page, 'Opening week').waitFor()
  })

  it('creates a promotion: discount, chosen items, dates, poster, then publishes it', async () => {
    const { page, sent } = await open('/admin/promotions/new', { promotions: [COFFEE_WEEK] })
    await page.getByLabel('Name').fill('Tea festival')
    const percent = page.getByRole('spinbutton').first()
    await percent.fill('15')
    await percent.blur()

    // Nothing chosen: publishing says so.
    await page.getByRole('button', { name: 'Publish' }).click()
    await page.getByText('Choose at least one item or category').waitFor()

    await page.getByRole('button', { name: 'Choose items' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose what\'s included' })
    await picker.getByRole('checkbox', { name: 'Tea', exact: true }).click()
    await picker.getByRole('checkbox', { name: 'Latte' }).click()
    await picker.getByText('1 category and 1 item').waitFor()
    await picker.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('list', { name: 'Included' }).getByText('Tea').waitFor()
    // Latte is in Coffee week too: the bigger discount wins, and the page says so.
    await page.getByText('Also covered by “Coffee week” (20% off)').waitFor()

    await page.getByRole('button', { name: '2 weeks' }).click()

    // A 4:5 design goes up as it is: no dialog, the file untouched.
    const upload = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/admin/media'))
    await choosePoster(page, 400, 500)
    expect((await upload).postData()).toContain('filename="poster.png"')
    await page.getByRole('button', { name: 'Replace poster' }).waitFor()
    expect(await page.getByRole('dialog').count()).toBe(0)

    await page.getByRole('button', { name: 'Publish' }).click()
    await toast(page, 'Promotion "Tea festival" published').waitFor()
    await page.waitForURL(/\/admin\/promotions\/promo-9$/)
    expect(sent).toEqual([{ method: 'POST', path: '', body: {
      name: 'Tea festival',
      description: '',
      discount: { kind: 'percent', percent: 15 },
      scope: 'selected',
      itemIds: [LATTE.id],
      categoryIds: [MENU_TEA.id],
      branchIds: [],
      startsOn: today,
      endsOn: day(13),
      posterId: 'asset-9',
      publish: true,
    } }])
  })

  it('a square poster is framed 4:5 first, or kept whole', async () => {
    const { page } = await open('/admin/promotions/new', { promotions: [] })
    const isUpload = (request: Request) => request.method() === 'POST' && request.url().endsWith('/admin/media')

    // Framed: the frame is portrait and the file uploaded is the cropped one, not the picked PNG.
    await choosePoster(page, 500, 500)
    let dialog = page.getByRole('dialog', { name: 'Frame the poster' })
    const frame = (await dialog.getByTestId('crop-frame').boundingBox())!
    expect(frame.width / frame.height).toBeCloseTo(0.8, 1)
    let upload = page.waitForRequest(isUpload)
    await dialog.getByRole('button', { name: 'Use photo' }).click()
    expect((await upload).postData()).toMatch(/filename="poster\.(webp|jpg)"/)
    await page.getByRole('button', { name: 'Replace poster' }).waitFor()

    // Kept whole: the picked file, untouched.
    await choosePoster(page, 500, 500)
    dialog = page.getByRole('dialog', { name: 'Frame the poster' })
    upload = page.waitForRequest(isUpload)
    await dialog.getByRole('button', { name: 'Keep whole poster' }).click()
    expect((await upload).postData()).toContain('filename="poster.png"')
    await dialog.waitFor({ state: 'detached' })
  })

  it('closing the frame dialog uploads nothing and keeps the poster it had', async () => {
    const { page } = await open('/admin/promotions/new', { promotions: [] })
    let uploads = 0
    await page.route('**/api/c/nuk/admin/media', async (route) => {
      uploads++
      await route.fallback()
    })
    await choosePoster(page, 500, 500)
    const dialog = page.getByRole('dialog', { name: 'Frame the poster' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Upload poster' }).waitFor()
    expect(uploads).toBe(0)
  })

  it('saves a draft of a whole-menu amount off with no end date', async () => {
    const { page, sent } = await open('/admin/promotions/new', { promotions: [] })
    await page.getByLabel('Name').fill('Weekend')
    await page.getByRole('radio', { name: /Amount off/ }).click()
    const amount = page.getByRole('spinbutton').first()
    await amount.fill('1.5')
    await amount.blur()
    await page.getByRole('radio', { name: /Whole menu/ }).click()
    await page.getByRole('checkbox', { name: 'No end date' }).click()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await toast(page, 'Draft "Weekend" saved').waitFor()
    expect(sent[0]!.body).toMatchObject({ discount: { kind: 'amount', amountMinor: 150 }, scope: 'menu', itemIds: [], categoryIds: [], endsOn: null, publish: false })
  })

  it('shows a live promotion\'s results, and ends it after asking', async () => {
    const { page, sent } = await open(`/admin/promotions/${COFFEE_WEEK.id}`, { results: { orders: 12, units: 30, discountMinor: 2100, salesMinor: 8400, bySource: { telegram: 0, facebook: 0 } } })
    const results = page.getByRole('region', { name: 'Results' })
    await results.getByText('$21.00').waitFor()
    expect(await results.textContent()).toContain('12')
    expect(await results.textContent()).toContain('$84.00')

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'End now' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'End promotion' }).click()
    await toast(page, 'Promotion "Coffee week" ended').waitFor()
    expect(sent).toEqual([{ method: 'POST', path: 'promo-1/end', body: { version: 1 } }])
    await page.getByRole('link', { name: 'Run again' }).waitFor()
  })

  it('edits a live promotion; someone else\'s save first offers Reload and keeps the input', async () => {
    const { page, sent } = await open(`/admin/promotions/${COFFEE_WEEK.id}/edit`, { conflictOnce: true })
    await page.getByText('This promotion is live').waitFor()
    const name = page.getByLabel('Name')
    await name.fill('Coffee fortnight')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByText('Someone else changed this promotion').waitFor()
    await page.getByRole('button', { name: 'Reload' }).click()
    expect(await name.inputValue()).toBe('Coffee fortnight')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await toast(page, '"Coffee fortnight" saved').waitFor()
    expect(sent.map(s => (s.body as { version: number }).version)).toEqual([1, 2])
  })

  it('deletes a draft from the library after asking', async () => {
    const { page, sent } = await open('/admin/promotions')
    await page.getByRole('button', { name: 'Actions for Tea time' }).click()
    await page.getByRole('menuitem', { name: 'Delete draft' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete draft' }).click()
    await toast(page, 'Draft "Tea time" deleted').waitFor()
    expect(sent).toEqual([{ method: 'DELETE', path: 'promo-3', body: { version: 1 } }])
    await expect.poll(() => card(page, 'Tea time').count()).toBe(0)
  })

  it('asks before leaving the editor with changes', async () => {
    const { page } = await open('/admin/promotions/new', { promotions: [] })
    await page.getByLabel('Name').fill('Half done')
    await page.getByRole('link', { name: 'Back to promotions' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('shows a branch added meanwhile: a branch change reaches the editor\'s branches', async () => {
    const { page, api } = await open('/admin/promotions/new', { promotions: [] })
    await page.getByLabel('Name').waitFor()
    // One branch: nothing to choose, so no Branches card.
    expect(await page.getByRole('radiogroup', { name: 'Branches' }).count()).toBe(0)

    // A second branch is saved in another tab of this browser: its invalidate('branches') arrives
    // as the data-changed message (plugins/data-freshness.client.ts).
    api.set({ 'GET /admin/branches/options': () => [RIVERSIDE, AIRPORT] })
    await page.evaluate(() => new BroadcastChannel('nuk-cafe-admin:data-changed').postMessage({ features: ['branches'] }))

    await page.getByRole('radiogroup', { name: 'Branches' }).getByText('Chosen branches').click()
    await page.getByRole('checkbox', { name: 'Airport' }).waitFor()
  })
})
