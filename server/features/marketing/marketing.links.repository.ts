import { and, asc, eq, getTableColumns, lt, ne } from 'drizzle-orm'
import type { ChannelLinkStatus } from '#shared/contracts/marketing'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest } from '#server/utils/batch'
import { byId, firstRow } from '#server/utils/query'
import { advanceConnectCodeStatement, cancellableConnectCode } from '#server/utils/connect-codes'
import { marketingChannelLinks } from './marketing.schema'

// --- Row types ---

export type LinkRow = typeof marketingChannelLinks.$inferSelect

// --- Columns and conditions ---

const linkColumns = getTableColumns(marketingChannelLinks)

// --- Reads ---

export async function findLink(db: Db, tenantId: string, id: string): Promise<LinkRow | undefined> {
  return firstRow(db.select(linkColumns).from(marketingChannelLinks).where(byId(marketingChannelLinks, tenantId, id)))
}

/** Across cafes: the webhook only knows the hashed code. */
export async function findLinkByCode(db: Db, codeHash: string): Promise<LinkRow | undefined> {
  return firstRow(db.select(linkColumns).from(marketingChannelLinks).where(eq(marketingChannelLinks.codeHash, codeHash)))
}

// --- Write statements ---

export function insertLinkStatement(db: Db, row: { id: string, tenantId: string, codeHash: string, createdBy: string, expiresAt: Date, createdAt: Date }): Statement {
  return db.insert(marketingChannelLinks).values(row)
}

/** Moves a link on only from one of `from` (the single-use guard); follow it with `requireOneChange`. */
export function advanceLinkStatement(db: Db, tenantId: string, id: string, from: ChannelLinkStatus[], changes: Partial<Pick<LinkRow, 'status' | 'chatId' | 'chatTitle' | 'chatUsername' | 'memberCount' | 'channelId'>>, now: Date): Statement {
  return advanceConnectCodeStatement(db, marketingChannelLinks, tenantId, id, from, changes, now)
}

/** Cancels a cafe's waiting code. Follow it with `requireOneChange`. */
export function cancelLinkStatement(db: Db, tenantId: string, id: string): Statement {
  return db.update(marketingChannelLinks).set({ status: 'cancelled' }).where(cancellableConnectCode(marketingChannelLinks, tenantId, id))
}

// --- Background-task writes ---

/** Across cafes: deletes at most 500 expired codes per pass, oldest first. */
export function deleteLinksBefore(db: Db, before: Date): Promise<number> {
  return deleteOldest(db, marketingChannelLinks, marketingChannelLinks.id, and(lt(marketingChannelLinks.expiresAt, before), ne(marketingChannelLinks.status, 'connected'))!, [asc(marketingChannelLinks.expiresAt), asc(marketingChannelLinks.id)], 500)
}
