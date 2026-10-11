import type { Api } from 'grammy'
import { GrammyError, InputFile } from 'grammy'
import type { Message, Update } from 'grammy/types'
import type { ChannelLink, CreatePostsInput, MarketingChannel, MarketingPost, NewChannelLink, PostVersionInput } from '#shared/contracts/marketing'
import { CHANNEL_LINK_MINUTES, POST_MAX_ATTEMPTS, POST_SCHEDULE_MAX_DAYS, postMenuUrl } from '#shared/contracts/marketing'
import type { Actor } from '#server/features/identity'
import { getPromotion } from '#server/features/menu'
import type { TelegramSettings } from '#server/features/notifications'
import { auditStatement, retryDelayMs, withIdempotency } from '#server/features/platform'
import type { Db } from '#server/utils/batch'
import { isStaleWrite, requireOneChange, runBatch } from '#server/utils/batch'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { toIso } from '#server/utils/time'
import { channelChanged, channelLinkNotFound, channelLinkUnusable, channelNotFound, channelRemoved, postChanged, postNotFailed, postNotFound, postNotPending, postTimeInvalid, promotionNotRunning } from './marketing.errors'
import * as repo from './marketing.repository'
import { addBotUrl, connectCode, escapeHtml, hashChannelCode, isChannel, newChannelCode, postUrl } from './marketing.rules'

/**
 * Marketing (step M2a, D164): the cafe's Telegram channel, connected by posting a one-time code in
 * it, and promotions posted there now or at a time. `api` is grammY's `Api` for the platform's bot
 * (routes and the task make it from the settings; tests give it a fake).
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** How long a run holds a post while sending it. */
const CLAIM_MS = 2 * MINUTE

function channelOf(row: repo.ChannelRow): MarketingChannel {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    username: row.username,
    subscriberCount: row.subscriberCount,
    status: row.status === 'removed' ? 'removed' : 'connected',
    connectedBy: row.connectedByName,
    connectedAt: toIso(row.connectedAt),
    version: row.version,
  }
}

function linkOf(row: repo.LinkRow, now: Date): ChannelLink {
  const live = row.status === 'waiting' || row.status === 'confirm'
  return {
    id: row.id,
    status: live && row.expiresAt <= now ? 'expired' : row.status,
    expiresAt: toIso(row.expiresAt),
    channel: row.chatTitle ? { title: row.chatTitle, username: row.chatUsername, subscriberCount: row.memberCount } : null,
    channelId: row.channelId,
  }
}

const audit = (db: Db, actor: Pick<Actor, 'userId' | 'tenantId'>, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) =>
  auditStatement(db, actor, { action: `marketing.${action}`, targetType, targetId, metadata })

export async function listChannels(db: Db, tenantId: string): Promise<MarketingChannel[]> {
  return (await repo.listChannels(db, tenantId)).map(channelOf)
}

// --- Connecting a channel ---

/**
 * Telegram sends the bot a channel's posts only when its webhook asks for `channel_post`. The
 * platform's webhook was set up before channels (operations.md → Telegram): add it, keeping the
 * address, the secret and the other kinds. Best effort: a failure is logged, and the connect dialog
 * then never sees the code (the operations guide's command fixes it by hand).
 */
async function ensureChannelUpdates(api: Api, settings: TelegramSettings) {
  try {
    const info = await api.getWebhookInfo()
    const kinds = info.allowed_updates ?? []
    // An empty list means every kind but a few: channel posts come already.
    if (!info.url || !kinds.length || kinds.includes('channel_post')) return
    await api.setWebhook(info.url, { secret_token: settings.webhookSecret, allowed_updates: [...kinds, 'channel_post'] as typeof kinds })
    log('info', 'Telegram: the webhook now receives channel posts')
  }
  catch (error) {
    log('warn', 'Telegram: could not check the webhook for channel posts', { error: String(error) })
  }
}

