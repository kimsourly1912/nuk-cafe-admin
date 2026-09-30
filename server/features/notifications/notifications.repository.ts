import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { DestinationKind, TelegramLinkStatus } from '#shared/contracts/notifications'
import { user } from '../../db/tables'
import type { Db, Statement } from '../../utils/batch'
import { telegramDestinations, telegramLinks } from './notifications.schema'

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
