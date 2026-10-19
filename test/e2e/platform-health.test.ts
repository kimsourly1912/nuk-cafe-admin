import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { PlatformHealth } from '../../shared/contracts/platform-health'
import type { PlatformSession } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { mockApi, setupE2e } from './support/mock-api'

await setupE2e()

// The platform console's System health (step P4, D192), against a mocked API: the scheduled jobs,
// the outbox per kind and cafe, failing Telegram messages and Bakong token expiry, each cafe
// linking to its page. That no secret ever leaves the server is the server's test
// (tenants.health.test.ts).

const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }
const NUK = { id: 'cafe-1', name: 'NUK Cafe', slug: 'nuk' }
const BROWN = { id: 'cafe-2', name: 'Brown Bean', slug: 'brown-bean' }
const AT = '2026-10-19T04:30:00.000Z'

const job = (name: string, schedule: string, overrides: Partial<PlatformHealth['jobs'][number]> = {}): PlatformHealth['jobs'][number] =>
  ({ job: name, schedule, state: 'ok', lastRunAt: AT, lastSuccessAt: AT, lastFailureAt: null, failuresInARow: 0, ...overrides })

const UNHEALTHY: PlatformHealth = {
  checkedAt: AT,
  outbox: {
    waiting: 1,
    failing: 1,
    dead: 2,
    groups: [
      { kind: 'orders.event', cafe: BROWN, waiting: 0, failing: 0, dead: 1, oldestAt: AT },
      { kind: 'identity.reset-password', cafe: null, waiting: 0, failing: 0, dead: 1, oldestAt: AT },
      { kind: 'orders.event', cafe: NUK, waiting: 1, failing: 1, dead: 0, oldestAt: AT },
    ],
  },
  jobs: [
    job('platform:deliver-outbox', '* * * * *'),
    job('orders:expire-unpaid', '* * * * *', { state: 'failing', lastSuccessAt: null, lastFailureAt: AT, failuresInARow: 3 }),
    job('media:purge-temporary', '5 * * * *', { state: 'never', lastRunAt: null, lastSuccessAt: null }),
  ],
  telegram: [{ cafe: NUK, failed: 2, retrying: 1, newestFailingAt: AT }],
  bakong: [
    { cafe: BROWN, expiresAt: '2026-10-18T00:00:00.000Z', state: 'expired' },
    { cafe: NUK, expiresAt: '2026-10-25T00:00:00.000Z', state: 'soon' },
  ],
}
const HEALTHY: PlatformHealth = {
  checkedAt: AT,
  outbox: { waiting: 0, failing: 0, dead: 0, groups: [] },
  jobs: [job('platform:deliver-outbox', '* * * * *')],
  telegram: [],
  bakong: [],
}

async function open(handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    'GET /platform/me': () => SUPERADMIN,
    'GET /platform/health': () => UNHEALTHY,
    ...handlers,
  })
  await page.goto(url('/platform/health'), { waitUntil: 'hydration' })
  return { page, api }
}

describe('system health', () => {
  it('is in the sidebar, and says what needs a look first', async () => {
    const { page } = await open()
    await page.getByRole('navigation').first().getByRole('link', { name: 'System health' }).waitFor()
    const problems = page.getByTestId('health-problems')
    await problems.getByText(/1 scheduled job is failing\. 2 outbox messages were given up on\. 1 cafe has failing Telegram messages\. 1 Bakong token has expired\./).waitFor()
  })

  it('lists every scheduled job with its state, the outbox per kind and cafe, Telegram and Bakong, each cafe linked', async () => {
    const { page } = await open()
    const jobs = page.getByRole('list', { name: 'Scheduled jobs' })
    await jobs.getByRole('listitem').filter({ hasText: 'Expire unpaid orders' }).getByText('3 in a row').waitFor()
    await jobs.getByRole('listitem').filter({ hasText: 'Expire unpaid orders' }).getByText('Failing').waitFor()
    await jobs.getByRole('listitem').filter({ hasText: 'Clean up unused uploads' }).getByText('No run recorded').waitFor()
    await jobs.getByRole('listitem').filter({ hasText: 'Deliver messages and emails' }).getByText('Every minute').waitFor()

    const outbox = page.getByRole('list', { name: 'Outbox by kind and cafe' })
    await outbox.getByRole('listitem').filter({ hasText: 'Password reset emails' }).getByText(/The platform/).waitFor()
    await outbox.getByRole('listitem').filter({ hasText: 'Brown Bean' }).getByText('1 given up').waitFor()

    await page.getByRole('list', { name: 'Failing Telegram messages by cafe' }).getByText(/2 given up · 1 retrying/).waitFor()
    const bakong = page.getByRole('list', { name: 'Bakong tokens by cafe' })
    await bakong.getByRole('listitem').filter({ hasText: 'Brown Bean' }).getByText('Expired').waitFor()
    await bakong.getByRole('listitem').filter({ hasText: 'NUK Cafe' }).getByText('Expires soon').waitFor()

    expect(await page.getByRole('list', { name: 'Failing Telegram messages by cafe' }).getByRole('link', { name: 'NUK Cafe' }).getAttribute('href')).toBe('/platform/cafes/cafe-1')
  })

  it('a healthy platform says nothing is failing; Refresh reads it again', async () => {
    let reads = 0
    const { page } = await open({ 'GET /platform/health': () => {
      reads++
      return HEALTHY
    } })
    await page.getByText('Nothing is failing').waitFor()
    await page.getByText('Everything has been sent.').waitFor()
    await page.getByText('No cafe\'s Telegram messages are failing.').waitFor()
    await page.getByText('No cafe has saved a Bakong token.').waitFor()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect.poll(() => reads).toBe(2)
  })

  it('on a phone, nothing scrolls sideways', async () => {
    const { page } = await open({}, 390)
    await page.getByRole('list', { name: 'Scheduled jobs' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

describe('accessibility', () => {
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
  async function axeFindings(page: Page): Promise<string[]> {
    await page.evaluate(axeSource)
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).slice(0, 4).join(', ')}`)
    })
  }

  it.each([1440, 390])('the page with problems and a healthy one meet the rules in light and dark, at %ipx', async (width) => {
    for (const health of [UNHEALTHY, HEALTHY]) {
      const { page } = await open({ 'GET /platform/health': () => health }, width)
      await page.getByRole('list', { name: 'Scheduled jobs' }).waitFor()
      await page.mouse.move(0, 0)
      expect(await axeFindings(page)).toEqual([])
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await page.waitForTimeout(500)
      expect(await axeFindings(page)).toEqual([])
    }
  })
})
