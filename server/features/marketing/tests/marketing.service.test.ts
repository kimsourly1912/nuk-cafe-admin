import { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreatePromotionInput } from '#shared/contracts/menu-promotions'
import { defaultCaption, postMenuUrl } from '#shared/contracts/marketing'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { createCategory } from '#server/features/menu/categories.service'
import { createItem, publishItem } from '#server/features/menu/items.service'
import { createPromotion, endPromotion, getPromotion } from '#server/features/menu/promotions.service'
import type { TelegramSettings } from '#server/features/notifications/notifications.settings'
import { orders } from '#server/features/orders/orders.schema'
import { placeOrder } from '#server/features/orders/orders.service'
import { promotionResults } from '#server/features/orders/reports.service'
import * as postRepo from '#server/features/marketing/marketing.repository'
import { marketingChannelLinks, marketingPosts } from '#server/features/marketing/marketing.schema'
import { connectCode, postUrl } from '#server/features/marketing/marketing.rules'
import { cancelChannelLink, cancelPost, confirmChannelLink, createChannelLink, createPosts, deliverDuePosts, disconnectChannel, getChannelLink, handleChannelUpdate, listChannels, listPosts, retryPost } from '#server/features/marketing/marketing.service'
import { createAdmin, createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// Marketing channels and posts (M2a, D164) against the migrations and the real promotions, with
// grammY's real `Api` talking to a fake Telegram through its `fetch` option.

const SETTINGS: TelegramSettings = { botToken: '777:test', botUsername: 'NukCafeBot', webhookSecret: 's'.repeat(40) }
const CAFE_URL = 'https://cafe.example/c/tenant-1'
const OTHER = 'tenant-2'

interface Call { method: string, payload: Record<string, unknown> | null, multipart: boolean }
type Answer = { ok: true, result: unknown } | { ok: false, error_code: number, description: string, parameters?: Record<string, unknown> }

class FakeTelegram {
  calls: Call[] = []
  answers: Record<string, (payload: Record<string, unknown> | null) => Answer> = {}
  private messageId = 100
  readonly api = new Api(SETTINGS.botToken, {
    fetch: (async (url: string | URL, init?: { body?: unknown }) => {
      const method = String(url).split('/').pop()!
      const multipart = !!init?.body && typeof init.body !== 'string'
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
      this.calls.push({ method, payload, multipart })
      const answer = this.answers[method]?.(payload) ?? this.defaultAnswer(method)
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  })

  private defaultAnswer(method: string): Answer {
    if (method === 'getChatMember') return { ok: true, result: { status: 'administrator', can_post_messages: true, user: { id: 777, is_bot: true, first_name: 'Bot' } } }
    if (method === 'getChatMemberCount') return { ok: true, result: 1250 }
    if (method === 'getWebhookInfo') return { ok: true, result: { url: 'https://cafe.example/api/webhooks/telegram', has_custom_certificate: false, pending_update_count: 0, allowed_updates: ['message', 'my_chat_member'] } }
    if (method === 'sendMessage' || method === 'sendPhoto') return { ok: true, result: { message_id: ++this.messageId, date: 0, chat: { id: -1001, type: 'channel', title: 'x' } } }
    return { ok: true, result: true }
  }

  of = (method: string) => this.calls.filter(c => c.method === method)
}

const admin: Actor = { userId: '', tenantId: TEST_TENANT, role: 'owner' }
const theirs: Actor = { userId: '', tenantId: OTHER, role: 'owner' }
const store: ObjectStore = { put: async () => undefined, del: async () => undefined }
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array.from({ length: 32 }, (_, i) => i)])
const readObject = async () => new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>

/** Thursday 2026-10-15, noon in Phnom Penh. */
const NOW = new Date('2026-10-15T12:00:00+07:00')
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const channel = { id: -1001234567890, type: 'channel' as const, title: 'NUK Cafe News', username: 'nukcafe' }
let updateId = 1
const channelPost = (text: string, chat: object = channel): Update => ({ update_id: updateId++, channel_post: { message_id: updateId, date: 0, chat, text } } as unknown as Update)
const botStatus = (status: string, old = 'administrator', chat: object = channel): Update => ({
  update_id: updateId++,
  my_chat_member: { chat, from: { id: 1, is_bot: false, first_name: 'A' }, date: 0, old_chat_member: { status: old, user: { id: 777, is_bot: true, first_name: 'Bot' } }, new_chat_member: { status, user: { id: 777, is_bot: true, first_name: 'Bot' } } },
} as unknown as Update)

let db: Db
let telegram: FakeTelegram
let promotionId: string
let coffee: string

async function setUpMenu(actor: Actor, categoryName = 'Coffee') {
  const branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh', tenantId: actor.tenantId })
  const category = await createCategory(db, actor, { name: categoryName, description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, actor, { categoryId: category.id, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 350, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const item = await publishItem(db, actor, draft.id, { version: draft.version })
  return { branchId, categoryId: category.id, item }
}

const promotionInput = (over: Partial<CreatePromotionInput> = {}): CreatePromotionInput => ({
  name: 'Coffee week',
  description: 'Every coffee, all week.',
  discount: { kind: 'percent', percent: 20 },
  scope: 'selected',
  itemIds: [],
  categoryIds: [coffee],
  branchIds: [],
  startsOn: '2026-10-15',
  endsOn: '2026-10-21',
  posterId: null,
  publish: true,
  ...over,
})

/** Connects the test channel to `actor`'s cafe through the code flow. */
async function connect(actor: Actor, chat: object = channel) {
  const link = await createChannelLink(db, telegram.api, actor, SETTINGS, NOW)
  await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command, chat), NOW)
  return confirmChannelLink(db, actor, link.id, NOW)
}

const postInput = (channelIds: string[], over: Partial<{ caption: string, withPoster: boolean, at: string | null }> = {}) => ({ channelIds, caption: 'Coffee week: 20% off <3', withPoster: true, at: null, ...over })

beforeEach(async () => {
  db = await createTestDb()
  telegram = new FakeTelegram()
  admin.userId = (await createAdmin(db)).userId
  theirs.userId = (await createAdmin(db, undefined, OTHER)).userId
  coffee = (await setUpMenu(admin)).categoryId
  promotionId = (await createPromotion(db, admin, promotionInput(), NOW)).id
})

describe('rules', () => {
  it('reads a connect code only from /connect, for this bot', () => {
    expect(connectCode('/connect abcd2345ef', 'NukCafeBot')).toBe('ABCD2345EF')
    expect(connectCode('  /connect@NukCafeBot ABCD2345EF ', 'NukCafeBot')).toBe('ABCD2345EF')
    expect(connectCode('/connect@OtherBot ABCD2345EF', 'NukCafeBot')).toBeNull()
    expect(connectCode('/connect ABCD', 'NukCafeBot')).toBeNull()
    expect(connectCode('hello', 'NukCafeBot')).toBeNull()
    expect(connectCode(undefined, 'NukCafeBot')).toBeNull()
  })

  it('links a public channel\'s post by name and a private one by id', () => {
    expect(postUrl({ username: 'nukcafe', externalId: '-1001234567890' }, 42)).toBe('https://t.me/nukcafe/42')
    expect(postUrl({ username: null, externalId: '-1001234567890' }, 42)).toBe('https://t.me/c/1234567890/42')
  })

  it('starts a caption from the promotion, and links the menu with the offer and the source', () => {
    expect(defaultCaption({ name: 'Coffee week', label: '20% off', description: 'Every coffee.', endsOn: '2026-10-21' })).toBe('Coffee week: 20% off\n\nEvery coffee.\n\nUntil 21 Oct.')
    expect(defaultCaption({ name: 'Always', label: '$1.00 off', description: '', endsOn: null })).toBe('Always: $1.00 off')
    expect(postMenuUrl('https://x.example/c/nuk/', 'p-1', 'telegram')).toBe('https://x.example/c/nuk?promo=p-1&src=telegram')
  })
})

describe('connecting a channel', () => {
  it('connects by the code posted in the channel, after the admin confirms', async () => {
    const link = await createChannelLink(db, telegram.api, admin, SETTINGS, NOW)
    expect(link).toMatchObject({ status: 'waiting', botUsername: 'NukCafeBot', addBotUrl: 'https://t.me/NukCafeBot?startchannel&admin=post_messages+delete_messages' })
    expect(link.command).toMatch(/^\/connect [A-Z2-7]{10}$/)
    // Only the code's hash is kept.
    const [row] = await db.select().from(marketingChannelLinks)
    expect(row!.codeHash).not.toContain(link.command.slice(9))
    // The webhook is asked for channel posts too, keeping its address and secret.
    expect(telegram.of('setWebhook')[0]!.payload).toMatchObject({ url: 'https://cafe.example/api/webhooks/telegram', secret_token: SETTINGS.webhookSecret, allowed_updates: ['message', 'my_chat_member', 'channel_post'] })

    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command), NOW)
    expect(await getChannelLink(db, admin, link.id, NOW)).toMatchObject({ status: 'confirm', channel: { title: 'NUK Cafe News', username: 'nukcafe', subscriberCount: 1250 } })
    // The code post is deleted from the channel.
    expect(telegram.of('deleteMessage')).toHaveLength(1)
    // Nothing is connected until the admin confirms.
    expect(await listChannels(db, TEST_TENANT)).toEqual([])

    const connected = await confirmChannelLink(db, admin, link.id, NOW)
    expect(connected).toMatchObject({ kind: 'telegram_channel', title: 'NUK Cafe News', username: 'nukcafe', subscriberCount: 1250, status: 'connected', connectedBy: 'Admin' })
    expect(await getChannelLink(db, admin, link.id, NOW)).toMatchObject({ status: 'connected', channelId: connected.id })
    expect(await listChannels(db, TEST_TENANT)).toHaveLength(1)
    // A code works once.
    await expectApiError(() => confirmChannelLink(db, admin, link.id, NOW), 409, 'CHANNEL_LINK_UNUSABLE')
  })

  it('waits while the bot can\'t post in the channel, and ignores a wrong, expired or repeated code', async () => {
    const link = await createChannelLink(db, telegram.api, admin, SETTINGS, NOW)
    telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'member', user: { id: 777, is_bot: true, first_name: 'Bot' } } })
    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command), NOW)
    expect((await getChannelLink(db, admin, link.id, NOW)).status).toBe('waiting')
    delete telegram.answers.getChatMember

    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost('/connect AAAAAAAAAA'), NOW)
    // In a group, not a channel: ignored.
    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command, { id: -500, type: 'supergroup', title: 'Staff' }), NOW)
    expect((await getChannelLink(db, admin, link.id, NOW)).status).toBe('waiting')
    // After 15 minutes the code is dead.
    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command), later(16))
    expect((await getChannelLink(db, admin, link.id, later(16))).status).toBe('expired')

    const fresh = await createChannelLink(db, telegram.api, admin, SETTINGS, NOW)
    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(fresh.command), NOW)
    // Telegram resends the update: nothing changes, no error.
    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(fresh.command), NOW)
    expect((await getChannelLink(db, admin, fresh.id, NOW)).status).toBe('confirm')
  })

  it('shows a code only to the admin who made it, and Cancel makes the bot leave', async () => {
    const link = await createChannelLink(db, telegram.api, admin, SETTINGS, NOW)
    const colleague: Actor = { userId: (await createAdmin(db)).userId, tenantId: TEST_TENANT, role: 'owner' }
    await expectApiError(() => getChannelLink(db, colleague, link.id, NOW), 404, 'NOT_FOUND')
    await expectApiError(() => confirmChannelLink(db, { ...theirs }, link.id, NOW), 404, 'NOT_FOUND')

    await handleChannelUpdate(db, telegram.api, SETTINGS, channelPost(link.command), NOW)
    expect((await cancelChannelLink(db, telegram.api, admin, link.id, NOW)).status).toBe('cancelled')
    expect(telegram.of('leaveChat')).toHaveLength(1)
    await expectApiError(() => confirmChannelLink(db, admin, link.id, NOW), 409, 'CHANNEL_LINK_UNUSABLE')
  })

  it('marks the channel removed when the bot is removed or demoted, and reconnects it', async () => {
    const first = await connect(admin)
    await handleChannelUpdate(db, telegram.api, SETTINGS, botStatus('member'), NOW)
    expect((await listChannels(db, TEST_TENANT))[0]).toMatchObject({ id: first.id, status: 'removed' })
    // Posting there is refused, naming the channel.
    await expectApiError(() => createPosts(db, admin, promotionId, postInput([first.id]), crypto.randomUUID(), CAFE_URL, NOW), 409, 'CHANNEL_REMOVED', ['channelIds'])

    const again = await connect(admin)
    expect(again).toMatchObject({ id: first.id, status: 'connected' })
  })

  it('disconnects at the version read; the bot leaves only when no cafe uses the channel', async () => {
    const ours = await connect(admin)
    const theirsChannel = await connect(theirs)
    expect(theirsChannel.id).not.toBe(ours.id)

    await expectApiError(() => disconnectChannel(db, telegram.api, admin, ours.id, ours.version + 1, NOW), 409, 'VERSION_CONFLICT')
    await disconnectChannel(db, telegram.api, admin, ours.id, ours.version, NOW)
    expect(await listChannels(db, TEST_TENANT)).toEqual([])
    expect(telegram.of('leaveChat')).toHaveLength(0)
    expect(await listChannels(db, OTHER)).toHaveLength(1)

    await disconnectChannel(db, telegram.api, theirs, theirsChannel.id, theirsChannel.version, NOW)
    expect(telegram.of('leaveChat')).toHaveLength(1)
    // Another cafe's channel is not found.
    await expectApiError(() => disconnectChannel(db, telegram.api, admin, theirsChannel.id, 1, NOW), 404, 'NOT_FOUND')
  })
})

