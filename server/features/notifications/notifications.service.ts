import type { Api } from 'grammy'
import type { Message, Update } from 'grammy/types'
import type { CreateTelegramLinkInput, NewTelegramLink, ReportSent, TelegramDestination, TelegramLink, TelegramOverview } from '#shared/contracts/notifications'
import { TELEGRAM_LINK_MINUTES } from '#shared/contracts/notifications'
import type { Actor } from '#server/features/identity'
import { auditStatement, withIdempotency } from '#server/features/platform'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, requireOneChange, runBatch } from '#server/utils/batch'
import { versionConflict } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { toIso } from '#server/utils/time'
import { destinationBlocked, destinationNotFound, linkNotFound, linkUnusable } from './notifications.errors'
import * as repo from './notifications.repository'
import { listRules, sendStored } from './notifications.delivery'
import { chatTitle, escapeHtml, hashLinkCode, isBlockedError, isGroup, linkUrl, newLinkCode, sendFailure, startCode } from './notifications.rules'
import type { TelegramSettings } from './notifications.settings'

/**
 * Telegram (step 8.1c, docs/plans/reports.md, D112): connecting chats with one-time links, the
 * bot's webhook, and sending messages. `api` is grammY's `Api` for the bot (the routes make it
 * from the settings; tests give it a fake `fetch`).
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

function destinationOf(row: repo.DestinationRow): TelegramDestination {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status === 'blocked' ? 'blocked' : 'connected',
    connectedBy: row.connectedByName,
    connectedAt: toIso(row.connectedAt),
    lastSentAt: row.lastSentAt ? toIso(row.lastSentAt) : null,
    blockedAt: row.blockedAt ? toIso(row.blockedAt) : null,
    version: row.version,
  }
}

function linkOf(row: repo.LinkRow, now: Date): TelegramLink {
  const live = row.status === 'waiting' || row.status === 'confirm'
  return {
    id: row.id,
    kind: row.kind,
    status: live && row.expiresAt <= now ? 'expired' : row.status,
    expiresAt: toIso(row.expiresAt),
    chat: row.chatTitle ? { title: row.chatTitle, memberCount: row.memberCount } : null,
    destinationId: row.destinationId,
  }
}

/** The Telegram page: whether it's on, the bot's name, and the chats. */
export async function telegramOverview(db: Db, settings: TelegramSettings | null): Promise<TelegramOverview> {
  if (!settings) return { enabled: false, botUsername: null, destinations: [], rules: [] }
  const [destinations, rules] = await Promise.all([repo.listDestinations(db), listRules(db)])
  return { enabled: true, botUsername: settings.botUsername, destinations: destinations.map(destinationOf), rules }
}

/** Only connected chats can be chosen to send to (the Send dialog shows blocked ones disabled). */
export async function listDestinations(db: Db): Promise<TelegramDestination[]> {
  return (await repo.listDestinations(db)).map(destinationOf)
}

// --- Connecting ---

/**
 * A one-time link for the admin to open in Telegram. The code is only in this answer; the
 * database keeps its hash. Links of a day ago or more are cleared on the way.
 */
export async function createLink(db: Db, actor: Actor, settings: TelegramSettings, input: CreateTelegramLinkInput, now = new Date()): Promise<NewTelegramLink> {
  await repo.deleteOldLinks(db, new Date(now.getTime() - DAY))
  const code = newLinkCode()
  const id = newId()
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * MINUTE)
  await db.batch([repo.insertLinkStatement(db, { id, codeHash: await hashLinkCode(code), kind: input.kind, createdBy: actor.userId, expiresAt, createdAt: now })])
  return {
    id,
    kind: input.kind,
    status: 'waiting',
    expiresAt: toIso(expiresAt),
    chat: null,
    destinationId: null,
    url: linkUrl(settings.botUsername, input.kind, code),
  }
}

/** A link's progress, for the admin who made it (the portal asks every few seconds). */
export async function getLink(db: Db, actor: Actor, id: string, now = new Date()): Promise<TelegramLink> {
  const row = await repo.findLink(db, id)
  if (!row || row.createdBy !== actor.userId) throw linkNotFound()
  return linkOf(row, now)
}

/** The admin confirms the group a link brought: it's connected. */
export async function confirmLink(db: Db, actor: Actor, id: string, now = new Date()): Promise<TelegramDestination> {
  const row = await repo.findLink(db, id)
  if (!row || row.createdBy !== actor.userId) throw linkNotFound()
  if (row.status !== 'confirm' || !row.chatId || !row.chatTitle) throw linkUnusable()
  const destinationId = (await repo.findDestinationByChat(db, row.chatId))?.id ?? newId()
  // The chat first (the link points at it), then the link, guarded: a used or expired link undoes both.
  await runBatch(db, [
    repo.upsertDestinationStatement(db, destinationId, { chatId: row.chatId, kind: 'group', title: row.chatTitle, connectedBy: actor.userId, at: now }),
    repo.advanceLinkStatement(db, id, ['confirm'], { status: 'connected', destinationId }, now),
    requireOneChange(db),
    auditStatement(db, actor, { action: 'notifications.telegram.connect', targetType: 'telegram_destination', targetId: destinationId, metadata: { kind: 'group' } }),
  ], linkUnusable)
  return destinationOf((await repo.findDestination(db, destinationId))!)
}

