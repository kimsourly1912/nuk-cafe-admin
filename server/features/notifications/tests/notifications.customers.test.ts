import { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { completeOrder, markOrderReady, payOrder, placeOrder } from '#server/features/orders'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { createOrderReadyLink, orderReadyAlert, purgeOrderReadyAlerts, sendOrderReadyAlert } from '#server/features/notifications/notifications.customers'
import { orderReadyAlerts } from '#server/features/notifications/notifications.schema'
import { handleUpdate } from '#server/features/notifications/notifications.service'
import type { TelegramSettings } from '#server/features/notifications/notifications.settings'
import { createAdmin, createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// "Your order is ready" on Telegram, for customers (D157): the order page's one-time link, the
// bot's /start, and the message when the counter marks the order ready. grammY's real `Api` talks
// to a fake Telegram through its `fetch` option.

const SETTINGS: TelegramSettings = { botToken: '123:test', botUsername: 'nuk_cafe_bot', webhookSecret: 's'.repeat(40) }
const CAFE_URL = 'https://nuk-cafe-staging.example.workers.dev/c/nuk'

type Answer = { ok: true, result: unknown } | { ok: false, error_code: number, description: string }

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

  texts = () => this.calls.filter(c => c.method === 'sendMessage').map(c => ({ chatId: c.payload?.chat_id, text: c.payload?.text as string }))
}

let db: Db
let telegram: FakeTelegram
let admin: Actor
let cashier: BranchActor
let sokha: Actor
let branchId: string
let latte: { itemId: string, variationId: string }

const NOON = new Date('2026-09-28T12:00:00+07:00')
const later = (minutes: number) => new Date(NOON.getTime() + minutes * 60_000)

const customerChat = { id: 777, type: 'private' as const, first_name: 'Sokha' }
let updateId = 1
function start(code: string, chat: { id: number, type: 'private' | 'supergroup', first_name?: string, title?: string } = customerChat): Update {
  return { update_id: updateId++, message: { message_id: updateId, date: 0, chat, from: { id: 777, is_bot: false, first_name: 'Sokha' }, text: `/start ${code}` } } as Update
}
const codeOf = (url: string) => new URL(url).searchParams.get('start')!

async function place() {
  const { orderId } = await placeOrder(db, sokha, {
    branchId,
    tableToken: null,
    lines: [{ itemId: latte.itemId, variationId: latte.variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, crypto.randomUUID(), NOON)
  return orderId
}

async function pay(orderId: string) {
  await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), later(1))
}
const ready = (orderId: string) => markOrderReady(db, cashier, orderId, { version: 2 }, crypto.randomUUID(), later(5))

async function subscribe(orderId: string) {
  const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
  await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url)), later(1))
  return link
}

const status = (orderId: string, now = later(2)) => orderReadyAlert(db, TEST_TENANT, orderId, SETTINGS, now)

beforeEach(async () => {
  db = await createTestDb()
  telegram = new FakeTelegram()
  admin = { userId: (await createAdmin(db)).userId, tenantId: TEST_TENANT, role: 'owner' }
  branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh', status: 'active' })
  await updateBranchSettings(db, admin, branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
  const coffee = await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, admin, { categoryId: coffee.id, name: 'Iced Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 875, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const published = await publishItem(db, admin, draft.id, { version: draft.version })
  latte = { itemId: published.id, variationId: published.variations[0]!.id }
  sokha = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, tenantId: TEST_TENANT, role: 'customer' }
  cashier = { userId: (await createUser(db, 'dara@example.com', 'Dara Sok')).id, tenantId: TEST_TENANT, role: 'customer', branchId, branchRole: 'staff' }
})

describe('the order page\'s link (D157)', () => {
  it('is unavailable without a bot, off until asked, and waiting with a one-time link to the bot', async () => {
    const orderId = await place()
    expect(await orderReadyAlert(db, TEST_TENANT, orderId, null)).toEqual({ available: false, status: 'off' })
    expect(await status(orderId)).toEqual({ available: true, status: 'off' })

    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    expect(link.status).toBe('waiting')
    expect(link.url).toMatch(/^https:\/\/t\.me\/nuk_cafe_bot\?start=o_[\w-]{43}$/)
    // Only the code's hash is stored.
    const [row] = await db.select().from(orderReadyAlerts)
    expect(row!.codeHash).not.toContain(codeOf(link.url))
    // Unused for 15 minutes: off again.
    expect((await status(orderId, later(16))).status).toBe('off')
  })

  it('is refused once the order is ready, finished or cancelled', async () => {
    const orderId = await place()
    for (const orderStatus of ['ready', 'completed', 'cancelled'] as const) {
      await expectApiError(() => createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: orderStatus }, SETTINGS, NOON), 409, 'INVALID_STATE')
    }
    expect(await db.select().from(orderReadyAlerts)).toEqual([])
  })
})