describe('posts', () => {
  it('posts now with the poster, an escaped caption and the Order now button', async () => {
    const poster = await uploadImage(db, store, admin, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
    const withPoster = await createPromotion(db, admin, promotionInput({ name: 'Poster week', posterId: poster.id }), NOW)
    const ch = await connect(admin)
    const [post] = await createPosts(db, admin, withPoster.id, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW)
    expect(post).toMatchObject({ status: 'pending', withPoster: true, attempts: 0, channel: { id: ch.id, title: 'NUK Cafe News' }, createdBy: 'Admin' })

    expect(await deliverDuePosts(db, telegram.api, readObject, NOW, { ids: [post!.id] })).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0 })
    const photo = telegram.of('sendPhoto')
    expect(photo).toHaveLength(1)
    expect(photo[0]!.multipart).toBe(true)
    const [sent] = await listPosts(db, TEST_TENANT, withPoster.id)
    expect(sent).toMatchObject({ status: 'sent', url: 'https://t.me/nukcafe/101', attempts: 1 })
    const [row] = await db.select().from(marketingPosts).where(eq(marketingPosts.id, post!.id))
    expect(row!.message).toEqual({ html: 'Coffee week: 20% off &lt;3', photoKey: expect.stringMatching(/\.(png|webp)$/), button: { text: 'Order now', url: `${CAFE_URL}?promo=${withPoster.id}&src=telegram` } })
  })

  it('sends a text post without a poster', async () => {
    const ch = await connect(admin)
    const [post] = await createPosts(db, admin, promotionId, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW)
    expect(post!.withPoster).toBe(false)
    await deliverDuePosts(db, telegram.api, readObject, NOW)
    expect(telegram.of('sendPhoto')).toHaveLength(0)
    expect(telegram.of('sendMessage')[0]!.payload).toMatchObject({ chat_id: String(channel.id), text: 'Coffee week: 20% off &lt;3', parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Order now', url: `${CAFE_URL}?promo=${promotionId}&src=telegram` }]] } })
  })

  it('schedules a post for its time, up to 30 days ahead, and Cancel stops it', async () => {
    const ch = await connect(admin)
    await expectApiError(() => createPosts(db, admin, promotionId, postInput([ch.id], { at: later(-5).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW), 422, 'POST_TIME_INVALID', ['at'])
    await expectApiError(() => createPosts(db, admin, promotionId, postInput([ch.id], { at: later(31 * 24 * 60).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW), 422, 'POST_TIME_INVALID', ['at'])

    const [post] = await createPosts(db, admin, promotionId, postInput([ch.id], { at: later(60).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW)
    expect(await deliverDuePosts(db, telegram.api, readObject, later(59))).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 })
    const [other] = await createPosts(db, admin, promotionId, postInput([ch.id], { at: later(60).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW)
    expect((await cancelPost(db, admin, other!.id, { version: other!.version })).status).toBe('cancelled')
    expect(await deliverDuePosts(db, telegram.api, readObject, later(60))).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0 })
    // A sent post can't be cancelled.
    const [sent] = (await listPosts(db, TEST_TENANT, promotionId)).filter(p => p.id === post!.id)
    await expectApiError(() => cancelPost(db, admin, sent!.id, { version: sent!.version }), 409, 'INVALID_STATE')
  })

  it('gives the same posts back for a repeated key', async () => {
    const ch = await connect(admin)
    const key = crypto.randomUUID()
    const first = await createPosts(db, admin, promotionId, postInput([ch.id]), key, CAFE_URL, NOW)
    const again = await createPosts(db, admin, promotionId, postInput([ch.id]), key, CAFE_URL, NOW)
    expect(again.map(p => p.id)).toEqual(first.map(p => p.id))
    expect(await db.select().from(marketingPosts)).toHaveLength(1)
  })

  it('refuses an ended or draft promotion, and another cafe\'s promotion or channel', async () => {
    const ch = await connect(admin)
    const draft = await createPromotion(db, admin, promotionInput({ name: 'Draft', publish: false }), NOW)
    await expectApiError(() => createPosts(db, admin, draft.id, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW), 409, 'PROMOTION_NOT_RUNNING')

    const theirMenu = await setUpMenu(theirs)
    const theirPromotion = await createPromotion(db, theirs, promotionInput({ categoryIds: [theirMenu.categoryId] }), NOW)
    const theirChannel = await connect(theirs, { ...channel, id: -1009, username: 'theirs' })
    await expectApiError(() => createPosts(db, admin, theirPromotion.id, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW), 404, 'NOT_FOUND')
    await expectApiError(() => createPosts(db, admin, promotionId, postInput([theirChannel.id]), crypto.randomUUID(), CAFE_URL, NOW), 404, 'NOT_FOUND')
    await expectApiError(() => listPosts(db, TEST_TENANT, theirPromotion.id), 404, 'NOT_FOUND')
  })

  it('cancels a post whose promotion ended before its time', async () => {
    const ch = await connect(admin)
    await createPosts(db, admin, promotionId, postInput([ch.id], { at: later(60).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW)
    expect((await listPosts(db, TEST_TENANT, promotionId))[0]!.status).toBe('pending')
    const current = await getPromotion(db, TEST_TENANT, promotionId, NOW)
    await endPromotion(db, admin, promotionId, { version: current.version }, later(1))
    expect(await deliverDuePosts(db, telegram.api, readObject, later(60))).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 1 })
    expect((await listPosts(db, TEST_TENANT, promotionId))[0]).toMatchObject({ status: 'cancelled', reason: 'The promotion ended before this post went out.' })
    expect(telegram.of('sendMessage')).toHaveLength(0)
  })
})

describe('delivery', () => {
  async function onePost() {
    const ch = await connect(admin)
    const [post] = await createPosts(db, admin, promotionId, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW)
    return { ch, post: post! }
  }
  const stateOf = async (id: string) => (await db.select().from(marketingPosts).where(eq(marketingPosts.id, id)))[0]!

  it('ignores a stale post claim after another worker takes it', async () => {
    const { post } = await onePost()
    const old = (await postRepo.claimPost(db, post.id, NOW, later(2)))!
    const current = (await postRepo.claimPost(db, post.id, later(3), later(5)))!
    expect(current.attempts).toBe(2)
    expect(await postRepo.settlePost(db, post.id, old.claimToken, { status: 'failed', reason: 'stale' })).toBe(false)
    expect(await postRepo.settlePost(db, post.id, old.claimToken, { status: 'sent' })).toBe(false)
    expect(await postRepo.settlePost(db, post.id, current.claimToken, { status: 'sent', sentAt: later(4) })).toBe(true)
    expect(await stateOf(post.id)).toMatchObject({ status: 'sent', attempts: 2, reason: null, claimToken: null })
  })

  it('retries a failure later, and gives up after five tries', async () => {
    const { post } = await onePost()
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 500, description: 'Internal Server Error' })
    let now = NOW
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await deliverDuePosts(db, telegram.api, readObject, now)).toMatchObject({ retried: 1 })
      now = (await stateOf(post.id)).nextAttemptAt
    }
    expect(await deliverDuePosts(db, telegram.api, readObject, now)).toMatchObject({ failed: 1 })
    expect(await stateOf(post.id)).toMatchObject({ status: 'failed', attempts: 5, reason: 'Telegram didn\'t accept it after 5 tries.' })

    // Try again starts over and goes out.
    delete telegram.answers.sendMessage
    const failed = (await listPosts(db, TEST_TENANT, promotionId))[0]!
    expect(await retryPost(db, admin, post.id, { version: failed.version }, now)).toMatchObject({ status: 'pending', attempts: 0, reason: null })
    expect(await deliverDuePosts(db, telegram.api, readObject, now)).toMatchObject({ sent: 1 })
  })

  it('waits as long as Telegram asks without counting it as a try', async () => {
    const { post } = await onePost()
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } })
    expect(await deliverDuePosts(db, telegram.api, readObject, NOW)).toMatchObject({ retried: 1 })
    expect(await stateOf(post.id)).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: new Date(NOW.getTime() + 7000) })
  })

  it('fails at once on a 400, and marks the channel removed on a 403', async () => {
    const { ch, post } = await onePost()
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 400, description: 'Bad Request: can\'t parse entities' })
    expect(await deliverDuePosts(db, telegram.api, readObject, NOW)).toMatchObject({ failed: 1 })
    expect(await stateOf(post.id)).toMatchObject({ status: 'failed', attempts: 1, reason: 'Telegram refused this post.' })

    const [second] = await createPosts(db, admin, promotionId, postInput([ch.id]), crypto.randomUUID(), CAFE_URL, NOW)
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat' })
    expect(await deliverDuePosts(db, telegram.api, readObject, NOW)).toMatchObject({ failed: 1 })
    expect(await stateOf(second!.id)).toMatchObject({ status: 'failed', reason: 'The bot is no longer an admin of this channel.' })
    expect((await listChannels(db, TEST_TENANT))[0]!.status).toBe('removed')
  })

  it('never sends a post twice when two runs overlap', async () => {
    await onePost()
    const reports = await Promise.all([
      deliverDuePosts(db, telegram.api, readObject, NOW),
      deliverDuePosts(db, telegram.api, readObject, NOW),
    ])
    expect(reports.reduce((sum, r) => sum + r.sent, 0)).toBe(1)
    expect(telegram.of('sendMessage')).toHaveLength(1)
  })

  it('refuses Cancel when the task claimed the post meanwhile', async () => {
    const ch = await connect(admin)
    const [post] = await createPosts(db, admin, promotionId, postInput([ch.id], { at: later(5).toISOString() }), crypto.randomUUID(), CAFE_URL, NOW)
    // Between Cancel's checks and its write, the task claims the post (version + 1).
    const racing = interleaved(db, () => db.update(marketingPosts).set({ attempts: 1, version: post!.version + 1 }).where(eq(marketingPosts.id, post!.id)))
    await expectApiError(() => cancelPost(racing, admin, post!.id, { version: post!.version }), 409, 'VERSION_CONFLICT')
    expect((await stateOf(post!.id)).status).toBe('pending')
  })

  it('refuses Try again when someone else retried it first', async () => {
    const { post } = await onePost()
    await db.update(marketingPosts).set({ status: 'failed' }).where(eq(marketingPosts.id, post.id))
    const failed = await stateOf(post.id)
    const racing = interleaved(db, () => db.update(marketingPosts).set({ status: 'pending', version: failed.version + 1 }).where(eq(marketingPosts.id, post.id)))
    await expectApiError(() => retryPost(racing, admin, post.id, { version: failed.version }, NOW), 409, 'VERSION_CONFLICT')
  })
})

