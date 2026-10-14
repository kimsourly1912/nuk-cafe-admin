import { and, asc, desc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import type { ChannelLinkStatus, ChannelStatus, PostStatus } from '#shared/contracts/marketing'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { PostMessage } from './marketing.schema'
import { marketingChannelLinks, marketingChannels, marketingPosts } from './marketing.schema'

/** All SQL of marketing (M2a, D164). Every read by id names the tenant; the webhook reads by Telegram's id. */

// --- Channels ---

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

/** The tenant's channels that aren't disconnected, by title. */
export function listChannels(db: Db, tenantId: string): Promise<ChannelRow[]> {
  return db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(and(eq(marketingChannels.tenantId, tenantId), ne(marketingChannels.status, 'disconnected')))
    .orderBy(asc(sql`lower(${marketingChannels.title})`))
}

export async function findChannel(db: Db, tenantId: string, id: string): Promise<ChannelRow | undefined> {
  const [row] = await db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(and(eq(marketingChannels.tenantId, tenantId), eq(marketingChannels.id, id)))
  return row
}

export async function findChannels(db: Db, tenantId: string, ids: string[]): Promise<ChannelRow[]> {
  if (!ids.length) return []
  return db.select(channelColumns).from(marketingChannels).leftJoin(user, eq(user.id, marketingChannels.connectedBy))
    .where(and(eq(marketingChannels.tenantId, tenantId), inArray(marketingChannels.id, ids)))
}

export async function findChannelByExternal(db: Db, tenantId: string, externalId: string): Promise<{ id: string } | undefined> {
  const [row] = await db.select({ id: marketingChannels.id }).from(marketingChannels)
    .where(and(eq(marketingChannels.tenantId, tenantId), eq(marketingChannels.kind, 'telegram_channel'), eq(marketingChannels.externalId, externalId)))
  return row
}

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
  return db.update(marketingChannels).set({ status: 'disconnected', version: sql`${marketingChannels.version} + 1`, updatedAt: now })
    .where(and(eq(marketingChannels.tenantId, tenantId), eq(marketingChannels.id, id), eq(marketingChannels.version, version), ne(marketingChannels.status, 'disconnected')))
}

/** The bot left a channel (removed, or the channel deleted): every cafe's row for it. Whether any changed. */
export async function markRemoved(db: Db, externalId: string, now: Date): Promise<boolean> {
  const changed = await db.update(marketingChannels).set({ status: 'removed', removedAt: now, version: sql`${marketingChannels.version} + 1`, updatedAt: now })
    .where(and(eq(marketingChannels.externalId, externalId), eq(marketingChannels.status, 'connected')))
    .returning({ id: marketingChannels.id })
  return changed.length > 0
}

/** Whether any cafe still has this channel connected (the bot leaves only when none does). */
export async function channelConnectedAnywhere(db: Db, externalId: string): Promise<boolean> {
  const [row] = await db.select({ id: marketingChannels.id }).from(marketingChannels)
    .where(and(eq(marketingChannels.externalId, externalId), eq(marketingChannels.status, 'connected'))).limit(1)
  return !!row
}

// --- Connect codes ---

export type LinkRow = typeof marketingChannelLinks.$inferSelect

export function insertLinkStatement(db: Db, row: { id: string, tenantId: string, codeHash: string, createdBy: string, expiresAt: Date, createdAt: Date }): Statement {
  return db.insert(marketingChannelLinks).values(row)
}

export async function findLink(db: Db, tenantId: string, id: string): Promise<LinkRow | undefined> {
  const [row] = await db.select().from(marketingChannelLinks).where(and(eq(marketingChannelLinks.tenantId, tenantId), eq(marketingChannelLinks.id, id)))
  return row
}

export async function findLinkByCode(db: Db, codeHash: string): Promise<LinkRow | undefined> {
  const [row] = await db.select().from(marketingChannelLinks).where(eq(marketingChannelLinks.codeHash, codeHash))
  return row
}

/** Moves a link on only from one of `from` (the single-use guard); follow it with `requireOneChange`. */
export function advanceLinkStatement(db: Db, id: string, from: ChannelLinkStatus[], changes: Partial<Pick<LinkRow, 'status' | 'chatId' | 'chatTitle' | 'chatUsername' | 'memberCount' | 'channelId'>>, now: Date): Statement {
  return db.update(marketingChannelLinks).set(changes)
    .where(and(eq(marketingChannelLinks.id, id), inArray(marketingChannelLinks.status, from), sql`${marketingChannelLinks.expiresAt} > ${now.getTime()}`))
}

export async function cancelLink(db: Db, id: string): Promise<boolean> {
  const changed = await db.update(marketingChannelLinks).set({ status: 'cancelled' })
    .where(and(eq(marketingChannelLinks.id, id), inArray(marketingChannelLinks.status, ['waiting', 'confirm']))).returning({ id: marketingChannelLinks.id })
  return changed.length > 0
}

export async function deleteOldLinks(db: Db, before: Date): Promise<void> {
  await db.delete(marketingChannelLinks).where(and(lt(marketingChannelLinks.expiresAt, before), ne(marketingChannelLinks.status, 'connected')))
}

