import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { NewTelegramLink, TelegramDestination, TelegramLink, TelegramOverview } from '../../shared/contracts/notifications'
import type { ReportBranch, ReportSummary } from '../../shared/contracts/reports'
import type { MockHandler } from './support/mock-api'
import { MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Telegram (step 8.1c, D112) on a mocked API: the Telegram page (connect, test, disconnect) and
// Send to Telegram from a report.

const destinationOf = (id: string, title: string, overrides: Partial<TelegramDestination> = {}): TelegramDestination => ({
  id,
  kind: 'group',
  title,
  status: 'connected',
  connectedBy: 'Kim',
  connectedAt: '2026-09-30T02:00:00.000Z',
  lastSentAt: null,
  blockedAt: null,
  version: 1,
  ...overrides,
})

const GROUP = destinationOf('dest-1', 'NUK Riverside Staff')
const PRIVATE_BLOCKED = destinationOf('dest-2', 'Sokha Chan', { kind: 'private', status: 'blocked', blockedAt: '2026-09-30T03:00:00.000Z' })

const linkOf = (kind: 'private' | 'group', overrides: Partial<TelegramLink> = {}): TelegramLink =>
  ({ id: 'link-1', kind, status: 'waiting', expiresAt: '2026-09-30T05:10:00.000Z', chat: null, destinationId: null, ...overrides })

async function openTelegram(overview: TelegramOverview, handlers: Record<string, MockHandler> = {}, width = 1440) {
  const page = await createPage()
  await page.setViewportSize({ width, height: 900 })
  const api = await mockApi(page, { 'GET /admin/telegram': () => overview, ...handlers })
  await page.goto(url('/admin/telegram'), { waitUntil: 'hydration' })
  return { page, api }
}

describe('Telegram page', () => {
  it('says when Telegram isn\'t set up, with the buttons off', async () => {
    const { page } = await openTelegram({ enabled: false, botUsername: null, destinations: [] })
    await page.getByText('Telegram isn\'t set up for this app yet.').waitFor()
    expect(await page.getByRole('button', { name: 'Connect Telegram' }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Connect a group' }).isDisabled()).toBe(true)
    expect(await page.getByRole('link', { name: 'Telegram' }).getAttribute('href')).toBe('/admin/telegram')
  })

  it('connects a private chat: the link opens Telegram, the page notices when it\'s done', async () => {
    let overview: TelegramOverview = { enabled: true, botUsername: 'NukCafeBot', destinations: [] }
    let polls = 0
    const created: unknown[] = []
    const { page } = await openTelegram(overview, {
      'GET /admin/telegram': () => overview,
      'POST /admin/telegram/links': ({ body }) => {
        created.push(body)
        return { ...linkOf('private'), url: 'https://t.me/NukCafeBot?start=abc' } satisfies NewTelegramLink
      },
      'GET /admin/telegram/links/{id}': () => {
        if (++polls < 2) return linkOf('private')
        overview = { ...overview, destinations: [destinationOf('dest-3', 'Sokha Chan', { kind: 'private' })] }
        return linkOf('private', { status: 'connected', chat: { title: 'Sokha Chan', memberCount: null }, destinationId: 'dest-3' })
      },
    })
    await page.getByText('No chats yet.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Connect Telegram' }).click()
    const dialog = page.getByRole('dialog')
    expect(await dialog.getByRole('link', { name: 'Open in Telegram' }).getAttribute('href')).toBe('https://t.me/NukCafeBot?start=abc')
    await dialog.getByText('Waiting for Telegram…').waitFor()
    await dialog.getByText('Press Start in the chat with @NukCafeBot.').waitFor()
    expect(created).toEqual([{ kind: 'private' }])

    await toast(page, 'Sokha Chan is connected').waitFor({ timeout: 10_000 })
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    await page.getByText('Private chat · Nothing sent yet', { exact: false }).waitFor()
  })

  it('a group waits for the admin\'s confirmation; Cancel makes the bot leave', async () => {
    const posted: string[] = []
    const { page } = await openTelegram({ enabled: true, botUsername: 'NukCafeBot', destinations: [] }, {
      'POST /admin/telegram/links': () => ({ ...linkOf('group'), url: 'https://t.me/NukCafeBot?startgroup=abc' }),
      'GET /admin/telegram/links/{id}': () => linkOf('group', { status: 'confirm', chat: { title: 'NUK Riverside Staff', memberCount: 8 } }),
      'POST /admin/telegram/links/{id}/cancel': ({ url: u }) => {
        posted.push(u.pathname)
        return linkOf('group', { status: 'cancelled' })
      },
      'POST /admin/telegram/links/{id}/confirm': ({ url: u }) => {
        posted.push(u.pathname)
        return GROUP
      },
    })
    await page.getByRole('button', { name: 'Connect a group' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('choose your staff group', { exact: false }).waitFor()
    await dialog.getByText('(group, 8 members)').waitFor({ timeout: 10_000 })
    await dialog.getByText('Everyone in this group sees what\'s sent there.').waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => posted).toEqual(['/api/admin/telegram/links/link-1/cancel'])

    await page.getByRole('button', { name: 'Connect a group' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Connect' }).click({ timeout: 10_000 })
    await toast(page, 'NUK Riverside Staff is connected').waitFor()
    expect(posted.at(-1)).toBe('/api/admin/telegram/links/link-1/confirm')
  })

  it('Send test, a blocked chat\'s Reconnect, and Disconnect asked first with the version', async () => {
    const disconnected: unknown[] = []
    const { page } = await openTelegram({ enabled: true, botUsername: 'NukCafeBot', destinations: [GROUP, PRIVATE_BLOCKED] }, {
      'POST /admin/telegram/destinations/{id}/test': () => ({ ...GROUP, lastSentAt: '2026-09-30T05:00:00.000Z' }),
      'POST /admin/telegram/destinations/{id}/disconnect': ({ body }) => {
        disconnected.push(body)
        return null
      },
    })
    await page.getByText('The bot was blocked in this chat.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Reconnect' }).waitFor()
    await page.getByRole('button', { name: 'Send test' }).click()
    await toast(page, 'Test sent to NUK Riverside Staff').waitFor()

    await page.getByRole('button', { name: 'Actions for NUK Riverside Staff' }).click()
    await page.getByRole('menuitem', { name: 'Disconnect' }).click()
    await page.getByText('Stop sending to NUK Riverside Staff?').waitFor()
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await toast(page, 'NUK Riverside Staff is disconnected').waitFor()
    expect(disconnected).toEqual([{ version: 1 }])
  })
})

describe('Send to Telegram', () => {
  const TODAY = '2026-09-30'
  const BRANCH: ReportBranch = { id: 'branch-1', name: 'Riverside', timeZone: 'Asia/Phnom_Penh', today: TODAY }
  const summary = {
    branch: { id: BRANCH.id, name: BRANCH.name, timeZone: BRANCH.timeZone },
    period: { from: TODAY, to: TODAY, start: '', end: '' },
    asOf: '2026-09-30T07:35:00.000Z',
    paid: { salesMinor: 4100, orders: 5, averageMinor: 820 },
    refunds: { amountMinor: 0, orders: 0 },
    netSalesMinor: 4100,
    previousPaidSalesMinor: 0,
    trend: { unit: 'hour', points: [] },
    payments: [],
    bestSellers: [],
    cancelledUnpaid: { customer: 0, cafe: 0, system: 0 },
    ordersPlaced: 5,
    current: null,
  } satisfies ReportSummary

  it('previews the server\'s message, warns about a group, and a failed send is tried again with the same key', async () => {
    const sends: { body: unknown, key: string | undefined }[] = []
    const previews: unknown[] = []
    const page = await createPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockApi(page, {
      'GET /admin/reports/branches': () => [BRANCH],
      'GET /admin/reports/summary': () => summary,
      'GET /admin/reports/destinations': () => ({ enabled: true, destinations: [GROUP, PRIVATE_BLOCKED] }),
      'POST /admin/reports/telegram-preview': ({ body }) => {
        previews.push(body)
        return { text: 'Summary · Riverside\nWed 30 Sep 2026\n\nPaid sales $41.00 · 5 orders' }
      },
      'POST /admin/reports/send': ({ body, headers }) => {
        sends.push({ body, key: headers['idempotency-key'] })
        if (sends.length === 1) throw new MockFailure(424, 'TELEGRAM_UNAVAILABLE', 'Telegram didn\'t accept the message. Try again in a moment.')
        return { destination: { id: GROUP.id, title: GROUP.title }, sentAt: '2026-09-30T07:36:00.000Z' }
      },
    })
    await page.goto(url('/admin/reports/summary'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Send to Telegram' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Send Summary · Today (Wed 30 Sep 2026)').waitFor()
    await dialog.getByText('Paid sales $41.00 · 5 orders').waitFor()
    expect(previews).toEqual([{ kind: 'summary', query: { branchId: 'branch-1', from: TODAY, to: TODAY } }])
    await dialog.getByText('Everyone in NUK Riverside Staff will see these figures.').waitFor()
    expect(await dialog.getByRole('radio', { name: /Sokha Chan/ }).isDisabled()).toBe(true)

    await dialog.getByRole('checkbox', { name: 'Attach CSV' }).check()
    await dialog.getByRole('button', { name: 'Send' }).click()
    await dialog.getByText('Telegram didn\'t accept the message.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await toast(page, 'Sent to NUK Riverside Staff').waitFor()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)

    expect(sends).toHaveLength(2)
    expect(sends[0]!.body).toEqual({ report: { kind: 'summary', query: { branchId: 'branch-1', from: TODAY, to: TODAY } }, destinationId: 'dest-1', attachCsv: true })
    expect(sends[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(sends[1]!.key).toBe(sends[0]!.key)
  })

  it('isn\'t offered where Telegram isn\'t set up', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockApi(page, {
      'GET /admin/reports/branches': () => [BRANCH],
      'GET /admin/reports/summary': () => summary,
      'GET /admin/reports/destinations': () => ({ enabled: false, destinations: [] }),
    })
    await page.goto(url('/admin/reports/summary'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Print' }).waitFor()
    expect(await page.getByRole('button', { name: 'Send to Telegram' }).count()).toBe(0)
  })
})
