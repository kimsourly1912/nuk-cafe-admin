import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { BakongConnectionTest, ExchangeRate, ExchangeRates, KhqrSettings } from '../../shared/contracts/orders'
import { failures, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The admin Payments page (D102): the riel rate for cash payments, and its history.

const rate = (khrPerUsd: number, effectiveFrom: string, name = 'Kim'): ExchangeRate => ({ khrPerUsd, effectiveFrom, setBy: { name } })
const HISTORY = [rate(4100, '2026-09-29T02:00:00.000Z'), rate(4080, '2026-09-28T01:55:00.000Z', 'Dara')]

const KHQR_OFF: KhqrSettings = { version: 0, enabled: false, accountId: null, merchantName: null, merchantCity: null, currencies: [], updatedAt: null, updatedBy: null, automaticCheck: false, tokenExpiresAt: null }

async function open(start: ExchangeRates, khqr: KhqrSettings = KHQR_OFF, options: { conflictOnce?: boolean, bakongTest?: BakongConnectionTest[] } = {}) {
  let state = start
  let khqrState = khqr
  let conflict = options.conflictOnce ?? false
  const posted: unknown[] = []
  const saved: unknown[] = []
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, {
    'GET /admin/khqr': () => khqrState,
    'PUT /admin/khqr': ({ body }) => {
      saved.push(body)
      if (conflict) {
        conflict = false
        khqrState = { ...khqrState, version: khqrState.version + 1, merchantName: 'Someone else' }
        throw failures.conflict('VERSION_CONFLICT', 'The KHQR settings were changed by someone else. Reload it and try again.')
      }
      const input = body as KhqrSettings
      khqrState = { ...input, version: input.version + 1, updatedAt: '2026-10-02T05:00:00.000Z', updatedBy: { name: 'Admin' }, automaticCheck: khqrState.automaticCheck, tokenExpiresAt: khqrState.tokenExpiresAt }
      return khqrState
    },
    'POST /admin/khqr/test': () => options.bakongTest?.shift() ?? { status: 'connected' },
    'GET /admin/exchange-rates': () => state,
    'POST /admin/exchange-rates': ({ body }) => {
      posted.push(body)
      const next = rate((body as { khrPerUsd: number }).khrPerUsd, '2026-09-29T05:00:00.000Z', 'Admin')
      state = { current: next, history: [next, ...state.history] }
      return state
    },
  })
  await page.goto(url('/admin/payments'), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Riel exchange rate' }).waitFor()
  return { page, posted, saved }
}

describe('Payments', () => {
  it('shows the current rate and its history; a new rate is saved and becomes current', async () => {
    const { page, posted } = await open({ current: HISTORY[0]!, history: HISTORY })
    await page.getByText('៛4,100', { exact: true }).first().waitFor()
    await page.getByText(/Set by Kim/).waitFor()
    expect(await page.locator('tbody tr').count()).toBe(2)
    // The same rate: nothing to save.
    expect(await page.getByRole('button', { name: 'Save rate' }).isDisabled()).toBe(true)

    const field = page.getByRole('spinbutton', { name: 'Riel per $1' })
    await field.fill('4150')
    await field.blur()
    await page.getByRole('button', { name: 'Save rate' }).click()
    await toast(page, 'Riel rate set to ៛4,150 per $1').waitFor()
    expect(posted).toEqual([{ khrPerUsd: 4150 }])
    await expect.poll(() => page.locator('tbody tr').count()).toBe(3)
  })

  it('without a rate, says the counter can\'t take riel; the first rate is saved', async () => {
    const { page, posted } = await open({ current: null, history: [] })
    await page.getByText('The counter can\'t take cash in riel until a rate is set.').waitFor()
    await page.getByText('No rate has been set yet.').waitFor()
    const field = page.getByRole('spinbutton', { name: 'Riel per $1' })
    await field.fill('4100')
    await field.blur()
    await page.getByRole('button', { name: 'Save rate' }).click()
    await toast(page, 'Riel rate set to ៛4,100 per $1').waitFor()
    expect(posted).toEqual([{ khrPerUsd: 4100 }])
  })

  it('KHQR at the counter (D130): filled in and saved with the version read; the account is lower-cased', async () => {
    const { page, saved } = await open({ current: HISTORY[0]!, history: HISTORY })
    const form = page.getByRole('region', { name: 'KHQR at the counter' })
    await form.getByLabel('Bakong account ID').fill('NukCafe@ACLB')
    await form.getByLabel('Name customers see').fill('NUK Cafe')
    await form.getByRole('checkbox', { name: /Riel/ }).check()
    await form.getByRole('button', { name: 'Save KHQR settings' }).click()
    await toast(page, 'KHQR settings saved: the counter shows a QR for each order').waitFor()
    expect(saved).toEqual([{ version: 0, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD', 'KHR'] }])
  })

  it('KHQR: refuses a Khmer name or an ID without @bank before sending; someone else\'s save shows Reload, which keeps the input', async () => {
    const settings: KhqrSettings = { version: 1, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'], updatedAt: '2026-10-01T05:00:00.000Z', updatedBy: { name: 'Kim' }, automaticCheck: false, tokenExpiresAt: null }
    const { page, saved } = await open({ current: HISTORY[0]!, history: HISTORY }, settings, { conflictOnce: true })
    const form = page.getByRole('region', { name: 'KHQR at the counter' })
    await expect.poll(() => form.getByLabel('Bakong account ID').inputValue()).toBe('nukcafe@aclb')
    await form.getByLabel('Bakong account ID').fill('nukcafe')
    await form.getByLabel('Name customers see').fill('ហាងកាហ្វេ')
    await form.getByRole('button', { name: 'Save KHQR settings' }).click()
    await form.getByText('A Bakong account ID looks like name@bank').waitFor({ timeout: 5000 })
    await form.getByText('Latin letters, digits and simple punctuation only').waitFor({ timeout: 5000 })
    expect(saved).toEqual([])

    await form.getByLabel('Bakong account ID').fill('newcafe@abaa')
    await form.getByLabel('Name customers see').fill('New Cafe')
    // UForm checks typed fields after a moment: wait for the errors to go before clicking below them.
    await form.getByText('Latin letters, digits and simple punctuation only').waitFor({ state: 'hidden', timeout: 5000 })
    await form.getByText('A Bakong account ID looks like name@bank').waitFor({ state: 'hidden', timeout: 5000 })
    await form.getByRole('button', { name: 'Save KHQR settings' }).click()
    await form.getByText('Someone else saved the KHQR settings meanwhile.').waitFor({ timeout: 5000 })
    await form.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => form.getByLabel('Name customers see').inputValue()).toBe('New Cafe')
    await form.getByRole('button', { name: 'Save KHQR settings' }).click()
    await toast(page, 'KHQR settings saved: the counter shows a QR for each order').waitFor({ timeout: 5000 })
    expect(saved.at(-1)).toMatchObject({ version: 2, accountId: 'newcafe@abaa', merchantName: 'New Cafe' })
  })

  it('KHQR: the automatic check with Bakong (D131) is Off without the token; On, Test connection says whether Bakong answers', async () => {
    const off = await open({ current: null, history: [] })
    await off.page.getByText('Automatic check with Bakong').waitFor()
    await off.page.getByText(/To check automatically, the owner sets the Bakong token as the server secret NUXT_BAKONG_TOKEN/).waitFor()
    expect(await off.page.getByRole('button', { name: 'Test connection' }).count()).toBe(0)

    const settings: KhqrSettings = { version: 1, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'], updatedAt: '2026-10-01T05:00:00.000Z', updatedBy: { name: 'Kim' }, automaticCheck: true, tokenExpiresAt: new Date(Date.now() + 4.5 * 24 * 3_600_000).toISOString() }
    const { page } = await open({ current: null, history: [] }, settings, {
      bakongTest: [{ status: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' }, { status: 'connected' }],
    })
    await page.getByText(/The counter records a KHQR payment as soon as Bakong confirms it/).waitFor()
    // The token's expiry, read from it on the server (D132): amber within 14 days.
    await page.getByText(/^Token expires \d{1,2} \w{3} \d{4} · 5 days left$/).waitFor()
    await page.getByText(/replace the server secret NUXT_BAKONG_TOKEN before then/).waitFor()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText(/Bakong refused this server\. Bakong may answer only servers in Cambodia/).waitFor()
    await page.getByText('Bakong refused this server (403)').waitFor()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('Connected: Bakong answered this server.').waitFor()
  })

  it('is in the sidebar', async () => {
    const { page } = await open({ current: HISTORY[0]!, history: HISTORY })
    expect(await page.getByRole('link', { name: 'Payments' }).getAttribute('href')).toBe('/admin/payments')
  })
})