// --- Posts ---

export type PostRow = typeof marketingPosts.$inferSelect & { channelTitle: string, createdByName: string | null }

const postColumns = {
  id: marketingPosts.id,
  tenantId: marketingPosts.tenantId,
  promotionId: marketingPosts.promotionId,
  channelId: marketingPosts.channelId,
  status: marketingPosts.status,
  caption: marketingPosts.caption,
  message: marketingPosts.message,
  scheduledAt: marketingPosts.scheduledAt,
  attempts: marketingPosts.attempts,
  claimToken: marketingPosts.claimToken,
  nextAttemptAt: marketingPosts.nextAttemptAt,
  externalMessageId: marketingPosts.externalMessageId,
  externalUrl: marketingPosts.externalUrl,
  reason: marketingPosts.reason,
  createdBy: marketingPosts.createdBy,
  createdAt: marketingPosts.createdAt,
  sentAt: marketingPosts.sentAt,
  version: marketingPosts.version,
  channelTitle: marketingChannels.title,
  createdByName: user.name,
}

const postsQuery = (db: Db) => db.select(postColumns).from(marketingPosts)
  .innerJoin(marketingChannels, and(eq(marketingChannels.tenantId, marketingPosts.tenantId), eq(marketingChannels.id, marketingPosts.channelId)))
  .leftJoin(user, eq(user.id, marketingPosts.createdBy))

/** A promotion's posts, latest first. */
export function listPosts(db: Db, tenantId: string, promotionId: string): Promise<PostRow[]> {
  return postsQuery(db).where(and(eq(marketingPosts.tenantId, tenantId), eq(marketingPosts.promotionId, promotionId)))
    .orderBy(desc(marketingPosts.scheduledAt), desc(marketingPosts.id))
}

export async function findPost(db: Db, tenantId: string, id: string): Promise<PostRow | undefined> {
  const [row] = await postsQuery(db).where(and(eq(marketingPosts.tenantId, tenantId), eq(marketingPosts.id, id)))
  return row
}

export async function findPostsByIds(db: Db, tenantId: string, ids: string[]): Promise<PostRow[]> {
  if (!ids.length) return []
  return postsQuery(db).where(and(eq(marketingPosts.tenantId, tenantId), inArray(marketingPosts.id, ids))).orderBy(asc(marketingPosts.id))
}

export interface NewPost {
  id: string
  tenantId: string
  promotionId: string
  channelId: string
  caption: string
  message: PostMessage
  scheduledAt: Date
  createdBy: string
  createdAt: Date
}

export function insertPostStatement(db: Db, post: NewPost): Statement {
  return db.insert(marketingPosts).values({ ...post, nextAttemptAt: post.scheduledAt })
}

/** Moves a post on at `version` and only from `from`; follow it with `requireOneChange`. */
export function changePostStatement(db: Db, tenantId: string, id: string, version: number, from: PostStatus[], changes: Partial<typeof marketingPosts.$inferInsert>, extra?: ReturnType<typeof sql>): Statement {
  return db.update(marketingPosts).set({ ...changes, version: sql`${marketingPosts.version} + 1` })
    .where(and(eq(marketingPosts.tenantId, tenantId), eq(marketingPosts.id, id), eq(marketingPosts.version, version), inArray(marketingPosts.status, from), extra))
}

/** Posts due now (every cafe's, for the task), oldest first; `ids`: only those. */
export function duePosts(db: Db, now: Date, limit: number, ids?: string[]): Promise<(typeof marketingPosts.$inferSelect)[]> {
  return db.select().from(marketingPosts)
    .where(and(eq(marketingPosts.status, 'pending'), lte(marketingPosts.nextAttemptAt, now), ids ? inArray(marketingPosts.id, ids) : undefined))
    .orderBy(asc(marketingPosts.nextAttemptAt)).limit(limit)
}

/**
 * Claims a due post for one run: counts the try and pushes its next time out, only if it's still
 * pending and due, so two overlapping runs never send it at once.
 */
export async function claimPost(db: Db, id: string, now: Date, until: Date) {
  const token = newId()
  const [claimed] = await db.update(marketingPosts).set({ claimToken: token, attempts: sql`${marketingPosts.attempts} + 1`, nextAttemptAt: until, version: sql`${marketingPosts.version} + 1` })
    .where(and(eq(marketingPosts.id, id), eq(marketingPosts.status, 'pending'), lte(marketingPosts.nextAttemptAt, now)))
    .returning()
  return claimed ? { ...claimed, claimToken: token } : undefined
}

export async function settlePost(db: Db, id: string, token: string, changes: Partial<typeof marketingPosts.$inferInsert>): Promise<boolean> {
  const rows = await db.update(marketingPosts).set({ ...changes, claimToken: null, version: sql`${marketingPosts.version} + 1` })
    .where(and(eq(marketingPosts.id, id), eq(marketingPosts.status, 'pending'), eq(marketingPosts.claimToken, token))).returning({ id: marketingPosts.id })
  return rows.length === 1
}
