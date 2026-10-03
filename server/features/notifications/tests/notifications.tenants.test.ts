import { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { placeOrder } from '#server/features/orders'
import { deliverySnapshot, listDeliveries, queueOrderAlert, queueServerErrorAlert, retryDelivery, setNotificationRule } from '#server/features/notifications/notifications.delivery'
import { notificationDeliveries, telegramDestinations } from '#server/features/notifications/notifications.schema'
import { cancelLink, confirmLink, createLink, disconnectDestination, getLink, handleUpdate, listDestinations, sendTestMessage, telegramOverview } from '#server/features/notifications/notifications.service'
import type { TelegramSettings } from '#server/features/notifications/notifications.settings'
import { createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

/**
 * Tenant isolation for Telegram (D138, multi-tenant plan → Rules): each cafe's chats, links, rules
 * and deliveries are its own; one Telegram chat can follow two cafes; an order's alert goes to its
 * own cafe's chats only.
 */

const SETTINGS: TelegramSettings = { botToken: '123:test', botUsername: 'NukCafeBot', webhookSecret: 's'.repeat(40) }
const OTHER = 'tenant-2'
const now = new Date('2026-09-28T05:00:00Z')
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

class FakeTelegram {
  calls: { method: string, payload: Record<string, unknown> | null }[] = []
  readonly api = new Api(SETTINGS.botToken, {
    fetch: (async (url: string | URL, init?: { body?: unknown }) => {
      const method = String(url).split('/').pop()!
      this.calls.push({ method, payload: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null })
      const result = method === 'getChatMemberCount' ? 8 : method === 'getChatMember' ? { status: 'administrator', user: { id: 555, is_bot: false, first_name: 'Sokha' } } : true
      return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  })

  left = () => this.calls.filter(c => c.method === 'leaveChat').map(c => c.payload?.chat_id)
}

let db: Db
let telegram: FakeTelegram
let ours: Actor
let theirs: Actor
let updateId = 1
const group = { id: -100200, type: 'supergroup' as const, title: 'Staff group' }
const groupMessage = (text: string): Update => ({ update_id: updateId++, message: { message_id: updateId, date: 0, chat: group, from: { id: 555, is_bot: false, first_name: 'Sokha' }, text } }) as Update

async function destination(tenantId: string, title: string, chatId: string) {
  const id = newId()
  await db.insert(telegramDestinations).values({ id, tenantId, chatId, kind: 'private', title })
  return id
}

/** Connects the shared staff group to a cafe through its admin's link, as Telegram would. */
async function connectGroup(admin: Actor, at: Date) {
  const link = await createLink(db, admin, SETTINGS, { kind: 'group' }, at)
  await handleUpdate(db, telegram.api, SETTINGS, groupMessage(`/start@NukCafeBot ${new URL(link.url).searchParams.get('startgroup')}`), at)
  return confirmLink(db, admin, link.id, at)
}

beforeEach(async () => {
  db = await createTestDb()
  telegram = new FakeTelegram()
  ours = { userId: (await createAdmin(db)).userId, tenantId: TEST_TENANT, role: 'owner' }
  theirs = { userId: (await createAdmin(db, undefined, OTHER)).userId, tenantId: OTHER, role: 'owner' }
  await ensureTenant(db, OTHER)
})

describe('telegram tenants', () => {
  it('shows and changes only the cafe\'s own chats', async () => {
    const mine = await destination(TEST_TENANT, 'Our chat', '111')
    const theirChat = await destination(OTHER, 'Their chat', '222')
    expect((await listDestinations(db, TEST_TENANT)).map(d => d.title)).toEqual(['Our chat'])
    expect((await telegramOverview(db, OTHER, SETTINGS)).destinations.map(d => d.title)).toEqual(['Their chat'])

    await expectApiError(() => sendTestMessage(db, telegram.api, ours, theirChat, now), 404, 'NOT_FOUND')
    await expectApiError(() => disconnectDestination(db, telegram.api, ours, theirChat, 1, now), 404, 'NOT_FOUND')
    await expectApiError(() => setNotificationRule(db, ours, { kind: 'new_order', destinationId: theirChat, enabled: true, attachCsv: false }), 404, 'NOT_FOUND')
    expect(telegram.calls).toEqual([])
    expect((await telegramOverview(db, OTHER, SETTINGS)).rules).toEqual([])

    await setNotificationRule(db, ours, { kind: 'new_order', destinationId: mine, enabled: true, attachCsv: false })
    expect((await telegramOverview(db, OTHER, SETTINGS)).rules).toEqual([])
  })

  it('keeps a cafe\'s links to it: another cafe\'s admin can\'t read, confirm or cancel them', async () => {
    const link = await createLink(db, ours, SETTINGS, { kind: 'group' }, now)
    await expectApiError(() => getLink(db, theirs, link.id, now), 404, 'NOT_FOUND')
    await expectApiError(() => confirmLink(db, theirs, link.id, now), 404, 'NOT_FOUND')
    await expectApiError(() => cancelLink(db, telegram.api, theirs, link.id, now), 404, 'NOT_FOUND')
    // The same person as an owner of the other cafe: still not that cafe's link.
    const sameAccountElsewhere: Actor = { ...ours, tenantId: OTHER }
    await expectApiError(() => getLink(db, sameAccountElsewhere, link.id, now), 404, 'NOT_FOUND')
    await expectApiError(() => confirmLink(db, sameAccountElsewhere, link.id, now), 404, 'NOT_FOUND')
    expect((await getLink(db, ours, link.id, now)).status).toBe('waiting')
  })

  it('lets one Telegram group follow two cafes, and leaves it only when neither uses it', async () => {
    const forUs = await connectGroup(ours, later(1))
    const forThem = await connectGroup(theirs, later(2))
    expect(forThem.id).not.toBe(forUs.id)
    expect((await listDestinations(db, TEST_TENANT)).map(d => d.title)).toEqual(['Staff group'])
    expect((await listDestinations(db, OTHER)).map(d => d.title)).toEqual(['Staff group'])

    // We disconnect it: the bot stays, they still use it.
    await disconnectDestination(db, telegram.api, ours, forUs.id, forUs.version, later(3))
    expect(telegram.left()).toEqual([])
    expect((await listDestinations(db, OTHER)).map(d => d.status)).toEqual(['connected'])
    // They disconnect it too: now the bot leaves.
    await disconnectDestination(db, telegram.api, theirs, forThem.id, forThem.version, later(4))
    expect(telegram.left()).toEqual([String(group.id)])
  })

  it('sends an order\'s alert to its own cafe\'s chats only', async () => {
    const ourChat = await destination(TEST_TENANT, 'Our chat', '111')
    const theirChat = await destination(OTHER, 'Their chat', '222')
    await setNotificationRule(db, ours, { kind: 'new_order', destinationId: ourChat, enabled: true, attachCsv: false })
    await setNotificationRule(db, theirs, { kind: 'new_order', destinationId: theirChat, enabled: true, attachCsv: false })

    const branchId = newId()
    await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    await updateBranchSettings(db, ours, branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
    const coffee = await createCategory(db, ours, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
    const draft = await createItem(db, ours, { categoryId: coffee.id, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 350, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    const item = await publishItem(db, ours, draft.id, { version: draft.version })
    const customer: Actor = { userId: (await createUser(db, 'sokha@example.com', 'Sokha')).id, tenantId: TEST_TENANT, role: 'customer' }
    const { orderId } = await placeOrder(db, customer, { branchId, tableToken: null, lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }], expectedTotalMinor: 350 }, crypto.randomUUID(), new Date('2026-09-28T12:00:00+07:00'))

    // Their tenant can't alert about our order, and ours alerts only our chat.
    expect(await queueOrderAlert(db, OTHER, 'new_order', orderId)).toEqual([])
    expect(await queueOrderAlert(db, TEST_TENANT, 'new_order', orderId)).toHaveLength(1)
    expect((await db.select().from(notificationDeliveries)).map(d => [d.tenantId, d.destinationId])).toEqual([[TEST_TENANT, ourChat]])
  })

  it('keeps each cafe\'s delivery history and server errors to itself', async () => {
    const ourChat = await destination(TEST_TENANT, 'Our chat', '111')
    const theirChat = await destination(OTHER, 'Their chat', '222')
    await setNotificationRule(db, ours, { kind: 'server_error', destinationId: ourChat, enabled: true, attachCsv: false })
    await setNotificationRule(db, theirs, { kind: 'server_error', destinationId: theirChat, enabled: true, attachCsv: false })

    const [ourAlert] = await queueServerErrorAlert(db, TEST_TENANT, { method: 'GET', path: '/api/admin/menu/items', status: 500, requestId: 'r1' }, now)
    expect((await listDeliveries(db, TEST_TENANT)).map(d => d.destination.title)).toEqual(['Our chat'])
    expect(await listDeliveries(db, OTHER)).toEqual([])
    await expectApiError(() => deliverySnapshot(db, OTHER, ourAlert!), 404, 'NOT_FOUND')
    await expectApiError(() => retryDelivery(db, telegram.api, theirs, ourAlert!, now), 404, 'NOT_FOUND')
  })
})
