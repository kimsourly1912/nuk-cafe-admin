import { and, asc, desc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import type { DestinationKind, NotificationKind, TelegramLinkStatus } from '#shared/contracts/notifications'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import type { StoredMessage } from './notifications.schema'
import { notificationDeliveries, notificationRules, telegramDestinations, telegramLinks } from './notifications.schema'

/** All SQL of Telegram (docs/server/architecture.md → Repository). */

export type DestinationRow = typeof telegramDestinations.$inferSelect & { connectedByName: string | null }
export type LinkRow = typeof telegramLinks.$inferSelect

const destinationColumns = {
  id: telegramDestinations.id,
  chatId: telegramDestinations.chatId,
  kind: telegramDestinations.kind,
  title: telegramDestinations.title,
  status: telegramDestinations.status,
  connectedBy: telegramDestinations.connectedBy,
  connectedAt: telegramDestinations.connectedAt,
  lastSentAt: telegramDestinations.lastSentAt,
  blockedAt: telegramDestinations.blockedAt,
  version: telegramDestinations.version,
  createdAt: telegramDestinations.createdAt,
  updatedAt: telegramDestinations.updatedAt,
  connectedByName: user.name,
}

/** Connected and blocked chats, oldest first (disconnected ones are history only). */
export async function listDestinations(db: Db): Promise<DestinationRow[]> {
  return db.select(destinationColumns).from(telegramDestinations)
    .leftJoin(user, eq(user.id, telegramDestinations.connectedBy))
    .where(ne(telegramDestinations.status, 'disconnected'))
    .orderBy(asc(telegramDestinations.connectedAt))
}

export async function findDestination(db: Db, id: string): Promise<DestinationRow | undefined> {
  const [row] = await db.select(destinationColumns).from(telegramDestinations)
    .leftJoin(user, eq(user.id, telegramDestinations.connectedBy))
    .where(eq(telegramDestinations.id, id))
  return row
}

export async function findDestinationByChat(db: Db, chatId: string) {
  const [row] = await db.select().from(telegramDestinations).where(eq(telegramDestinations.chatId, chatId))
  return row
}

export interface ConnectedChat {
  chatId: string
  kind: DestinationKind
  title: string
  connectedBy: string
  at: Date
}

/**
 * Connects a chat: a new row, or the chat's existing one (reconnected after a disconnect or a
 * block) brought back with its new title and who connected it. One statement, keyed by the chat.
 */
export function upsertDestinationStatement(db: Db, id: string, chat: ConnectedChat): Statement {
  return db.insert(telegramDestinations).values({
    id,
    chatId: chat.chatId,
    kind: chat.kind,
    title: chat.title,
    status: 'connected',
    connectedBy: chat.connectedBy,
    connectedAt: chat.at,
    createdAt: chat.at,
    updatedAt: chat.at,
  }).onConflictDoUpdate({
    target: telegramDestinations.chatId,
    set: {
      kind: chat.kind,
      title: chat.title,
      status: 'connected',
      connectedBy: chat.connectedBy,
      connectedAt: chat.at,
      blockedAt: null,
      version: sql`${telegramDestinations.version} + 1`,
      updatedAt: chat.at,
    },
  })
}

/** Disconnects a chat the admin saw at `version` (a guard follows). */
export function disconnectStatement(db: Db, id: string, version: number, at: Date): Statement {
  return db.update(telegramDestinations)
    .set({ status: 'disconnected', version: sql`${telegramDestinations.version} + 1`, updatedAt: at })
    .where(and(eq(telegramDestinations.id, id), eq(telegramDestinations.version, version), ne(telegramDestinations.status, 'disconnected')))
}

/** Marks a connected chat blocked (the bot was removed or blocked there). Returns whether it changed. */
export async function markBlocked(db: Db, chatId: string, at: Date): Promise<boolean> {
  const changed = await db.update(telegramDestinations)
    .set({ status: 'blocked', blockedAt: at, version: sql`${telegramDestinations.version} + 1`, updatedAt: at })
    .where(and(eq(telegramDestinations.chatId, chatId), eq(telegramDestinations.status, 'connected')))
    .returning({ id: telegramDestinations.id })
  return changed.length > 0
}

/** A group became a supergroup: Telegram gave it a new id, and the old one stops working. */
export async function moveChat(db: Db, fromChatId: string, toChatId: string, at: Date): Promise<void> {
  await db.update(telegramDestinations)
    .set({ chatId: toChatId, version: sql`${telegramDestinations.version} + 1`, updatedAt: at })
    .where(eq(telegramDestinations.chatId, fromChatId))
}

export function sentStatement(db: Db, id: string, at: Date): Statement {
  return db.update(telegramDestinations).set({ lastSentAt: at }).where(eq(telegramDestinations.id, id))
}

// --- Links ---

export function insertLinkStatement(db: Db, link: { id: string, codeHash: string, kind: DestinationKind, createdBy: string, expiresAt: Date, createdAt: Date }): Statement {
  return db.insert(telegramLinks).values(link)
}

export async function findLink(db: Db, id: string): Promise<LinkRow | undefined> {
  const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.id, id))
  return row
}

