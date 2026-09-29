import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { ExchangeRate, ExchangeRates } from '../../shared/contracts/orders'
import { mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The admin Payments page (D102): the riel rate for cash payments, and its history.

const rate = (khrPerUsd: number, effectiveFrom: string, name = 'Kim'): ExchangeRate => ({ khrPerUsd, effectiveFrom, setBy: { name } })
const HISTORY = [rate(4100, '2026-09-29T02:00:00.000Z'), rate(4080, '2026-09-28T01:55:00.000Z', 'Dara')]

async function open(start: ExchangeRates) {
  let state = start
  const posted: unknown[] = []
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, {
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
  return { page, posted }
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

  it('is in the sidebar', async () => {
    const { page } = await open({ current: HISTORY[0]!, history: HISTORY })
    expect(await page.getByRole('link', { name: 'Payments' }).getAttribute('href')).toBe('/admin/payments')
  })
})
