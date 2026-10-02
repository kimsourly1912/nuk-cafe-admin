import { Api } from 'grammy'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { organization } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { payOrder, placeOrder } from '#server/features/orders'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { deliverDue, listDeliveries, queueBakongTokenReminder, queueClosingSummaries, queueOrderAlert, queueServerErrorAlert, retryDelivery, setNotificationRule } from '#server/features/notifications/notifications.delivery'
import { closingInstant, routeOf, bakongReminderStage } from '#server/features/notifications/notifications.messages'
import * as repo from '#server/features/notifications/notifications.repository'
import { notificationDeliveries, telegramDestinations } from '#server/features/notifications/notifications.schema'
import { sendReport, telegramOverview } from '#server/features/notifications/notifications.service'
import type { TelegramSettings } from '#server/features/notifications/notifications.settings'
import { createAdmin, createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// Alerts, the closing summary and their delivery (step 8.1d, D113), against the real order services
// and a fake Telegram behind grammY's `Api` (its `fetch` replaced).

const SETTINGS: TelegramSettings = { botToken: '123:test', botUsername: 'nuk_cafe_bot', webhookSecret: 's'.repeat(40) }
const SITE = 'https://nuk-cafe-staging.example.workers.dev'

type Answer = { ok: true, result: unknown } | { ok: false, error_code: number, description: string, parameters?: Record<string, unknown> }

class FakeTelegram {
  calls: { method: string, payload: Record<string, unknown> | null }[] = []
  answer: (method: string) => Answer = () => ({ ok: true, result: true })
  readonly api = new Api(SETTINGS.botToken, {
    fetch: (async (url: string | URL, init?: { body?: unknown }) => {
      const method = String(url).split('/').pop()!
      this.calls.push({ method, payload: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null })
      return new Response(JSON.stringify(this.answer(method)), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  })

  sent = (method = 'sendMessage') => this.calls.filter(c => c.method === method)
}

let db: Db
let telegram: FakeTelegram
let admin: Actor
let branchId: string
let cashier: BranchActor
let sokha: Actor
let latte: { itemId: string, variationId: string }
let group: string
let owner: string

/** Local time in Phnom Penh (UTC+7). */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`)
const MON = '2026-09-28'
const TUE = '2026-09-29'

async function destination(title: string, kind: 'private' | 'group', chatId: string) {
  const id = newId()
  await db.insert(telegramDestinations).values({ id, chatId, kind, title, connectedBy: admin.userId })
  return id
}

async function place(when: Date, note: string | null = null) {
  const { orderId } = await placeOrder(db, sokha, {
    branchId,
    tableToken: null,
    lines: [{ itemId: latte.itemId, variationId: latte.variationId, modifierIds: [], quantity: 2, note }],
    expectedTotalMinor: 1750,
  }, crypto.randomUUID(), when)
  return orderId
}

const deliveries = () => db.select().from(notificationDeliveries)

beforeEach(async () => {
  db = await createTestDb()
  telegram = new FakeTelegram()
  admin = { userId: (await createAdmin(db)).userId, role: 'admin' }
  branchId = newId()
  await db.insert(organization).values({ id: branchId, name: 'Riverside', slug: branchId, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  // Monday 07:00–21:00 only: Tuesday is a closed day.
  await updateBranchSettings(db, admin, branchId, { version: 1, hours: [{ weekday: 1, startMinute: 420, endMinute: 1260 }] })
  const coffee = await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, admin, { categoryId: coffee.id, name: 'Iced Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 875, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const published = await publishItem(db, admin, draft.id, { version: draft.version })
  latte = { itemId: published.id, variationId: published.variations[0]!.id }
  sokha = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, role: 'customer' }
  cashier = { userId: (await createUser(db, 'dara@example.com', 'Dara Sok')).id, role: 'customer', branchId, branchRole: 'staff' }
  group = await destination('NUK Riverside Staff', 'group', '-100200')
  owner = await destination('Kim', 'private', '555')
})

describe('closing time', () => {
  const hours = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute })
  const zone = 'Asia/Phnom_Penh'

  it('is the end of the business day\'s last window, overnight and after midnight included', () => {
    expect(closingInstant([hours(1, 420, 1260)], MON, zone)).toEqual(at(MON, '21:00'))
    // Two windows: the later one closes the day.
    expect(closingInstant([hours(1, 420, 720), hours(1, 900, 1320)], MON, zone)).toEqual(at(MON, '22:00'))
    // Overnight: Monday 18:00 to 02:00 closes on Tuesday.
    expect(closingInstant([hours(1, 1080, 120)], MON, zone)).toEqual(at(TUE, '02:00'))
    // A window starting after midnight but before 04:00 belongs to the day before.
    expect(closingInstant([hours(1, 420, 1260), hours(2, 0, 90)], MON, zone)).toEqual(at(TUE, '01:30'))
    expect(closingInstant([hours(2, 0, 90)], TUE, zone)).toBeNull()
  })

  it('is none on a closed day (no summary, R4)', () => {
    expect(closingInstant([hours(1, 420, 1260)], TUE, zone)).toBeNull()
    expect(closingInstant([], MON, zone)).toBeNull()
  })
})

describe('order events', () => {
  it('placing and paying an order write neutral outbox events in their batches', async () => {
    const orderId = await place(at(MON, '10:00'))
    await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), at(MON, '10:05'))
    const events = await db.select().from(outboxMessages)
    expect(events.map(e => [e.kind, e.payload])).toEqual(expect.arrayContaining([['orders.placed', { orderId }], ['orders.paid', { orderId }]]))
  })
})

describe('alerts', () => {
  it('nothing is queued while no chat gets the notification', async () => {
    const orderId = await place(at(MON, '10:00'))
    expect(await queueOrderAlert(db, 'new_order', orderId, SITE, at(MON, '10:00'))).toEqual([])
  })

  it('a new order goes to the chats that get it, once, with the lines, the note and Open order', async () => {
    await setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: true, attachCsv: false })
    const orderId = await place(at(MON, '10:00'), 'less sugar')
    const ids = await queueOrderAlert(db, 'new_order', orderId, SITE, at(MON, '10:00'))
    expect(ids).toHaveLength(1)
    // The outbox delivers at least once: a repeated event adds nothing.
    expect(await queueOrderAlert(db, 'new_order', orderId, SITE, at(MON, '10:01'))).toEqual([])

    const report = await deliverDue(db, telegram.api, at(MON, '10:00'), { ids })
    expect(report).toEqual({ sent: 1, retried: 0, failed: 0 })
    const payload = telegram.sent()[0]!.payload!
    expect(payload.chat_id).toBe('-100200')
    expect(payload.text).toBe('🧾 <b>New order #001 · Riverside</b>\nPickup · Sokha\n\n2 × Iced Latte\n   ↳ <i>less sugar</i>\n\nTotal <b>$17.50</b>\n⏳ Waiting for payment. Preparation starts after payment.')
    expect(payload.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Open order', url: `${SITE}/counter/${branchId}?order=${orderId}` }]] })
    expect(JSON.stringify(payload)).not.toContain('sokha@example.com')
    expect(await listDeliveries(db)).toMatchObject([{ subject: 'New order #001', status: 'sent', destination: { title: 'NUK Riverside Staff' } }])
  })

  it('the same event handled twice at once still saves one delivery per chat (the dedupe index)', async () => {
    await setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: true, attachCsv: false })
    const orderId = await place(at(MON, '10:00'))
    // The second run saves its delivery after the first checked and before it writes.
    const racing = interleaved(db, () => queueOrderAlert(db, 'new_order', orderId, SITE, at(MON, '10:00')))
    await queueOrderAlert(racing, 'new_order', orderId, SITE, at(MON, '10:00'))
    expect(await deliveries()).toHaveLength(1)
  })

  it('without an https site, there\'s no Open order button (Telegram refuses it)', async () => {
    await setNotificationRule(db, admin, { kind: 'payment', destinationId: group, enabled: true, attachCsv: false })
    const orderId = await place(at(MON, '10:00'))
    await payOrder(db, cashier, orderId, { version: 1, method: 'khqr', reference: null }, crypto.randomUUID(), at(MON, '10:05'))
    const ids = await queueOrderAlert(db, 'payment', orderId, 'http://localhost:3000', at(MON, '10:05'))
    await deliverDue(db, telegram.api, at(MON, '10:05'), { ids })
    const payload = telegram.sent()[0]!.payload!
    expect(payload.text).toBe('✅ <b>Paid #001 · Riverside</b>\nPickup · Sokha · KHQR $17.50\nPreparation can start.')
    expect(payload.reply_markup).toBeUndefined()
  })
})

describe('delivery', () => {
  async function queued() {
    await setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: true, attachCsv: false })
    const orderId = await place(at(MON, '10:00'))
    const [id] = await queueOrderAlert(db, 'new_order', orderId, SITE, at(MON, '10:00'))
    return id!
  }
  const row = async (id: string) => (await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)))[0]!

  it('waits as long as Telegram asks, without counting it as a failure', async () => {
    const id = await queued()
    telegram.answer = () => ({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } })
    expect(await deliverDue(db, telegram.api, at(MON, '10:00'))).toEqual({ sent: 0, retried: 1, failed: 0 })
    expect(await row(id)).toMatchObject({ status: 'pending', nextAttemptAt: new Date(at(MON, '10:00').getTime() + 7000), lastError: 'Telegram asked to wait 7 seconds.' })
    // Not due before then.
    expect(await deliverDue(db, telegram.api, new Date(at(MON, '10:00').getTime() + 6000))).toEqual({ sent: 0, retried: 0, failed: 0 })
  })

  it('backs off 1, 2, 4 … minutes and fails after 8 tries; Retry sends the same message', async () => {
    const id = await queued()
    telegram.answer = () => ({ ok: false, error_code: 500, description: 'Internal Server Error' })
    let now = at(MON, '10:00')
    for (let attempt = 1; attempt <= 8; attempt++) {
      await deliverDue(db, telegram.api, now)
      now = (await row(id)).nextAttemptAt
    }
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 8, lastError: 'Telegram didn\'t accept it after 8 tries.' })
    expect(telegram.sent()).toHaveLength(8)

    telegram.answer = () => ({ ok: true, result: true })
    expect(await retryDelivery(db, telegram.api, admin, id, now)).toMatchObject({ status: 'sent', attempts: 1 })
    expect(telegram.sent()[8]!.payload!.text).toBe(telegram.sent()[0]!.payload!.text)
    await expectApiError(() => retryDelivery(db, telegram.api, admin, id, now), 409, 'INVALID_STATE')
  })

  it('a chat that blocked the bot fails at once and is marked blocked', async () => {
    const id = await queued()
    telegram.answer = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' })
    expect(await deliverDue(db, telegram.api, at(MON, '10:00'))).toEqual({ sent: 0, retried: 0, failed: 1 })
    expect(await row(id)).toMatchObject({ status: 'failed', lastError: 'The bot was removed or blocked in this chat.' })
    expect((await telegramOverview(db, SETTINGS)).destinations.find(d => d.id === group)?.status).toBe('blocked')
    await expectApiError(() => retryDelivery(db, telegram.api, admin, id, at(MON, '10:05')), 409, 'TELEGRAM_BLOCKED')
  })

  it('a claimed delivery isn\'t sent by an overlapping run', async () => {
    const id = await queued()
    const [due] = await repo.dueDeliveries(db, at(MON, '10:00'), 5)
    expect(await repo.claimDelivery(db, due!, at(MON, '10:00'), at(MON, '10:02'))).toBe(true)
    expect(await repo.claimDelivery(db, due!, at(MON, '10:00'), at(MON, '10:02'))).toBe(false)
    expect(await deliverDue(db, telegram.api, at(MON, '10:01'))).toEqual({ sent: 0, retried: 0, failed: 0 })
    expect((await row(id)).attempts).toBe(1)
  })
})

describe('closing summary', () => {
  beforeEach(async () => {
    await setNotificationRule(db, admin, { kind: 'closing_summary', destinationId: owner, enabled: true, attachCsv: true })
    const orderId = await place(at(MON, '10:00'))
    await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), at(MON, '10:05'))
  })

  it('is queued 30 minutes after closing, once, with the CSV as its own message', async () => {
    expect(await queueClosingSummaries(db, SITE, at(MON, '21:29'))).toEqual([])
    const ids = await queueClosingSummaries(db, SITE, at(MON, '21:30'))
    expect(ids).toHaveLength(2)
    expect(await queueClosingSummaries(db, SITE, at(MON, '21:31'))).toEqual([])

    await deliverDue(db, telegram.api, at(MON, '21:31'))
    const text = telegram.sent()[0]!.payload!
    expect(text.text).toContain('<b>Closing summary · Riverside</b>\nMon 28 Sep 2026')
    expect(text.text).toContain('Paid sales <b>$17.50</b> · 1 order')
    expect(text.reply_markup).toEqual({ inline_keyboard: [[{ text: 'View full report', url: `${SITE}/admin/reports/summary?from=${MON}&to=${MON}` }]] })
    expect(telegram.sent('sendDocument')).toHaveLength(1)
    expect((await listDeliveries(db)).map(d => d.subject).sort()).toEqual(['Closing summary · Mon 28 Sep 2026', 'Closing summary · Mon 28 Sep 2026 · CSV'])
  })

  it('isn\'t sent on a closed day, or late after downtime', async () => {
    expect(await queueClosingSummaries(db, SITE, at(TUE, '22:00'))).toEqual([])
    // 12 hours after it was due: skipped rather than sent the next morning.
    expect(await queueClosingSummaries(db, SITE, at(TUE, '09:30'))).toEqual([])
  })

  it('a chat added later still gets that day\'s summary; the others don\'t get it twice', async () => {
    await queueClosingSummaries(db, SITE, at(MON, '21:30'))
    await setNotificationRule(db, admin, { kind: 'closing_summary', destinationId: group, enabled: true, attachCsv: false })
    const ids = await queueClosingSummaries(db, SITE, at(MON, '21:40'))
    expect(ids).toHaveLength(1)
    expect((await deliveries()).filter(d => d.destinationId === group)).toHaveLength(1)
  })
})

describe('rules and history', () => {
  it('turns a notification on and off per chat; a disconnected chat is 404', async () => {
    await setNotificationRule(db, admin, { kind: 'closing_summary', destinationId: owner, enabled: true, attachCsv: true })
    // Only closing summaries carry a CSV.
    const rules = await setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: true, attachCsv: true })
    expect(rules).toEqual(expect.arrayContaining([
      { kind: 'closing_summary', destinationId: owner, attachCsv: true },
      { kind: 'new_order', destinationId: group, attachCsv: false },
    ]))
    expect(await setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: false, attachCsv: false })).toEqual([{ kind: 'closing_summary', destinationId: owner, attachCsv: true }])
    await db.update(telegramDestinations).set({ status: 'disconnected' }).where(eq(telegramDestinations.id, group))
    await expectApiError(() => setNotificationRule(db, admin, { kind: 'new_order', destinationId: group, enabled: true, attachCsv: false }), 404, 'NOT_FOUND')
  })

  it('a report sent from the portal is in the history, as sent', async () => {
    await sendReport(db, telegram.api, admin, crypto.randomUUID(), { destinationId: owner, report: {}, attachCsv: false }, async () => ({ subject: 'Summary · Mon 28 Sep 2026', html: '<b>Summary</b>', audit: {} }), at(MON, '12:00'))
    expect(await listDeliveries(db)).toMatchObject([{ kind: 'report', subject: 'Summary · Mon 28 Sep 2026', status: 'sent', destination: { title: 'Kim' } }])
  })
})

describe('server errors (step 10.4, D119)', () => {
  const failed = (path: string, requestId = 'req-1') => ({ method: 'POST', path, status: 500, requestId })

  it('names ids in a route once, so one broken page is one alert', () => {
    expect(routeOf('/api/shop/orders/01a0f33c-3eb1-71c2-8deb-d67aee32e4c9/cancel?x=1')).toBe('/api/shop/orders/{id}/cancel')
    expect(routeOf('/api/admin/menu/items')).toBe('/api/admin/menu/items')
  })

  it('queues nothing without a chat that wants them; with one, the route, status and request id, never the error\'s text', async () => {
    expect(await queueServerErrorAlert(db, failed('/api/shop/orders'), at(MON, '10:00'))).toEqual([])
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: owner, enabled: true, attachCsv: false })
    const ids = await queueServerErrorAlert(db, failed('/api/shop/orders'), at(MON, '10:00'))
    expect(ids).toHaveLength(1)
    const [row] = await deliveries()
    expect(row).toMatchObject({ kind: 'server_error', destinationId: owner, subject: 'Server error · POST /api/shop/orders' })
    expect(row!.message.html).toContain('<code>POST /api/shop/orders</code>')
    expect(row!.message.html).toContain('500 · request <code>req-1</code>')

    await deliverDue(db, telegram.api, at(MON, '10:00'), { ids })
    expect(telegram.sent()).toHaveLength(1)
    expect(telegram.sent()[0]!.payload).toMatchObject({ chat_id: '555', parse_mode: 'HTML' })
  })

  it('at most one per route and chat in 15 minutes, even when two failures land at once', async () => {
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: owner, enabled: true, attachCsv: false })
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: group, enabled: true, attachCsv: false })
    const [first, second] = await Promise.all([
      queueServerErrorAlert(db, failed('/api/shop/orders/01a0f33c-3eb1-71c2-8deb-d67aee32e4c9/cancel', 'a'), at(MON, '10:01')),
      queueServerErrorAlert(db, failed('/api/shop/orders/01a0f33c-3eb1-71c2-8deb-d67aee32e4c8/cancel', 'b'), at(MON, '10:02')),
    ])
    expect(first!.length + second!.length).toBe(2)
    expect(await deliveries()).toHaveLength(2)
    // Another route is its own alert; the same route in the next window alerts again.
    expect(await queueServerErrorAlert(db, failed('/api/admin/staff'), at(MON, '10:03'))).toHaveLength(2)
    expect(await queueServerErrorAlert(db, failed('/api/shop/orders/01a0f33c-3eb1-71c2-8deb-d67aee32e4c9/cancel'), at(MON, '10:16'))).toHaveLength(2)
    expect(await deliveries()).toHaveLength(6)
  })

  it('a blocked chat gets none', async () => {
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: owner, enabled: true, attachCsv: false })
    await db.update(telegramDestinations).set({ status: 'blocked' }).where(eq(telegramDestinations.id, owner))
    expect(await queueServerErrorAlert(db, failed('/api/shop/orders'), at(MON, '10:00'))).toEqual([])
  })
})

describe('the Bakong token\'s reminders (step 10.16, D132)', () => {
  /** The token stops working at 07:00 on Mon 2026-12-21 in Phnom Penh. */
  const EXPIRES = new Date('2026-12-21T07:00:00+07:00')
  const before = (days: number, hours = 0) => new Date(EXPIRES.getTime() - (days * 24 + hours) * 3_600_000)

  it('is due 14, 7, 3 and 1 days before and on the day; a late server sends the next one down', () => {
    expect(bakongReminderStage(EXPIRES, before(20))).toBeNull()
    expect(bakongReminderStage(EXPIRES, before(14, 1))).toBeNull()
    expect(bakongReminderStage(EXPIRES, before(14))).toBe(14)
    expect(bakongReminderStage(EXPIRES, before(8))).toBe(14)
    expect(bakongReminderStage(EXPIRES, before(6))).toBe(7)
    expect(bakongReminderStage(EXPIRES, before(3))).toBe(3)
    expect(bakongReminderStage(EXPIRES, before(0, 5))).toBe(1)
    expect(bakongReminderStage(EXPIRES, EXPIRES)).toBe(0)
    expect(bakongReminderStage(EXPIRES, before(-30))).toBe(0)
  })

  it('goes once per stage to the chats that get server errors, with the date and what to do', async () => {
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(7))).toEqual([])
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: owner, enabled: true, attachCsv: false })
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(20))).toEqual([])
    expect(await queueBakongTokenReminder(db, null, SITE, before(7))).toEqual([])

    const ids = await queueBakongTokenReminder(db, EXPIRES, SITE, before(7))
    expect(ids).toHaveLength(1)
    // Every minute after that, nothing more until the next stage.
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(6, 23))).toEqual([])
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(4))).toEqual([])
    const [row] = await deliveries()
    expect(row).toMatchObject({ kind: 'server_error', destinationId: owner, subject: 'Bakong token expires in 7 days' })
    expect(row!.message.html).toContain('<b>The Bakong token expires in 7 days</b> (21 Dec 2026)')
    expect(row!.message.html).toContain('NUXT_BAKONG_TOKEN')
    expect(row!.message.button).toEqual({ text: 'Open Payments', url: `${SITE}/admin/payments` })

    await deliverDue(db, telegram.api, before(7), { ids })
    expect(telegram.sent()).toHaveLength(1)

    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(3))).toHaveLength(1)
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, EXPIRES)).toHaveLength(1)
    expect(await queueBakongTokenReminder(db, EXPIRES, SITE, before(-2))).toEqual([])
    expect((await deliveries()).map(d => d.subject)).toEqual(['Bakong token expires in 7 days', 'Bakong token expires in 3 days', 'Bakong token expired'])
    expect((await deliveries())[2]!.message.html).toContain('<b>The Bakong token has expired</b>')
  })

  it('starts over for a new token; two runs at once queue one per chat', async () => {
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: owner, enabled: true, attachCsv: false })
    await setNotificationRule(db, admin, { kind: 'server_error', destinationId: group, enabled: true, attachCsv: false })
    const [first, second] = await Promise.all([
      queueBakongTokenReminder(db, EXPIRES, SITE, before(1)),
      queueBakongTokenReminder(db, EXPIRES, SITE, before(1)),
    ])
    expect(first!.length + second!.length).toBe(2)
    const renewed = new Date(EXPIRES.getTime() + 90 * 24 * 3_600_000)
    expect(await queueBakongTokenReminder(db, renewed, SITE, new Date(renewed.getTime() - 24 * 3_600_000))).toHaveLength(2)
    expect(await deliveries()).toHaveLength(4)
  })
})
