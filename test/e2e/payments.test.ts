import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { BakongConnectionTest, ExchangeRate, ExchangeRates, KhqrSettings } from '../../shared/contracts/orders'
import { failures, MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The admin Payments page (D102): the riel rate for cash payments, and its history.

const rate = (khrPerUsd: number, effectiveFrom: string, name = 'Kim'): ExchangeRate => ({ khrPerUsd, effectiveFrom, setBy: { name } })
const HISTORY = [rate(4100, '2026-09-29T02:00:00.000Z'), rate(4080, '2026-09-28T01:55:00.000Z', 'Dara')]

/** KHQR on, with the cafe's own Bakong token saved (D148), at version 3. */
const WITH_TOKEN: KhqrSettings = { version: 1, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'], updatedAt: '2026-10-01T05:00:00.000Z', updatedBy: { name: 'Kim' }, automaticCheck: true, token: { version: 3, expiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(), setAt: '2026-10-01T05:00:00.000Z', setBy: { name: 'Kim' } }, tokenStorage: true }
const KHQR_OFF: KhqrSettings = { version: 0, enabled: false, accountId: null, merchantName: null, merchantCity: null, currencies: [], updatedAt: null, updatedBy: null, automaticCheck: false, token: null, tokenStorage: true }

async function open(start: ExchangeRates, khqr: KhqrSettings = KHQR_OFF, options: { conflictOnce?: boolean, bakongTest?: BakongConnectionTest[], refuseToken?: boolean } = {}) {
  let state = start
  let khqrState = khqr
  let conflict = options.conflictOnce ?? false
  const posted: unknown[] = []
  const saved: unknown[] = []
  const tokenCalls: string[] = []
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
      khqrState = { ...input, version: input.version + 1, updatedAt: '2026-10-02T05:00:00.000Z', updatedBy: { name: 'Admin' }, automaticCheck: khqrState.automaticCheck, token: khqrState.token, tokenStorage: khqrState.tokenStorage }
      return khqrState
    },
    'POST /admin/khqr/test': () => options.bakongTest?.shift() ?? { status: 'connected' },
    // The cafe's own token (D148): sent once, answered back only as its date and who set it.
    'PUT /admin/khqr/token': ({ body }) => {
      tokenCalls.push(`PUT ${JSON.stringify(body)}`)
      if (options.refuseToken) throw new MockFailure(422, 'VALIDATION_FAILED', 'This Bakong token has expired.', { token: ['Expired on 2026-09-01'] })
      const version = (body as { version: number }).version
      khqrState = { ...khqrState, automaticCheck: true, token: { version: version + 1, expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(), setAt: '2026-10-09T05:00:00.000Z', setBy: { name: 'Admin' } } }
      return khqrState
    },
    'DELETE /admin/khqr/token': ({ body }) => {
      tokenCalls.push(`DELETE ${JSON.stringify(body)}`)
      khqrState = { ...khqrState, automaticCheck: false, token: null }
      return khqrState
    },
    'GET /admin/exchange-rates': () => state,
    'POST /admin/exchange-rates': ({ body }) => {
      posted.push(body)
      const next = rate((body as { khrPerUsd: number }).khrPerUsd, '2026-09-29T05:00:00.000Z', 'Admin')
      state = { current: next, history: [next, ...state.history] }
      return state
    },
  })
  await page.goto(url('/c/nuk/admin/payments'), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Riel exchange rate' }).waitFor()
  return { page, posted, saved, tokenCalls }
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
    const settings: KhqrSettings = { version: 1, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'], updatedAt: '2026-10-01T05:00:00.000Z', updatedBy: { name: 'Kim' }, automaticCheck: false, token: null, tokenStorage: true }
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

  it('KHQR: the automatic check with Bakong (D131) is On with the cafe\'s token (D148); its expiry, who set it, and Test connection', async () => {
    const settings: KhqrSettings = { ...WITH_TOKEN, token: { ...WITH_TOKEN.token!, expiresAt: new Date(Date.now() + 4.5 * 24 * 3_600_000).toISOString() } }
    const { page } = await open({ current: null, history: [] }, settings, {
      bakongTest: [{ status: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' }, { status: 'unavailable', problem: 'key', detail: null }, { status: 'connected' }],
    })
    await page.getByText(/The counter records a KHQR payment as soon as Bakong confirms it/).waitFor()
    // The token's expiry, read from it on the server (D132): amber within 14 days.
    await page.getByText(/^Token expires \d{1,2} \w{3} \d{4} · 5 days left$/).waitFor()
    await page.getByText(/replace it here before then/).waitFor()
    await page.getByText('Token saved 1 Oct 2026 by Kim. It\'s stored encrypted and isn\'t shown again.').waitFor()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText(/Bakong refused this server\. Bakong may answer only servers in Cambodia/).waitFor()
    await page.getByText('Bakong refused this server (403)').waitFor()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText(/The saved token can't be read on this server any more/).waitFor()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('Connected: Bakong answered this server.').waitFor()
  })

  it('KHQR: without a token the check is Off; Add token sends it once, and the page never shows it', async () => {
    const value = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE5OTk5OTk5OTl9.c2ln'
    const { page, tokenCalls } = await open({ current: null, history: [] }, { ...WITH_TOKEN, automaticCheck: false, token: null })
    await page.getByText(/Add your Bakong token to check payments automatically/).waitFor()
    expect(await page.getByRole('button', { name: 'Test connection' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Add token' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add the Bakong token' })
    await dialog.getByRole('button', { name: 'Save token' }).click()
    await dialog.getByText('Paste the token from Bakong\'s developer portal').waitFor()
    await dialog.getByLabel('Token').fill(`  ${value}\n`)
    await dialog.getByRole('button', { name: 'Save token' }).click()
    await toast(page, 'Bakong token saved: the counter checks KHQR payments with Bakong').waitFor()
    expect(tokenCalls).toEqual([`PUT ${JSON.stringify({ version: 0, token: value })}`])
    await page.getByRole('button', { name: 'Replace token' }).waitFor()
    await page.getByRole('button', { name: 'Test connection' }).waitFor()
    expect(await page.content()).not.toContain(value)
  })

  it('KHQR: an expired token is refused on its field and the dialog stays open; Remove asks first', async () => {
    const refused = await open({ current: null, history: [] }, { ...WITH_TOKEN, automaticCheck: false, token: null }, { refuseToken: true })
    await refused.page.getByRole('button', { name: 'Add token' }).click({ timeout: 10_000 })
    const dialog = refused.page.getByRole('dialog', { name: 'Add the Bakong token' })
    await dialog.getByLabel('Token').fill('expired.token.value', { timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Save token' }).click({ timeout: 10_000 })
    await dialog.getByText('Expired on 2026-09-01').waitFor({ timeout: 10_000 })

    const { page, tokenCalls } = await open({ current: null, history: [] }, WITH_TOKEN)
    await page.getByRole('button', { name: 'Remove token' }).click({ timeout: 10_000 })
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Remove token' }).click({ timeout: 10_000 })
    await toast(page, 'Bakong token removed: cashiers confirm KHQR payments by hand').waitFor({ timeout: 10_000 })
    expect(tokenCalls).toEqual([`DELETE ${JSON.stringify({ version: 3 })}`])
    await page.getByRole('button', { name: 'Add token' }).waitFor({ timeout: 10_000 })
  })

  it('KHQR: a server that can\'t store tokens says so and offers none', async () => {
    const { page } = await open({ current: null, history: [] }, { ...WITH_TOKEN, automaticCheck: false, token: null, tokenStorage: false })
    await page.getByText('Tokens can\'t be saved on this server yet').waitFor()
    expect(await page.getByRole('button', { name: 'Add token' }).count()).toBe(0)
  })

  it('is in the sidebar', async () => {
    const { page } = await open({ current: HISTORY[0]!, history: HISTORY })
    expect(await page.getByRole('link', { name: 'Payments' }).getAttribute('href')).toBe('/c/nuk/admin/payments')
  })
})
