import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { NewTelegramLink, NotificationDelivery, NotificationRule, SetNotificationRuleInput, TelegramDestination, TelegramLink, TelegramOverview } from '../../shared/contracts/notifications'
import type { ReportBranch, ReportSummary } from '../../shared/contracts/reports'
import type { MockHandler } from './support/mock-api'
import { MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Telegram (steps 8.1c and 8.1d, D112, D113) on a mocked API: the Telegram page (connect, test,
// disconnect, notifications, delivery history) and Send to Telegram from a report.

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
  const api = await mockApi(page, { 'GET /admin/telegram': () => overview, 'GET /admin/telegram/deliveries': () => ({ deliveries: [] }), ...handlers })
  await page.goto(url('/admin/telegram'), { waitUntil: 'hydration' })
  return { page, api }
}

describe('Telegram page', () => {
  it('says when Telegram isn\'t set up, with the buttons off', async () => {
    const { page } = await openTelegram({ enabled: false, botUsername: null, destinations: [], rules: [] })
    await page.getByText('Telegram isn\'t set up for this app yet.').waitFor()
    expect(await page.getByRole('button', { name: 'Connect Telegram' }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Connect a group' }).isDisabled()).toBe(true)
    expect(await page.getByRole('link', { name: 'Telegram' }).getAttribute('href')).toBe('/admin/telegram')
  })

  it('connects a private chat: the link opens Telegram, the page notices when it\'s done', async () => {
    let overview: TelegramOverview = { enabled: true, botUsername: 'NukCafeBot', destinations: [], rules: [] }
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
    // Each link is new, as on the server: the second dialog never shares the first one's polled link.
    let links = 0
    // The bot joins the group only once the test has read the instructions: answering "confirm" on
    // the first poll let a loaded runner skip the waiting step before the test looked (10.10).
    let joined = false
    const { page } = await openTelegram({ enabled: true, botUsername: 'NukCafeBot', destinations: [], rules: [] }, {
      'POST /admin/telegram/links': () => ({ ...linkOf('group', { id: `link-${++links}` }), url: 'https://t.me/NukCafeBot?startgroup=abc' }),
      'GET /admin/telegram/links/{id}': ({ url: u }) => {
        const id = u.pathname.split('/').at(-1)!
        return joined ? linkOf('group', { id, status: 'confirm', chat: { title: 'NUK Riverside Staff', memberCount: 8 } }) : linkOf('group', { id })
      },
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
    await dialog.getByText('choose your staff group', { exact: false }).waitFor({ timeout: 10_000 })
    joined = true
    await dialog.getByText('(group, 8 members)').waitFor({ timeout: 10_000 })
    await dialog.getByText('Everyone in this group sees what\'s sent there.').waitFor({ timeout: 5000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click({ timeout: 5000 })
    await expect.poll(() => posted).toEqual(['/api/c/nuk/admin/telegram/links/link-1/cancel'])
    // Like a person: the dialog is gone before Connect a group is pressed again.
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)

    await page.getByRole('button', { name: 'Connect a group' }).click({ timeout: 10_000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Connect' }).click({ timeout: 10_000 })
    await toast(page, 'NUK Riverside Staff is connected').waitFor({ timeout: 10_000 })
    expect(posted.at(-1)).toBe('/api/c/nuk/admin/telegram/links/link-2/confirm')
  })

  it('Send test, a blocked chat\'s Reconnect, and Disconnect asked first with the version', async () => {
    const disconnected: unknown[] = []
    const { page } = await openTelegram({ enabled: true, botUsername: 'NukCafeBot', destinations: [GROUP, PRIVATE_BLOCKED], rules: [] }, {
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

describe('Notifications and delivery history (8.1d)', () => {
  const deliveryOf = (id: string, subject: string, overrides: Partial<NotificationDelivery> = {}): NotificationDelivery => ({
    id,
    kind: 'new_order',
    subject,
    destination: { id: GROUP.id, title: GROUP.title },
    status: 'sent',
    attempts: 1,
    nextAttemptAt: null,
    lastError: null,
    createdAt: '2026-09-30T02:02:00.000Z',
    sentAt: '2026-09-30T02:02:05.000Z',
    ...overrides,
  })

  it('turns a notification on for a chat, with the group warning and Attach CSV for the closing summary', async () => {
    const owner = destinationOf('dest-3', 'Kim', { kind: 'private' })
    let rules: NotificationRule[] = [{ kind: 'new_order', destinationId: GROUP.id, attachCsv: false }]
    const saved: SetNotificationRuleInput[] = []
    const { page } = await openTelegram({ enabled: true, botUsername: 'nuk_cafe_bot', destinations: [GROUP, owner], rules }, {
      'GET /admin/telegram': () => ({ enabled: true, botUsername: 'nuk_cafe_bot', destinations: [GROUP, owner], rules }),
      'PUT /admin/telegram/rules': ({ body }) => {
        const input = body as SetNotificationRuleInput
        saved.push(input)
        rules = rules.filter(r => !(r.kind === input.kind && r.destinationId === input.destinationId))
        if (input.enabled) rules.push({ kind: input.kind, destinationId: input.destinationId, attachCsv: input.attachCsv })
        return rules
      },
    })
    const section = (name: string) => page.getByRole('group', { name: `Send ${name} to` })
    await section('new orders').waitFor()
    expect(await section('new orders').getByRole('switch', { name: /NUK Riverside Staff/ }).getAttribute('aria-checked')).toBe('true')

    await section('closing summary').getByRole('switch', { name: /NUK Riverside Staff/ }).click()
    await expect.poll(() => saved).toEqual([{ kind: 'closing_summary', destinationId: GROUP.id, enabled: true, attachCsv: false }])
    await page.getByText('Everyone in NUK Riverside Staff will see your sales.').waitFor()
    await section('closing summary').getByRole('checkbox', { name: /Attach CSV/ }).click()
    await expect.poll(() => saved.at(-1)).toEqual({ kind: 'closing_summary', destinationId: GROUP.id, enabled: true, attachCsv: true })

    await section('new orders').getByRole('switch', { name: /NUK Riverside Staff/ }).click()
    await expect.poll(() => saved.at(-1)).toEqual({ kind: 'new_order', destinationId: GROUP.id, enabled: false, attachCsv: false })
  })

  it('shows sent, retrying and failed messages; Retry only once it stopped; View shows the saved message', async () => {
    const retried: string[] = []
    let deliveries = [
      deliveryOf('del-1', 'New order #042'),
      deliveryOf('del-2', 'New order #043', { status: 'pending', attempts: 2, nextAttemptAt: '2026-09-30T02:05:00.000Z', lastError: 'Telegram didn\'t accept it. Trying again.' }),
      deliveryOf('del-3', 'Closing summary · Tue 29 Sep 2026', { kind: 'closing_summary', status: 'failed', attempts: 8, lastError: 'Telegram didn\'t accept it after 8 tries.' }),
    ]
    const { page } = await openTelegram({ enabled: true, botUsername: 'nuk_cafe_bot', destinations: [GROUP], rules: [] }, {
      'GET /admin/telegram/deliveries': () => ({ deliveries }),
      'POST /admin/telegram/deliveries/{id}/retry': ({ url: u }) => {
        const id = u.pathname.split('/').at(-2)!
        retried.push(id)
        deliveries = deliveries.map(d => (d.id === id ? { ...d, status: 'sent', attempts: 1, lastError: null } : d))
        return deliveries.find(d => d.id === id)
      },
      'GET /admin/telegram/deliveries/{id}': () => ({ id: 'del-3', subject: 'Closing summary · Tue 29 Sep 2026', text: 'Closing summary · Riverside\nTue 29 Sep 2026\n\nPaid sales $41.00', attachment: 'riverside-2026-09-29-summary.csv' }),
    })
    await page.getByText('New order #042').waitFor()
    await page.getByText(/Retrying at/).waitFor()
    expect(await page.getByRole('button', { name: 'Retry New order #043' }).count()).toBe(0)
    await page.getByText('Telegram didn\'t accept it after 8 tries.').waitFor()

    await page.getByRole('button', { name: 'View Closing summary · Tue 29 Sep 2026' }).click()
    await page.getByRole('dialog').getByText('Paid sales $41.00', { exact: false }).waitFor()
    await page.getByRole('dialog').getByText('riverside-2026-09-29-summary.csv').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()

    await page.getByRole('button', { name: 'Retry Closing summary · Tue 29 Sep 2026' }).click()
    await toast(page, '"Closing summary · Tue 29 Sep 2026" sent to NUK Riverside Staff').waitFor()
    expect(retried).toEqual(['del-3'])
  })
})
