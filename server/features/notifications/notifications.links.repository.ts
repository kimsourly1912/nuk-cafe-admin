import { asc, eq, getTableColumns, lt } from 'drizzle-orm'
import type { DestinationKind, TelegramLinkStatus } from '#shared/contracts/notifications'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest } from '#server/utils/batch'
import { byId, firstRow } from '#server/utils/query'
import { advanceConnectCodeStatement, cancellableConnectCode } from '#server/utils/connect-codes'
import { telegramLinks } from './notifications.schema'

// --- Row types ---

export type LinkRow = typeof telegramLinks.$inferSelect

// --- Columns and conditions ---

const linkColumns = getTableColumns(telegramLinks)

// --- Reads ---

export async function findLink(db: Db, tenantId: string, id: string): Promise<LinkRow | undefined> {
  return firstRow(db.select(linkColumns).from(telegramLinks).where(byId(telegramLinks, tenantId, id)))
}

/** Across cafes: the link a code belongs to, in whichever tenant made it (the code is the only key Telegram sends). */
export async function findLinkByCode(db: Db, codeHash: string): Promise<LinkRow | undefined> {
  return firstRow(db.select(linkColumns).from(telegramLinks).where(eq(telegramLinks.codeHash, codeHash)))
}

// --- Write statements ---

export function insertLinkStatement(db: Db, link: { id: string, tenantId: string, codeHash: string, kind: DestinationKind, createdBy: string, expiresAt: Date, createdAt: Date }): Statement {
  return db.insert(telegramLinks).values(link)
}

/**
 * Moves a link from one status to the next, only if it's still in `from` and unexpired: the
 * statement that makes a code single-use (a guard follows it in the batch).
 */
export function advanceLinkStatement(db: Db, tenantId: string, id: string, from: TelegramLinkStatus[], set: Partial<Pick<LinkRow, 'status' | 'chatId' | 'chatTitle' | 'memberCount' | 'destinationId'>>, now: Date): Statement {
  return advanceConnectCodeStatement(db, telegramLinks, tenantId, id, from, set, now)
}

/** Cancels a cafe's waiting code. Follow it with `requireOneChange`. */
export function cancelLinkStatement(db: Db, tenantId: string, id: string): Statement {
  return db.update(telegramLinks).set({ status: 'cancelled' }).where(cancellableConnectCode(telegramLinks, tenantId, id))
}

// --- Background-task writes ---

/** Across cafes: deletes at most 500 expired codes per pass, oldest first. */
export function deleteLinksBefore(db: Db, before: Date): Promise<number> {
  return deleteOldest(db, telegramLinks, telegramLinks.id, lt(telegramLinks.expiresAt, before), [asc(telegramLinks.expiresAt), asc(telegramLinks.id)], 500)
}