/** The admin doesn't want the group: the link ends, and the bot leaves that group. */
export async function cancelLink(db: Db, api: Api, actor: Actor, id: string, now = new Date()): Promise<TelegramLink> {
  const row = await repo.findLink(db, id)
  if (!row || row.createdBy !== actor.userId) throw linkNotFound()
  const cancelled = await repo.cancelLink(db, id)
  // The bot was added to that group for this link: it leaves, unless the group is connected anyway.
  if (cancelled && row.status === 'confirm' && row.chatId) {
    const existing = await repo.findDestinationByChat(db, row.chatId)
    if (!existing || existing.status === 'disconnected') await leaveQuietly(api, row.chatId)
  }
  return linkOf((await repo.findLink(db, id))!, now)
}

async function leaveQuietly(api: Api, chatId: string) {
  try {
    await api.leaveChat(chatId)
  }
  catch (error) {
    log('warn', 'Telegram: could not leave a chat', { error: String(error) })
  }
}

// --- The webhook ---

async function reply(api: Api, chatId: number | string, text: string) {
  try {
    await api.sendMessage(chatId, text)
  }
  catch (error) {
    log('warn', 'Telegram: could not reply', { error: String(error) })
  }
}

const EXPIRED_REPLY = 'This link doesn\'t work anymore. Make a new one on the Telegram page of the NUK Cafe admin.'

/**
 * One update from Telegram (the webhook, verified by its secret header). Handles:
 * - `/start <code>` in a private chat: connects that chat;
 * - `/start@<bot> <code>` in a group, from one of its admins: asks the portal to confirm it;
 * - the bot removed from a group, or blocked by a person: the chat is marked blocked;
 * - a group upgraded to a supergroup: the chat follows its new id.
 * Every code works once; anything else is ignored.
 */
export async function handleUpdate(db: Db, api: Api, settings: TelegramSettings, update: Update, now = new Date()): Promise<void> {
  const member = update.my_chat_member
  if (member) {
    if (member.new_chat_member.status === 'left' || member.new_chat_member.status === 'kicked') {
      if (await repo.markBlocked(db, String(member.chat.id), now)) log('info', 'Telegram: a chat blocked the bot', { chatType: member.chat.type })
    }
    return
  }
  const message = update.message
  if (!message) return
  if (message.migrate_to_chat_id) {
    await repo.moveChat(db, String(message.chat.id), String(message.migrate_to_chat_id), now)
    return
  }
  const code = startCode(message.text, settings.botUsername)
  if (code) await useCode(db, api, message, code, now)
}

/**
 * Runs a batch whose guard makes a code single-use. `false` when the link was used a moment ago
 * (Telegram resent the update, or a double tap): that was already handled. Other errors throw.
 */
async function runOnce(db: Db, statements: Statement[]): Promise<boolean> {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
    return true
  }
  catch (error) {
    if (isStaleWrite(error)) return false
    throw error
  }
}

async function useCode(db: Db, api: Api, message: Message, code: string, now: Date) {
  const chat = message.chat
  const link = await repo.findLinkByCode(db, await hashLinkCode(code))
  const group = isGroup(chat)
  if (!link || link.status !== 'waiting' || link.expiresAt <= now || (link.kind === 'group') !== group) {
    // A private chat can't use a group's link and the other way round.
    await reply(api, chat.id, link && link.kind === 'group' && !group ? 'This link is for a group: open it and choose your staff group.' : EXPIRED_REPLY)
    return
  }

  if (!group) {
    const chatId = String(chat.id)
    const destinationId = (await repo.findDestinationByChat(db, chatId))?.id ?? newId()
    const used = await runOnce(db, [
      repo.upsertDestinationStatement(db, destinationId, { chatId, kind: 'private', title: chatTitle(chat), connectedBy: link.createdBy, at: now }),
      repo.advanceLinkStatement(db, link.id, ['waiting'], { status: 'connected', chatId, chatTitle: chatTitle(chat), destinationId }, now),
      requireOneChange(db),
      auditStatement(db, { userId: link.createdBy }, { action: 'notifications.telegram.connect', targetType: 'telegram_destination', targetId: destinationId, metadata: { kind: 'private' } }),
    ])
    if (!used) return
    await reply(api, chat.id, 'Connected. NUK Cafe will send messages here. You can disconnect on the Telegram page of the admin.')
    return
  }

  // A group: only one of its admins may connect it, and the portal confirms it.
  const from = message.from
  const role = from ? (await api.getChatMember(chat.id, from.id).catch(() => null))?.status : undefined
  if (role !== 'creator' && role !== 'administrator') {
    await reply(api, chat.id, 'Only an admin of this group can connect it to NUK Cafe.')
    return
  }
  const memberCount = await api.getChatMemberCount(chat.id).catch(() => null)
  const used = await runOnce(db, [
    repo.advanceLinkStatement(db, link.id, ['waiting'], { status: 'confirm', chatId: String(chat.id), chatTitle: chatTitle(chat), memberCount }, now),
    requireOneChange(db),
  ])
  if (!used) return
  await reply(api, chat.id, 'Almost done: confirm this group in the NUK Cafe admin.')
}