/** A one-time `/connect` code for the admin to post in the channel. The code is only in this answer. */
export async function createChannelLink(db: Db, api: Api, actor: Actor, settings: TelegramSettings, now = new Date()): Promise<NewChannelLink> {
  await ensureChannelUpdates(api, settings)
  await repo.deleteOldLinks(db, new Date(now.getTime() - DAY))
  const code = newChannelCode()
  const id = newId()
  const expiresAt = new Date(now.getTime() + CHANNEL_LINK_MINUTES * MINUTE)
  await db.batch([repo.insertLinkStatement(db, { id, tenantId: actor.tenantId, codeHash: await hashChannelCode(code), createdBy: actor.userId, expiresAt, createdAt: now })])
  return {
    id,
    status: 'waiting',
    expiresAt: toIso(expiresAt),
    channel: null,
    channelId: null,
    command: `/connect ${code}`,
    addBotUrl: addBotUrl(settings.botUsername),
    botUsername: settings.botUsername,
  }
}

async function ownLink(db: Db, actor: Actor, id: string) {
  const row = await repo.findLink(db, actor.tenantId, id)
  if (!row || row.createdBy !== actor.userId) throw channelLinkNotFound()
  return row
}

/** A code's progress, for the admin who made it (the dialog asks every few seconds). */
export async function getChannelLink(db: Db, actor: Actor, id: string, now = new Date()): Promise<ChannelLink> {
  return linkOf(await ownLink(db, actor, id), now)
}

/** The admin confirms the channel the code was posted in: it's connected. */
export async function confirmChannelLink(db: Db, actor: Actor, id: string, now = new Date()): Promise<MarketingChannel> {
  const row = await ownLink(db, actor, id)
  if (row.status !== 'confirm' || !row.chatId || !row.chatTitle) throw channelLinkUnusable()
  const channelId = (await repo.findChannelByExternal(db, actor.tenantId, row.chatId))?.id ?? newId()
  // The channel first (the code points at it), then the code, guarded: a used or expired code undoes both.
  await runBatch(db, [
    repo.upsertChannelStatement(db, channelId, { tenantId: actor.tenantId, externalId: row.chatId, title: row.chatTitle, username: row.chatUsername, subscriberCount: row.memberCount, connectedBy: actor.userId, at: now }),
    repo.advanceLinkStatement(db, id, ['confirm'], { status: 'connected', channelId }, now),
    requireOneChange(db),
    audit(db, actor, 'channel.connect', 'marketing_channel', channelId, { kind: 'telegram_channel' }),
  ], channelLinkUnusable)
  return channelOf((await repo.findChannel(db, actor.tenantId, channelId))!)
}

async function leaveQuietly(api: Api, chatId: string) {
  try {
    await api.leaveChat(chatId)
  }
  catch (error) {
    log('warn', 'Telegram: could not leave a channel', { error: String(error) })
  }
}

/** The admin doesn't want that channel: the code ends, and the bot leaves it (unless a cafe uses it). */
export async function cancelChannelLink(db: Db, api: Api, actor: Actor, id: string, now = new Date()): Promise<ChannelLink> {
  const row = await ownLink(db, actor, id)
  const cancelled = await repo.cancelLink(db, id)
  if (cancelled && row.status === 'confirm' && row.chatId && !await repo.channelConnectedAnywhere(db, row.chatId)) await leaveQuietly(api, row.chatId)
  return linkOf((await repo.findLink(db, actor.tenantId, id))!, now)
}

/** Nothing more is posted there; the bot leaves the channel unless another cafe still uses it. Its posts stay. */
export async function disconnectChannel(db: Db, api: Api, actor: Actor, id: string, version: number, now = new Date()): Promise<void> {
  const row = await repo.findChannel(db, actor.tenantId, id)
  if (!row || row.status === 'disconnected') throw channelNotFound()
  await runBatch(db, [
    repo.disconnectChannelStatement(db, actor.tenantId, id, version, now),
    requireOneChange(db),
    audit(db, actor, 'channel.disconnect', 'marketing_channel', id),
  ], channelChanged)
  if (row.status === 'connected' && !await repo.channelConnectedAnywhere(db, row.externalId)) await leaveQuietly(api, row.externalId)
}

/** The bot's own id is the token's first part (`123456:ABC…`). */
const botIdOf = (settings: TelegramSettings) => Number(settings.botToken.split(':')[0])