export async function findLinkByCode(db: Db, codeHash: string): Promise<LinkRow | undefined> {
  const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.codeHash, codeHash))
  return row
}

/**
 * Moves a link from one status to the next, only if it's still in `from` and unexpired: the
 * statement that makes a code single-use (a guard follows it in the batch).
 */
export function advanceLinkStatement(db: Db, id: string, from: TelegramLinkStatus[], set: Partial<Pick<LinkRow, 'status' | 'chatId' | 'chatTitle' | 'memberCount' | 'destinationId'>>, now: Date): Statement {
  return db.update(telegramLinks).set(set)
    .where(and(eq(telegramLinks.id, id), inArray(telegramLinks.status, from), sql`${telegramLinks.expiresAt} > ${now.getTime()}`))
}

/** Ends a link that is still waiting or asking for confirmation. Returns whether it did. */
export async function cancelLink(db: Db, id: string): Promise<boolean> {
  const changed = await db.update(telegramLinks).set({ status: 'cancelled' })
    .where(and(eq(telegramLinks.id, id), inArray(telegramLinks.status, ['waiting', 'confirm'])))
    .returning({ id: telegramLinks.id })
  return changed.length > 0
}

/** Links that expired a day ago or more: nothing reads them any more. */
export async function deleteOldLinks(db: Db, before: Date): Promise<void> {
  await db.delete(telegramLinks).where(lt(telegramLinks.expiresAt, before))
}

// --- Notification rules (8.1d, D113) ---

export async function listRules(db: Db) {
  return db.select({ kind: notificationRules.kind, destinationId: notificationRules.destinationId, attachCsv: notificationRules.attachCsv })
    .from(notificationRules)
    .innerJoin(telegramDestinations, eq(telegramDestinations.id, notificationRules.destinationId))
    .where(ne(telegramDestinations.status, 'disconnected'))
}

/** The connected chats a kind of notification goes to. */
export async function targetsOf(db: Db, kind: NotificationKind) {
  return db.select({ destinationId: notificationRules.destinationId, attachCsv: notificationRules.attachCsv })
    .from(notificationRules)
    .innerJoin(telegramDestinations, eq(telegramDestinations.id, notificationRules.destinationId))
    .where(and(eq(notificationRules.kind, kind), eq(telegramDestinations.status, 'connected')))
}

export async function setRule(db: Db, rule: { kind: NotificationKind, destinationId: string, attachCsv: boolean, createdBy: string }): Promise<void> {
  await db.insert(notificationRules).values(rule)
    .onConflictDoUpdate({ target: [notificationRules.kind, notificationRules.destinationId], set: { attachCsv: rule.attachCsv } })
}

export async function removeRule(db: Db, kind: NotificationKind, destinationId: string): Promise<void> {
  await db.delete(notificationRules).where(and(eq(notificationRules.kind, kind), eq(notificationRules.destinationId, destinationId)))
}

// --- Deliveries ---

export type DeliveryRow = typeof notificationDeliveries.$inferSelect

export interface NewDelivery {
  id: string
  kind: DeliveryRow['kind']
  destinationId: string
  dedupeKey: string
  subject: string
  message: StoredMessage
  status?: DeliveryRow['status']
  attempts?: number
  createdAt: Date
  nextAttemptAt: Date
  sentAt?: Date
}

