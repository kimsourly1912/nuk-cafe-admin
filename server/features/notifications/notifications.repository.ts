import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { DestinationKind, NotificationKind } from '#shared/contracts/notifications'
import type { Db, Statement } from '#server/utils/batch'
import { updateAtVersion } from '#server/utils/batch'
import { byId, firstRow, hasAny, inTenant } from '#server/utils/query'
import { user } from '#server/db/tables'
import { notificationRules, telegramDestinations } from './notifications.schema'

// --- Row types ---

export type DestinationRow = typeof telegramDestinations.$inferSelect & { connectedByName: string | null }

export interface ConnectedChat {
  tenantId: string
  chatId: string
  kind: DestinationKind
  title: string
  connectedBy: string
  at: Date
}

export interface RuleRow { kind: NotificationKind, destinationId: string, attachCsv: boolean }

// --- Columns and conditions ---

const destinationColumns = {
  id: telegramDestinations.id,
  tenantId: telegramDestinations.tenantId,
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

/** The tenant's connected and blocked chats, oldest first (disconnected ones are history only). */
function destinationRows(db: Db, tenantId: string) {
  return db.select(destinationColumns).from(telegramDestinations)
    .leftJoin(user, eq(user.id, telegramDestinations.connectedBy))
    .where(inTenant(telegramDestinations, tenantId, ne(telegramDestinations.status, 'disconnected')))
    .orderBy(asc(telegramDestinations.connectedAt), asc(telegramDestinations.id))
}

function ruleRows(db: Db, tenantId: string) {
  return db.select({ kind: notificationRules.kind, destinationId: notificationRules.destinationId, attachCsv: notificationRules.attachCsv })
    .from(notificationRules)
    .innerJoin(telegramDestinations, and(
      eq(telegramDestinations.tenantId, notificationRules.tenantId),
      eq(telegramDestinations.id, notificationRules.destinationId),
    ))
    .where(inTenant(notificationRules, tenantId, ne(telegramDestinations.status, 'disconnected')))
    .orderBy(asc(notificationRules.kind), asc(notificationRules.destinationId))
}

// --- Reads ---

export async function findDestination(db: Db, tenantId: string, id: string): Promise<DestinationRow | undefined> {
  return firstRow(db.select(destinationColumns).from(telegramDestinations)
    .leftJoin(user, eq(user.id, telegramDestinations.connectedBy))
    .where(byId(telegramDestinations, tenantId, id)))
}

/** The tenant's row for a chat (one chat can follow two cafes, D138). */
export function findDestinationByChat(db: Db, tenantId: string, chatId: string): Promise<DestinationRow | undefined> {
  return firstRow(db.select(destinationColumns).from(telegramDestinations)
    .leftJoin(user, eq(user.id, telegramDestinations.connectedBy))
    .where(inTenant(telegramDestinations, tenantId, eq(telegramDestinations.chatId, chatId))))
}

/**
 * Across cafes: whether any tenant still has this chat connected (D138): the bot stays in a group while one cafe
 * uses it, even after another disconnects it.
 */
export async function hasConnectedChatAcrossCafes(db: Db, chatId: string): Promise<boolean> {
  return hasAny(db, telegramDestinations, and(eq(telegramDestinations.chatId, chatId), eq(telegramDestinations.status, 'connected')))
}

/** The tenant's connected chats a kind of notification goes to. */
export function targetsOf(db: Db, tenantId: string, kind: NotificationKind): Promise<{ destinationId: string, attachCsv: boolean }[]> {
  return db.select({ destinationId: notificationRules.destinationId, attachCsv: notificationRules.attachCsv })
    .from(notificationRules)
    .innerJoin(telegramDestinations, and(
      eq(telegramDestinations.tenantId, notificationRules.tenantId),
      eq(telegramDestinations.id, notificationRules.destinationId),
    ))
    .where(inTenant(
      notificationRules,
      tenantId,
      eq(notificationRules.kind, kind),
      eq(telegramDestinations.status, 'connected'),
    ))
    .orderBy(asc(notificationRules.destinationId))
}

export function listRules(db: Db, tenantId: string): Promise<RuleRow[]> {
  return ruleRows(db, tenantId)
}

/** Telegram overview, one snapshot. Uses telegram_destinations_status_idx. */
export async function overviewRows(db: Db, tenantId: string): Promise<{ destinations: DestinationRow[], rules: RuleRow[] }> {
  const [destinations, rules] = await db.batch([
    destinationRows(db, tenantId),
    ruleRows(db, tenantId),
  ])
  return { destinations, rules }
}

/** The cafe's visible destinations. Uses telegram_destinations_status_idx. */
export function listDestinations(db: Db, tenantId: string): Promise<DestinationRow[]> {
  return destinationRows(db, tenantId)
}

// --- Write statements ---

/**
 * Connects a chat: a new row, or the chat's existing one (reconnected after a disconnect or a
 * block) brought back with its new title and who connected it. One statement, keyed by the tenant
 * and the chat.
 */
export function upsertDestinationStatement(db: Db, id: string, chat: ConnectedChat): Statement {
  return db.insert(telegramDestinations).values({
    id,
    tenantId: chat.tenantId,
    chatId: chat.chatId,
    kind: chat.kind,
    title: chat.title,
    status: 'connected',
    connectedBy: chat.connectedBy,
    connectedAt: chat.at,
    createdAt: chat.at,
    updatedAt: chat.at,
  }).onConflictDoUpdate({
    target: [telegramDestinations.tenantId, telegramDestinations.chatId],
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
export function disconnectStatement(db: Db, tenantId: string, id: string, version: number, at: Date): Statement {
  return updateAtVersion(db, telegramDestinations, { tenantId, id, version }, { status: 'disconnected', updatedAt: at }, ne(telegramDestinations.status, 'disconnected'))
}

/** Across cafes: a group became a supergroup: Telegram gave it a new id, and the old one stops working (for every tenant). */
export function moveChatStatement(db: Db, fromChatId: string, toChatId: string, at: Date): Statement {
  return db.update(telegramDestinations)
    .set({ chatId: toChatId, version: sql`${telegramDestinations.version} + 1`, updatedAt: at })
    .where(eq(telegramDestinations.chatId, fromChatId))
}

export function sentStatement(db: Db, tenantId: string, id: string, at: Date): Statement {
  return db.update(telegramDestinations).set({ lastSentAt: at }).where(byId(telegramDestinations, tenantId, id))
}

export function upsertRuleStatement(db: Db, rule: { tenantId: string, kind: NotificationKind, destinationId: string, attachCsv: boolean, createdBy: string }): Statement {
  return db.insert(notificationRules).values(rule)
    .onConflictDoUpdate({ target: [notificationRules.kind, notificationRules.destinationId], set: { attachCsv: rule.attachCsv }, setWhere: inTenant(notificationRules, rule.tenantId) })
}

export function deleteRuleStatement(db: Db, tenantId: string, kind: NotificationKind, destinationId: string): Statement {
  return db.delete(notificationRules).where(inTenant(
    notificationRules,
    tenantId,
    eq(notificationRules.kind, kind),
    eq(notificationRules.destinationId, destinationId),
  ))
}

// --- Background-task writes ---

/**
 * Across cafes: marks a connected chat blocked (the bot was removed or blocked there) in every tenant that has it:
 * Telegram's chat is the same for all of them. Returns whether it changed.
 */
export async function markBlocked(db: Db, chatId: string, at: Date): Promise<boolean> {
  const changed = await db.update(telegramDestinations)
    .set({ status: 'blocked', blockedAt: at, version: sql`${telegramDestinations.version} + 1`, updatedAt: at })
    .where(and(eq(telegramDestinations.chatId, chatId), eq(telegramDestinations.status, 'connected')))
    .returning({ id: telegramDestinations.id })
  return changed.length > 0
}