async function useCode(db: Db, api: Api, settings: TelegramSettings, post: Message, code: string, now: Date) {
  const chat = post.chat
  const link = await repo.findLinkByCode(db, await hashChannelCode(code))
  if (!link || link.status !== 'waiting' || link.expiresAt <= now) return
  // The bot must be able to post there; otherwise the code waits (the dialog says what to check).
  const rights = await api.getChatMember(chat.id, botIdOf(settings)).catch(() => null)
  if (rights?.status !== 'administrator' || rights.can_post_messages === false) {
    log('info', 'Telegram: a channel posted a connect code but the bot can\'t post there')
    return
  }
  const subscribers = await api.getChatMemberCount(chat.id).catch(() => null)
  const title = 'title' in chat && chat.title ? chat.title : 'Telegram channel'
  const username = 'username' in chat && chat.username ? chat.username : null
  try {
    await db.batch([
      repo.advanceLinkStatement(db, link.id, ['waiting'], { status: 'confirm', chatId: String(chat.id), chatTitle: title, chatUsername: username, memberCount: subscribers }, now),
      requireOneChange(db),
    ])
  }
  catch (error) {
    // Used a moment ago (Telegram resent the update): already handled.
    if (isStaleWrite(error)) return
    throw error
  }
  // The code did its work: it doesn't stay in the channel for subscribers to see.
  await api.deleteMessage(chat.id, post.message_id).catch(() => undefined)
}

/**
 * Channel updates from the webhook (the route calls it beside the notifications' own handler):
 * a `/connect <code>` post in a channel, and the bot removed from a channel (every cafe's row for
 * it is marked removed). Anything else is ignored; every update can come twice.
 */
export async function handleChannelUpdate(db: Db, api: Api, settings: TelegramSettings, update: Update, now = new Date()): Promise<void> {
  const member = update.my_chat_member
  if (member && isChannel(member.chat)) {
    const status = member.new_chat_member.status
    if (status === 'left' || status === 'kicked' || (status === 'member' && member.old_chat_member.status === 'administrator')) {
      if (await repo.markRemoved(db, String(member.chat.id), now)) log('info', 'Telegram: the bot was removed from a channel')
    }
    return
  }
  const post = update.channel_post
  if (!post || !isChannel(post.chat)) return
  const code = connectCode(post.text, settings.botUsername)
  if (code) await useCode(db, api, settings, post, code, now)
}

// --- Posts ---

function postOf(row: repo.PostRow, kind: MarketingPost['channel']['kind'] = 'telegram_channel'): MarketingPost {
  return {
    id: row.id,
    promotionId: row.promotionId,
    channel: { id: row.channelId, title: row.channelTitle, kind },
    status: row.status,
    caption: row.caption,
    withPoster: !!row.message.photoKey,
    scheduledAt: toIso(row.scheduledAt),
    attempts: row.attempts,
    sentAt: row.sentAt ? toIso(row.sentAt) : null,
    url: row.externalUrl,
    reason: row.reason,
    createdBy: row.createdByName,
    createdAt: toIso(row.createdAt),
    version: row.version,
  }
}

/** A promotion's posts, latest first (another cafe's promotion is 404, from the menu feature). */
export async function listPosts(db: Db, tenantId: string, promotionId: string): Promise<MarketingPost[]> {
  await getPromotion(db, tenantId, promotionId)
  return (await repo.listPosts(db, tenantId, promotionId)).map(row => postOf(row))
}