describe('where orders came from', () => {
  it('keeps the source on the order and counts it in the promotion\'s results', async () => {
    const menu = await setUpMenu(admin, 'Tea')
    await updateBranchSettings(db, admin, menu.branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
    const promotion = await createPromotion(db, admin, promotionInput({ name: 'Second', categoryIds: [menu.categoryId] }), NOW)
    const customer: Actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' }
    const lines = [{ itemId: menu.item.id, variationId: menu.item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }]
    const fromTelegram = await placeOrder(db, customer, { branchId: menu.branchId, tableToken: null, lines, expectedTotalMinor: 280, source: 'telegram' }, crypto.randomUUID(), NOW)
    const direct = await placeOrder(db, customer, { branchId: menu.branchId, tableToken: null, lines, expectedTotalMinor: 280 }, crypto.randomUUID(), NOW)
    await db.update(orders).set({ status: 'completed' })
    expect((await db.select({ id: orders.id, source: orders.source }).from(orders)).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: fromTelegram.orderId, source: 'telegram' },
      { id: direct.orderId, source: null },
    ].sort((a, b) => a.id.localeCompare(b.id)))
    expect(await promotionResults(db, TEST_TENANT, promotion.id)).toMatchObject({ orders: 2, bySource: { telegram: 1, facebook: 0 } })
  })
})