describe('the bot\'s /start (D157)', () => {
  it('ties the private chat to the order, once, and says so with the cafe\'s name', async () => {
    const orderId = await place()
    const link = await subscribe(orderId)
    expect((await status(orderId)).status).toBe('on')
    expect(telegram.texts()).toEqual([{ chatId: 777, text: expect.stringMatching(/will message you here when order \d{3} is ready/) }])

    // Telegram resends the update, or someone else opens the same link: nothing changes.
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url), { id: 888, type: 'private', first_name: 'Other' }), later(2))
    const [row] = await db.select().from(orderReadyAlerts)
    expect(row!.chatId).toBe('777')
    expect(row!.codeHash).toBeNull()
  })

  it('two chats opening the same link at once: one gets it (the code is single-use)', async () => {
    const orderId = await place()
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    // The other chat's /start lands between this one's checks and its write.
    const racing = interleaved(db, () => handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url), { id: 888, type: 'private', first_name: 'Other' }), later(1)))
    await handleUpdate(racing, telegram.api, SETTINGS, start(codeOf(link.url)), later(1))
    expect(telegram.texts().filter(t => /will message you/.test(t.text))).toEqual([{ chatId: 888, text: expect.any(String) }])
    expect((await db.select().from(orderReadyAlerts))[0]!.chatId).toBe('888')
  })

  it('refuses an expired link, a replaced one and a group', async () => {
    const orderId = await place()
    const first = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    const second = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    // The first code stopped working when a new one was made: an unknown code goes to the staff links, which don't know it either.
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(first.url)), later(1))
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(second.url), { id: -100, type: 'supergroup', title: 'Staff' }), later(1))
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(second.url)), later(16))
    expect((await status(orderId, later(1))).status).toBe('waiting')
    expect(telegram.texts().map(t => t.text)).toEqual([
      expect.stringContaining('doesn\'t work anymore'),
      expect.stringContaining('not in a group'),
      expect.stringContaining('doesn\'t work anymore'),
    ])
  })
})

describe('the message when it\'s ready (D157)', () => {
  it('Mark ready writes the event; the chat gets one message, then the chat is forgotten', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)
    expect((await db.select().from(outboxMessages)).map(m => m.kind)).toContain('orders.ready')

    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))).toBe(true)
    const message = telegram.calls.filter(c => c.method === 'sendMessage').at(-1)!.payload!
    expect(message.chat_id).toBe('777')
    expect(message.text).toMatch(/Your order \d{3} is ready/)
    expect(message.reply_markup).toEqual({ inline_keyboard: [[{ text: 'View order', url: `${CAFE_URL}/orders/${orderId}` }]] })
    expect((await status(orderId)).status).toBe('sent')
    expect((await db.select().from(orderReadyAlerts))[0]!.chatId).toBeNull()

    // The event again (a retry, the scheduled run): nothing more is sent.
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(7))).toBe(false)
    expect(telegram.calls.filter(c => c.method === 'sendMessage')).toHaveLength(2)
  })

  it('sends nothing when nobody asked, or when the order moved on before the event was handled', async () => {
    const quiet = await place()
    await pay(quiet)
    await ready(quiet)
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, quiet, CAFE_URL, later(6))).toBe(false)

    const done = await place()
    await subscribe(done)
    await pay(done)
    await ready(done)
    await completeOrder(db, cashier, done, { version: 3 }, crypto.randomUUID(), later(6))
    telegram.calls = []
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, done, CAFE_URL, later(7))).toBe(false)
    expect(telegram.calls).toEqual([])
  })

  it('gives up on a customer who blocked the bot, and throws on anything else so the outbox retries', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)

    telegram.answer = () => ({ ok: false, error_code: 502, description: 'Bad Gateway' })
    await expect(sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))).rejects.toThrow()
    expect((await status(orderId)).status).toBe('on')

    telegram.answer = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(7))).toBe(false)
    expect((await db.select().from(orderReadyAlerts))[0]).toMatchObject({ chatId: null, notifiedAt: later(7) })
  })

  it('a chat that signs up after the order was marked ready gets the message at once', async () => {
    const orderId = await place()
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'preparing' }, SETTINGS, NOON)
    await pay(orderId)
    await ready(orderId)
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url)), later(6))
    expect(telegram.texts().map(t => t.text)).toEqual([expect.stringMatching(/is ready now/)])
  })
})

it('another cafe\'s order is never found by its id, and old requests are purged after 2 days', async () => {
  const orderId = await place()
  await subscribe(orderId)
  expect((await orderReadyAlert(db, newId(), orderId, SETTINGS)).status).toBe('off')

  expect(await purgeOrderReadyAlerts(db, later(60))).toBe(0)
  expect(await purgeOrderReadyAlerts(db, later(3 * 24 * 60))).toBe(1)
  expect(await db.select().from(orderReadyAlerts).where(eq(orderReadyAlerts.orderId, orderId))).toEqual([])
})
