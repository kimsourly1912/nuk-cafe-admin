import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { ChannelStatus } from '#shared/contracts/marketing'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks, updateAtVersion } from '#server/utils/batch'
import { byId, byName, firstRow, hasAny, inTenant } from '#server/utils/query'
import { marketingChannels } from './marketing.schema'

// --- Row types ---

export interface ChannelRow {
  id: string
  tenantId: string
  kind: 'telegram_channel'
  externalId: string
  title: string
  username: string | null
  subscriberCount: number | null
  status: ChannelStatus
  connectedByName: string | null
  connectedAt: Date
  version: number
}

// --- Columns and conditions ---

const channelColumns = {
  id: marketingChannels.id,
  tenantId: marketingChannels.tenantId,
  kind: marketingChannels.kind,
  externalId: marketingChannels.externalId,
  title: marketingChannels.title,
  username: marketingChannels.username,
  subscriberCount: marketingChannels.subscriberCount,
  status: marketingChannels.status,
  connectedByName: user.name,
  connectedAt: marketingChannels.connectedAt,
  version: marketingChannels.version,
}

// --- Reads ---

/** The cafe's visible channels by title; uses marketing_channels_external_idx. */
export function listChannels(db: Db, tenantId: string): Promise<ChannelRow[]> {
  return db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(inTenant(marketingChannels, tenantId, ne(marketingChannels.status, 'disconnected')))
    .orderBy(byName(marketingChannels.title), asc(marketingChannels.id))
}

export async function findChannel(db: Db, tenantId: string, id: string): Promise<ChannelRow | undefined> {
  return firstRow(db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(byId(marketingChannels, tenantId, id)))
}

export async function findChannels(db: Db, tenantId: string, ids: string[]): Promise<ChannelRow[]> {
  return readInChunks(ids, piece => db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(inTenant(marketingChannels, tenantId, inArray(marketingChannels.id, piece))))
}

export async function findChannelByExternal(db: Db, tenantId: string, externalId: string): Promise<{ id: string } | undefined> {
  return firstRow(db.select({ id: marketingChannels.id }).from(marketingChannels)
    .where(inTenant(
      marketingChannels,
      tenantId,
      eq(marketingChannels.kind, 'telegram_channel'),
      eq(marketingChannels.externalId, externalId),
    )))
}

/** Across cafes: whether any cafe still has this channel connected (the bot leaves only when none does). */
export async function hasConnectedChannelAcrossCafes(db: Db, externalId: string): Promise<boolean> {
  return hasAny(db, marketingChannels, and(eq(marketingChannels.externalId, externalId), eq(marketingChannels.status, 'connected')))
}

// --- Write statements ---

/** Connects the channel (a new row, or the tenant's earlier one brought back with its new title). */
export function upsertChannelStatement(db: Db, id: string, row: { tenantId: string, externalId: string, title: string, username: string | null, subscriberCount: number | null, connectedBy: string, at: Date }): Statement {
  return db.insert(marketingChannels).values({ id, tenantId: row.tenantId, kind: 'telegram_channel', externalId: row.externalId, title: row.title, username: row.username, subscriberCount: row.subscriberCount, connectedBy: row.connectedBy, connectedAt: row.at, createdAt: row.at, updatedAt: row.at })
    .onConflictDoUpdate({
      target: [marketingChannels.tenantId, marketingChannels.kind, marketingChannels.externalId],
      set: { title: row.title, username: row.username, subscriberCount: row.subscriberCount, status: 'connected', connectedBy: row.connectedBy, connectedAt: row.at, removedAt: null, version: sql`${marketingChannels.version} + 1`, updatedAt: row.at },
    })
}

/** Disconnects at `version`; follow it with `requireOneChange`. */
export function disconnectChannelStatement(db: Db, tenantId: string, id: string, version: number, now: Date): Statement {
  return updateAtVersion(db, marketingChannels, { tenantId, id, version }, { status: 'disconnected', updatedAt: now }, ne(marketingChannels.status, 'disconnected'))
}

// --- Background-task writes ---

/** Across cafes: the bot left a channel (removed, or the channel deleted): every cafe's row for it. Whether any changed. */
export async function markRemoved(db: Db, externalId: string, now: Date): Promise<boolean> {
  const changed = await db.update(marketingChannels).set({ status: 'removed', removedAt: now, version: sql`${marketingChannels.version} + 1`, updatedAt: now })
    .where(and(eq(marketingChannels.externalId, externalId), eq(marketingChannels.status, 'connected')))
    .returning({ id: marketingChannels.id })
  return changed.length > 0
}