/** The poster's stored object from its address (`/media/<key>`). */
const objectKeyOf = (url: string) => url.replace(/^\/media\//, '')

/**
 * Posts a promotion to each chosen channel (header `Idempotency-Key`: a retry after a lost answer
 * gets the same posts back, never a second set). Saved before they're sent; `at` null: due now
 * (the route sends them at once), otherwise at that time, up to 30 days ahead.
 */
export async function createPosts(db: Db, actor: Actor, promotionId: string, input: CreatePostsInput, key: string, cafeUrl: string | undefined, now = new Date()): Promise<MarketingPost[]> {
  if (!cafeUrl) throw apiError(500, ErrorCodes.INTERNAL, 'This server doesn\'t know its own address (NUXT_PUBLIC_SITE_URL).')
  const { response } = await withIdempotency(db, { tenantId: actor.tenantId, actorId: actor.userId, operation: 'marketing.post', key }, input, async () => {
    const promotion = await getPromotion(db, actor.tenantId, promotionId, now)
    if (promotion.phase !== 'live' && promotion.phase !== 'scheduled') throw promotionNotRunning()
    let scheduledAt = now
    if (input.at) {
      scheduledAt = new Date(input.at)
      if (scheduledAt.getTime() < now.getTime() - MINUTE) throw postTimeInvalid('That time has passed. Choose a later one, or Post now.')
      if (scheduledAt.getTime() > now.getTime() + POST_SCHEDULE_MAX_DAYS * DAY) throw postTimeInvalid(`Choose a time within ${POST_SCHEDULE_MAX_DAYS} days.`)
    }
    const channels = await repo.findChannels(db, actor.tenantId, input.channelIds)
    for (const id of input.channelIds) {
      const channel = channels.find(c => c.id === id)
      if (!channel || channel.status === 'disconnected') throw channelNotFound()
      if (channel.status !== 'connected') throw channelRemoved(channel.title)
    }
    const message = {
      html: escapeHtml(input.caption),
      ...(input.withPoster && promotion.poster ? { photoKey: objectKeyOf(promotion.poster.url) } : {}),
      button: { text: 'Order now', url: postMenuUrl(cafeUrl, promotion.id, 'telegram') },
    }
    const posts = input.channelIds.map((channelId): repo.NewPost => ({ id: newId(), tenantId: actor.tenantId, promotionId, channelId, caption: input.caption, message, scheduledAt, createdBy: actor.userId, createdAt: now }))
    return {
      statements: [
        ...posts.map(post => repo.insertPostStatement(db, post)),
        audit(db, actor, 'post.create', 'menu_promotion', promotionId, { channelIds: input.channelIds, at: input.at, withPoster: !!message.photoKey }),
      ],
      response: { ids: posts.map(post => post.id) },
    }
  }, { now })
  return (await repo.findPostsByIds(db, actor.tenantId, response.ids)).map(row => postOf(row))
}

async function openPost(db: Db, tenantId: string, id: string, version: number) {
  const row = await repo.findPost(db, tenantId, id)
  if (!row) throw postNotFound()
  if (row.version !== version) throw postChanged()
  return row
}

/** Cancels a post that hasn't gone out and isn't being sent (no try yet). */
export async function cancelPost(db: Db, actor: Actor, id: string, input: PostVersionInput): Promise<MarketingPost> {
  const row = await openPost(db, actor.tenantId, id, input.version)
  if (row.status !== 'pending' || row.attempts > 0) throw postNotPending()
  await runBatch(db, [
    repo.changePostStatement(db, actor.tenantId, id, input.version, ['pending'], { status: 'cancelled', reason: 'Cancelled before it went out.' }),
    requireOneChange(db),
    audit(db, actor, 'post.cancel', 'marketing_post', id),
  ], postChanged) // the task claimed it, or someone else acted meanwhile
  return postOf((await repo.findPost(db, actor.tenantId, id))!)
}

/** A failed post goes out again now (its tries start over). */
export async function retryPost(db: Db, actor: Actor, id: string, input: PostVersionInput, now = new Date()): Promise<MarketingPost> {
  const row = await openPost(db, actor.tenantId, id, input.version)
  if (row.status !== 'failed') throw postNotFailed()
  await runBatch(db, [
    repo.changePostStatement(db, actor.tenantId, id, input.version, ['failed'], { status: 'pending', attempts: 0, nextAttemptAt: now, reason: null }),
    requireOneChange(db),
    audit(db, actor, 'post.retry', 'marketing_post', id),
  ], postChanged)
  return postOf((await repo.findPost(db, actor.tenantId, id))!)
}

// --- Sending ---

/** Telegram's answers that mean the bot can't post in the channel anymore. */
function isRemovedError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false
  if (error.error_code === 403) return true
  return error.error_code === 400 && /chat not found|not enough rights|have no rights|need administrator rights|chat_write_forbidden/i.test(error.description)
}