// --- Chats ---

async function connectedDestination(db: Db, id: string) {
  const row = await repo.findDestination(db, id)
  if (!row || row.status === 'disconnected') throw destinationNotFound()
  if (row.status === 'blocked') throw destinationBlocked(row.title)
  return row
}

export interface OutgoingMessage {
  /** For the delivery history: "Summary · Tue 30 Sep 2026". */
  subject: string
  /** Telegram's HTML (text escaped with `escapeHtml`). */
  html: string
  /** A file sent after the message, e.g. the report's CSV. */
  document?: { filename: string, content: string }
}

/**
 * Sends to a connected chat. A chat Telegram says is gone is marked blocked (409); a rate limit
 * is 503 with Telegram's wait; anything else 502. The cause is logged, never shown.
 */
async function deliver(db: Db, api: Api, row: repo.DestinationRow, message: OutgoingMessage, now: Date) {
  try {
    await sendStored(api, row.chatId, { html: message.html, document: message.document })
  }
  catch (error) {
    if (isBlockedError(error)) await repo.markBlocked(db, row.chatId, now)
    log('warn', 'Telegram: a message was not delivered', { destinationId: row.id, error: String(error) })
    throw sendFailure(error, row.title)
  }
}

/** Send test: a short message, so the admin sees the chat works. */
export async function sendTestMessage(db: Db, api: Api, actor: Actor, id: string, now = new Date()): Promise<TelegramDestination> {
  const row = await connectedDestination(db, id)
  await deliver(db, api, row, { subject: 'Test', html: `✅ <b>Test from NUK Cafe</b>\nMessages for ${escapeHtml(row.title)} arrive here.` }, now)
  await db.batch([
    repo.sentStatement(db, id, now),
    auditStatement(db, actor, { action: 'notifications.telegram.test', targetType: 'telegram_destination', targetId: id }),
  ])
  return destinationOf((await repo.findDestination(db, id))!)
}

/** Disconnect: nothing more goes there; the bot leaves a group. The row stays for the history. */
export async function disconnectDestination(db: Db, api: Api, actor: Actor, id: string, version: number, now = new Date()): Promise<void> {
  const row = await repo.findDestination(db, id)
  if (!row || row.status === 'disconnected') throw destinationNotFound()
  await runBatch(db, [
    repo.disconnectStatement(db, id, version, now),
    requireOneChange(db),
    auditStatement(db, actor, { action: 'notifications.telegram.disconnect', targetType: 'telegram_destination', targetId: id, metadata: { kind: row.kind } }),
  ], () => versionConflict('This Telegram chat'))
  if (row.kind === 'group' && row.status === 'connected') await leaveQuietly(api, row.chatId)
}

/**
 * Sends a report (Send to Telegram), once per `Idempotency-Key`: a retry after a lost answer gets
 * the first result back instead of a second message. A retry after a failure sends again.
 */
export async function sendReport(
  db: Db,
  api: Api,
  actor: Actor,
  key: string,
  request: { destinationId: string, report: unknown, attachCsv: boolean },
  build: () => Promise<OutgoingMessage & { audit: Record<string, unknown> }>,
  now = new Date(),
): Promise<ReportSent> {
  const { response } = await withIdempotency(db, { actorId: actor.userId, operation: 'notifications.send-report', key }, request, async () => {
    const row = await connectedDestination(db, request.destinationId)
    const { audit, ...message } = await build()
    await deliver(db, api, row, message, now)
    return {
      statements: [
        repo.sentStatement(db, row.id, now),
        // In the delivery history with the alerts (8.1d, D113), as sent.
        repo.insertDeliveryStatement(db, { id: newId(), kind: 'report', destinationId: row.id, dedupeKey: `report:${key}`, subject: message.subject, message: { html: message.html }, status: 'sent', attempts: 1, createdAt: now, nextAttemptAt: now, sentAt: now }),
        auditStatement(db, actor, { action: 'report.send', targetType: 'telegram_destination', targetId: row.id, metadata: { ...audit, attachCsv: request.attachCsv } }),
      ],
      response: { destination: { id: row.id, title: row.title }, sentAt: toIso(now) },
    }
  }, { now })
  return response
}
