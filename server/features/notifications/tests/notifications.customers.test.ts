import { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { completeOrder, markOrderReady, payOrder, placeOrder } from '#server/features/orders'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { organization } from '#server/db/tables'
import { createOrderReadyLink, deliverOrderReadyDue, orderReadyAlert, purgeOrderReadyAlerts, sendOrderReadyAlert } from '#server/features/notifications/notifications.customers'
import * as repo from '#server/features/notifications/notifications.customers.repository'
import { hashLinkCode } from '#server/features/notifications/notifications.rules'
import { orderReadyAlerts } from '#server/features/notifications/notifications.schema'
import { handleUpdate } from '#server/features/notifications/notifications.service'
import type { TelegramSettings } from '#server/features/notifications/notifications.settings'
import { createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// "Your order is ready" on Telegram, for customers (D157): the order page's one-time link, the
// bot's /start, and the message when the counter marks the order ready. grammY's real `Api` talks
// to a fake Telegram through its `fetch` option.

const SETTINGS: TelegramSettings = { botToken: '123:test', botUsername: 'nuk_cafe_bot', webhookSecret: 's'.repeat(40) }
const CAFE_URL = 'https://nuk-cafe-staging.example.workers.dev/c/nuk'

type Answer = { ok: true, result: unknown } | { ok: false, error_code: number, description: string }

class FakeTelegram {
  calls: { method: string, payload: Record<string, unknown> | null }[] = []
  /** Runs before Telegram answers: a test holds a call in flight here. */
  before: ((method: string, payload: Record<string, unknown> | null) => Promise<void>) | undefined
  answer: (method: string) => Answer = () => ({ ok: true, result: true })
  readonly api = new Api(SETTINGS.botToken, {
    fetch: (async (url: string | URL, init?: { body?: unknown }) => {
      const method = String(url).split('/').pop()!
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
      this.calls.push({ method, payload })
      await this.before?.(method, payload)
      return new Response(JSON.stringify(this.answer(method)), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  })

  texts = () => this.calls.filter(c => c.method === 'sendMessage').map(c => ({ chatId: c.payload?.chat_id, text: c.payload?.text as string }))
}

let db: Db
/** Every SQL statement the test database ran. */
let queries: string[]
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
  queries = []
  db = await createTestDb({ logger: { logQuery: query => void queries.push(query) } })
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

// The two senders of the ready message (the orders.ready event and the sign-up catch-up) and the
// scheduled run share one durable claim on the order's row. Barriers (deferred promises) place the
// interleavings; nothing waits on a clock.
describe('the ready message\'s delivery: one claim, durable recovery', () => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  const readyTexts = () => telegram.texts().filter(t => /Your order \d{3} is ready/.test(t.text))
  const noUrl = async () => undefined
  const row = async () => (await db.select().from(orderReadyAlerts))[0]!

  /** Holds the ready message in flight until `release()`; `inFlight` settles once the provider call began. */
  function holdReadyMessage() {
    const gate = deferred()
    const inFlight = deferred()
    telegram.before = async (method, payload) => {
      if (method === 'sendMessage' && /Your order \d{3} is ready/.test(String(payload?.text))) {
        inFlight.resolve()
        await gate.promise
      }
    }
    return { inFlight: inFlight.promise, release: gate.resolve }
  }

  /** The chat signs up while the counter marks the order ready: the order is ready by the time the sign-up writes. */
  async function signUpWhileReady(orderId: string, meanwhile: () => Promise<unknown> = async () => undefined, at = later(6)) {
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    const racing = interleaved(db, async () => {
      await pay(orderId)
      await ready(orderId)
      await meanwhile()
    })
    return { link, signUp: () => handleUpdate(racing, telegram.api, SETTINGS, start(codeOf(link.url)), at) }
  }

  it('the catch-up and the ready event overlap: one provider send while the claim is active', async () => {
    const orderId = await place()
    const { signUp } = await signUpWhileReady(orderId)
    const held = holdReadyMessage()
    const catchUp = signUp()
    await held.inFlight
    // The event arrives while the catch-up's send is in flight: it must not send, and must be retried (not lost).
    await expect(sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))).rejects.toThrow(/another run/)
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(6))).toEqual({ sent: 0, failed: 0 })
    expect(readyTexts()).toHaveLength(1)
    held.release()
    await catchUp
    expect(readyTexts()).toHaveLength(1)
    expect((await status(orderId, later(7))).status).toBe('sent')
    // The retried event finds it done.
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(8))).toBe(false)
    expect(readyTexts()).toHaveLength(1)
  })

  it('the event finished before the sign-up committed and the catch-up fails once: the scheduled run sends, without a new code', async () => {
    const orderId = await place()
    const { signUp } = await signUpWhileReady(orderId, async () => {
      // The event handled "ready" while nobody was subscribed yet: it is done and will not run again.
      expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(5))).toBe(false)
    })
    telegram.answer = (method) => {
      return method === 'sendMessage' && telegram.calls.length > 1 ? { ok: false, error_code: 502, description: 'Bad Gateway' } : { ok: true, result: true }
    }
    // The subscribed reply (the first call) works; the ready message fails. The sign-up still succeeds.
    await expect(signUp()).resolves.toBeUndefined()
    expect(await row()).toMatchObject({ chatId: '777', notifiedAt: null, claimToken: null, attempts: 1 })

    telegram.answer = () => ({ ok: true, result: true })
    telegram.calls = []
    // Not due before the backoff ends; due after it.
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(6))).toEqual({ sent: 0, failed: 0 })
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(8))).toEqual({ sent: 1, failed: 0 })
    expect(readyTexts()).toHaveLength(1)
    expect(await row()).toMatchObject({ chatId: null, retryAt: null })
    expect((await status(orderId, later(9))).status).toBe('sent')
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(60))).toEqual({ sent: 0, failed: 0 })
  })

  it('a worker that stops after claiming: its claim expires and the message is recovered', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)
    // A run claims, then dies before sending.
    const claim = await repo.claimOrderReady(db, TEST_TENANT, orderId, later(8), later(6))
    expect(claim).toBeDefined()
    await expect(sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(7))).rejects.toThrow(/another run/)
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(7))).toEqual({ sent: 0, failed: 0 })
    expect(readyTexts()).toHaveLength(0)
    // After the lease ends the scheduled run takes over.
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(9))).toEqual({ sent: 1, failed: 0 })
    expect(readyTexts()).toHaveLength(1)
    // The dead worker waking up cannot complete anything.
    expect(await repo.markOrderReadyComplete(db, claim!, later(10))).toBe(false)
  })

  it('a send whose claim expired cannot complete or release the newer claim\'s message', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)
    const stale = (await repo.claimOrderReady(db, TEST_TENANT, orderId, later(8), later(6)))!
    // Its lease ended; a second sender claimed and is still sending.
    const current = (await repo.claimOrderReady(db, TEST_TENANT, orderId, later(11), later(9)))!
    expect(current.claimToken).not.toBe(stale.claimToken)
    expect(await repo.markOrderReadyComplete(db, stale, later(10))).toBe(false)
    expect(await repo.markOrderReadyRetry(db, stale, later(20))).toBe(false)
    expect(await repo.markOrderReadyParked(db, stale)).toBe(false)
    expect(await repo.markOrderReadyAbandoned(db, stale)).toBe(false)
    expect(await row()).toMatchObject({ chatId: '777', notifiedAt: null, claimToken: current.claimToken })
    // The same claim for another subscription (a replaced chat) is refused too.
    expect(await repo.markOrderReadyComplete(db, { ...current, subscriptionId: 'another' }, later(10))).toBe(false)
    expect(await repo.markOrderReadyComplete(db, current, later(10))).toBe(true)
  })

  it('redeeming the code again creates no new work', async () => {
    const orderId = await place()
    const link = await subscribe(orderId)
    const before = await row()
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url), { id: 888, type: 'private', first_name: 'Other' }), later(3))
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url)), later(4))
    expect(await row()).toEqual(before)
    await pay(orderId)
    await ready(orderId)
    // Every sender, one after another, adds up to one message.
    await deliverOrderReadyDue(db, telegram.api, noUrl, later(6))
    await deliverOrderReadyDue(db, telegram.api, noUrl, later(7))
    await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(8))
    expect(readyTexts()).toHaveLength(1)
  })

  it('a subscription replaced while an old send is in flight: the old completion changes nothing of the new one', async () => {
    const orderId = await place()
    await subscribe(orderId)
    // A second link was made meanwhile; its chat opens it just as the old chat's message is on its way.
    const second = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'preparing' }, SETTINGS, NOON)
    await pay(orderId)
    await ready(orderId)
    const held = holdReadyMessage()
    const oldSend = sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))
    await held.inFlight
    await db.batch([repo.subscribeOrderReadyAlertStatement(db, TEST_TENANT, orderId, await hashLinkCode(codeOf(second.url)), '888', 'second-subscription', later(6)), requireOneChange(db)])
    held.release()
    await expect(oldSend).resolves.toBe(true)
    // The old send's completion was fenced out: the new chat is still waiting, unmarked.
    expect(await row()).toMatchObject({ chatId: '888', subscriptionId: 'second-subscription', notifiedAt: null, claimToken: null })
    telegram.before = undefined
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(7))).toEqual({ sent: 1, failed: 0 })
    expect(readyTexts().map(t => t.chatId)).toEqual(['777', '888'])
    expect(await row()).toMatchObject({ chatId: null, subscriptionId: 'second-subscription', notifiedAt: later(7) })
  })

  it('the process dies right after the sign-up committed: the sign-up alone left the work, the scheduled run sends', async () => {
    const orderId = await place()
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    await pay(orderId)
    await ready(orderId)
    // The event found no chat; the sign-up commits; the catch-up never runs.
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(5))).toBe(false)
    await db.batch([repo.subscribeOrderReadyAlertStatement(db, TEST_TENANT, orderId, await hashLinkCode(codeOf(link.url)), '777', 'sub', later(6)), requireOneChange(db)])
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(6))).toEqual({ sent: 1, failed: 0 })
    expect(readyTexts()).toHaveLength(1)
  })

  it('a customer who blocks the bot during the catch-up is forgotten and nothing is retried', async () => {
    const orderId = await place()
    const { signUp } = await signUpWhileReady(orderId)
    telegram.answer = () => telegram.calls.length > 1
      ? { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }
      : { ok: true, result: true }
    await signUp()
    expect(await row()).toMatchObject({ chatId: null, retryAt: null, claimToken: null })
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(60))).toEqual({ sent: 0, failed: 0 })
  })

  it('sends nothing for an order completed meanwhile, and nothing across cafes', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)
    telegram.calls = []
    // Another cafe's id never claims this order's message.
    expect(await sendOrderReadyAlert(db, telegram.api, newId(), orderId, CAFE_URL, later(6))).toBe(false)
    expect(await row()).toMatchObject({ chatId: '777', attempts: 0, claimToken: null })

    await completeOrder(db, cashier, orderId, { version: 3 }, crypto.randomUUID(), later(6))
    expect(await deliverOrderReadyDue(db, telegram.api, noUrl, later(7))).toEqual({ sent: 0, failed: 0 })
    expect(telegram.calls).toEqual([])
    expect(await row()).toMatchObject({ chatId: null, retryAt: null })
  })

  it('a suspended cafe\'s customers get no ready message, and its link answers that it no longer works', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await pay(orderId)
    await ready(orderId)
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: await place(), status: 'awaiting_payment' }, SETTINGS, NOON)
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, TEST_TENANT))
    telegram.calls = []

    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))).toBe(false)
    expect(telegram.texts()).toEqual([])
    expect(await row()).toMatchObject({ chatId: null })
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url)), later(6))
    expect(telegram.texts()).toEqual([{ chatId: 777, text: expect.stringMatching(/doesn't work anymore/) }])
  })

  it('reads only the order\'s own cafe, by id, never every cafe (audit N6)', async () => {
    await ensureTenant(db, 'another-cafe')
    const orderId = await place()
    const link = await createOrderReadyLink(db, TEST_TENANT, { id: orderId, status: 'awaiting_payment' }, SETTINGS, NOON)
    await pay(orderId)
    await ready(orderId)
    queries = []
    await handleUpdate(db, telegram.api, SETTINGS, start(codeOf(link.url)), later(6))
    expect(telegram.texts().at(-1)?.text).toMatch(/is ready/)
    const cafeReads = queries.filter(query => /from "organization"/.test(query))
    expect(cafeReads.length).toBeGreaterThan(0)
    for (const query of cafeReads) expect(query).toMatch(/"organization"\."id" = \?/)
  })

  it('a message still being prepared is parked by the scheduled run, then sent by the ready event', async () => {
    const orderId = await place()
    await subscribe(orderId)
    await deliverOrderReadyDue(db, telegram.api, noUrl, later(2))
    expect(await row()).toMatchObject({ chatId: '777', retryAt: null, attempts: 0, claimToken: null })
    await pay(orderId)
    await ready(orderId)
    expect(await sendOrderReadyAlert(db, telegram.api, TEST_TENANT, orderId, CAFE_URL, later(6))).toBe(true)
    expect(readyTexts()).toHaveLength(1)
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

it('purges customer alert requests in batches without deleting their referenced orders', async () => {
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const id = await place()
    await pay(id)
    await createOrderReadyLink(db, TEST_TENANT, { id, status: 'preparing' }, SETTINGS, NOON)
    ids.push(id)
  }
  const now = later(3 * 24 * 60)
  await db.update(orderReadyAlerts).set({ createdAt: now }).where(eq(orderReadyAlerts.orderId, ids[2]!))
  await expect(purgeOrderReadyAlerts(db, now, -1)).rejects.toThrow(RangeError)
  expect(await purgeOrderReadyAlerts(db, now, 1)).toBe(1)
  expect(await purgeOrderReadyAlerts(db, now, 1)).toBe(1)
  expect(await purgeOrderReadyAlerts(db, now, 1)).toBe(0)
  expect(await db.select().from(orderReadyAlerts)).toMatchObject([{ orderId: ids[2] }])
  const { orders } = await import('#server/features/orders/orders.schema')
  expect(await db.select().from(orders)).toHaveLength(3)
})