export interface PostDeliveryReport {
  sent: number
  retried: number
  failed: number
  cancelled: number
}

/** Reads a stored object (the poster); `null` when it's gone. */
export type ReadObject = (key: string) => Promise<Uint8Array<ArrayBuffer> | null>

async function send(api: Api, readObject: ReadObject, chatId: string, message: repo.PostRow['message']) {
  const options = {
    parse_mode: 'HTML' as const,
    reply_markup: { inline_keyboard: [[{ text: message.button.text, url: message.button.url }]] },
  }
  const photo = message.photoKey ? await readObject(message.photoKey) : null
  if (photo) return api.sendPhoto(chatId, new InputFile(photo, message.photoKey!.split('/').pop()), { ...options, caption: message.html })
  return api.sendMessage(chatId, message.html, { ...options, link_preview_options: { is_disabled: true } })
}

/**
 * Sends the posts that are due (`ids`: only those, e.g. right after Post now). Each is claimed
 * first, so overlapping runs never send one twice at once. Before sending, the promotion must still
 * be running and the channel connected. Never throws for Telegram's answers: they become the post's
 * state. At least once: a lost answer after Telegram accepted a post can repeat it.
 */
export async function deliverDuePosts(db: Db, api: Api, readObject: ReadObject, now = new Date(), options: { limit?: number, ids?: string[] } = {}): Promise<PostDeliveryReport> {
  const report = { sent: 0, retried: 0, failed: 0, cancelled: 0 }
  if (options.ids && !options.ids.length) return report
  for (const row of await repo.duePosts(db, now, options.limit ?? 25, options.ids)) {
    if (!await repo.claimPost(db, row.id, now, new Date(now.getTime() + CLAIM_MS))) continue
    const attempt = row.attempts + 1
    const promotion = await getPromotion(db, row.tenantId, row.promotionId, now).catch(() => undefined)
    if (!promotion || (promotion.phase !== 'live' && promotion.phase !== 'scheduled')) {
      await repo.settlePost(db, row.id, { status: 'cancelled', reason: 'The promotion ended before this post went out.' })
      report.cancelled++
      continue
    }
    const channel = await repo.findChannel(db, row.tenantId, row.channelId)
    if (!channel || channel.status !== 'connected') {
      await repo.settlePost(db, row.id, { status: 'failed', reason: channel?.status === 'removed' ? 'The bot is no longer an admin of this channel.' : 'This channel was disconnected.' })
      report.failed++
      continue
    }
    try {
      const sent = await send(api, readObject, channel.externalId, row.message)
      await repo.settlePost(db, row.id, { status: 'sent', sentAt: new Date(), externalMessageId: String(sent.message_id), externalUrl: postUrl(channel, sent.message_id), reason: null })
      report.sent++
    }
    catch (error) {
      log('warn', 'Telegram: a post was not delivered', { postId: row.id, attempt, error: String(error) })
      if (isRemovedError(error)) {
        await repo.markRemoved(db, channel.externalId, now)
        await repo.settlePost(db, row.id, { status: 'failed', reason: 'The bot is no longer an admin of this channel.' })
        report.failed++
      }
      else if (error instanceof GrammyError && error.error_code === 429) {
        // Telegram's flood control says when: that wait doesn't count against the tries.
        const seconds = error.parameters.retry_after ?? 30
        await repo.settlePost(db, row.id, { attempts: row.attempts, nextAttemptAt: new Date(now.getTime() + seconds * 1000), reason: `Telegram asked to wait ${seconds} seconds.` })
        report.retried++
      }
      else if ((error instanceof GrammyError && error.error_code === 400) || attempt >= POST_MAX_ATTEMPTS) {
        // A 400 won't change by trying again (a caption Telegram can't read, a bad link).
        await repo.settlePost(db, row.id, { status: 'failed', reason: error instanceof GrammyError && error.error_code === 400 ? 'Telegram refused this post.' : `Telegram didn't accept it after ${attempt} tries.` })
        report.failed++
      }
      else {
        await repo.settlePost(db, row.id, { nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempt)), reason: 'Telegram didn\'t accept it. Trying again.' })
        report.retried++
      }
    }
  }
  return report
}