/** Saves a delivery unless the chat already has one about the same thing (the dedupe key). */
export function insertDeliveryStatement(db: Db, delivery: NewDelivery): Statement {
  return db.insert(notificationDeliveries).values(delivery).onConflictDoNothing()
}

/** Which of these deliveries exist (a dropped duplicate doesn't). */
export async function deliveryIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(inArray(notificationDeliveries.id, ids))
  return new Set(rows.map(row => row.id))
}

/** Which of these chats already have a delivery with this key. */
export async function deliveredTo(db: Db, dedupeKey: string, destinationIds: string[]): Promise<Set<string>> {
  if (!destinationIds.length) return new Set()
  const rows = await db.select({ destinationId: notificationDeliveries.destinationId }).from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.dedupeKey, dedupeKey), inArray(notificationDeliveries.destinationId, destinationIds)))
  return new Set(rows.map(row => row.destinationId))
}

export async function dueDeliveries(db: Db, now: Date, limit: number, ids?: string[]): Promise<DeliveryRow[]> {
  return db.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.status, 'pending'), lte(notificationDeliveries.nextAttemptAt, now), ids ? inArray(notificationDeliveries.id, ids) : undefined))
    .orderBy(asc(notificationDeliveries.nextAttemptAt))
    .limit(limit)
}

/**
 * Claims a due delivery for one run: counts the try and pushes its next time out, only if it's still
 * pending and due. Two overlapping runs never send it at once.
 */
export async function claimDelivery(db: Db, row: DeliveryRow, now: Date, until: Date): Promise<boolean> {
  const claimed = await db.update(notificationDeliveries)
    .set({ attempts: sql`${notificationDeliveries.attempts} + 1`, nextAttemptAt: until })
    .where(and(eq(notificationDeliveries.id, row.id), eq(notificationDeliveries.status, 'pending'), lte(notificationDeliveries.nextAttemptAt, now)))
    .returning({ id: notificationDeliveries.id })
  return claimed.length > 0
}

export async function markDelivered(db: Db, id: string, destinationId: string, at: Date): Promise<void> {
  await db.batch([
    db.update(notificationDeliveries).set({ status: 'sent', sentAt: at, lastError: null }).where(eq(notificationDeliveries.id, id)),
    sentStatement(db, destinationId, at),
  ])
}

export async function markRetry(db: Db, id: string, next: Date, reason: string): Promise<void> {
  await db.update(notificationDeliveries).set({ status: 'pending', nextAttemptAt: next, lastError: reason }).where(eq(notificationDeliveries.id, id))
}

export async function markFailed(db: Db, id: string, reason: string): Promise<void> {
  await db.update(notificationDeliveries).set({ status: 'failed', lastError: reason }).where(eq(notificationDeliveries.id, id))
}

/** Retry: a failed delivery goes back to pending, due now, with its tries counted afresh. */
export async function requeueFailed(db: Db, id: string, now: Date): Promise<boolean> {
  const changed = await db.update(notificationDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null })
    .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.status, 'failed')))
    .returning({ id: notificationDeliveries.id })
  return changed.length > 0
}

export async function findDelivery(db: Db, id: string) {
  const [row] = await db.select({ delivery: notificationDeliveries, title: telegramDestinations.title, destinationStatus: telegramDestinations.status })
    .from(notificationDeliveries)
    .innerJoin(telegramDestinations, eq(telegramDestinations.id, notificationDeliveries.destinationId))
    .where(eq(notificationDeliveries.id, id))
  return row
}

export async function recentDeliveries(db: Db, limit: number) {
  return db.select({ delivery: notificationDeliveries, title: telegramDestinations.title })
    .from(notificationDeliveries)
    .innerJoin(telegramDestinations, eq(telegramDestinations.id, notificationDeliveries.destinationId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit)
}

/** Deliveries from before `cutoff` (history kept 90 days). */
export async function deleteDeliveriesBefore(db: Db, cutoff: Date): Promise<number> {
  const removed = await db.delete(notificationDeliveries).where(lt(notificationDeliveries.createdAt, cutoff)).returning({ id: notificationDeliveries.id })
  return removed.length
}
