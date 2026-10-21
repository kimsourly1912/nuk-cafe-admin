import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { PostStatus } from '#shared/contracts/marketing'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks, updateAtVersion } from '#server/utils/batch'
import { byId, firstRow, inTenant } from '#server/utils/query'
import type { WorkClaim } from '#server/utils/claims'
import { claimAttempt, ownsWork, pendingWork } from '#server/utils/claims'
import { user } from '#server/db/tables'
import type { PostMessage } from './marketing.schema'
import { marketingChannels, marketingPosts } from './marketing.schema'

// --- Row types ---

export type PostJobRow = typeof marketingPosts.$inferSelect
export type PostChange = Partial<Pick<typeof marketingPosts.$inferInsert, 'status' | 'reason' | 'attempts' | 'nextAttemptAt' | 'sentAt' | 'externalMessageId' | 'externalUrl'>>
export type PostRow = PostJobRow & { channelTitle: string, createdByName: string | null }

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

// --- Columns and conditions ---

const postJobColumns = getTableColumns(marketingPosts)

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
  .innerJoin(marketingChannels, and(
    eq(marketingChannels.tenantId, marketingPosts.tenantId),
    eq(marketingChannels.id, marketingPosts.channelId),
  ))
  .leftJoin(user, eq(user.id, marketingPosts.createdBy))

// --- Reads ---

/** A promotion's newest posts; uses marketing_posts_promotion_idx. */
export function listPosts(db: Db, tenantId: string, promotionId: string): Promise<PostRow[]> {
  return postsQuery(db).where(inTenant(marketingPosts, tenantId, eq(marketingPosts.promotionId, promotionId)))
    .orderBy(desc(marketingPosts.scheduledAt), desc(marketingPosts.id))
}

export async function findPost(db: Db, tenantId: string, id: string): Promise<PostRow | undefined> {
  return firstRow(postsQuery(db).where(byId(marketingPosts, tenantId, id)))
}

export async function findPosts(db: Db, tenantId: string, ids: string[]): Promise<PostRow[]> {
  return readInChunks(ids, piece => postsQuery(db).where(inTenant(marketingPosts, tenantId, inArray(marketingPosts.id, piece))).orderBy(asc(marketingPosts.id)))
}

/** Across cafes: due posts, oldest first; uses marketing_posts_due_idx. Optional ids are chunked. */
export async function duePosts(db: Db, now: Date, limit: number, ids?: string[]): Promise<PostJobRow[]> {
  const query = (piece?: string[]) => db.select(postJobColumns).from(marketingPosts)
    .where(and(pendingWork(marketingPosts, now), piece ? inArray(marketingPosts.id, piece) : undefined))
    .orderBy(asc(marketingPosts.nextAttemptAt), asc(marketingPosts.id)).limit(limit)
  if (ids === undefined) return query()
  const rows = await readInChunks(ids, piece => query(piece))
  return rows.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit)
}

// --- Write statements ---

export function insertPostStatement(db: Db, post: NewPost): Statement {
  return db.insert(marketingPosts).values({ ...post, nextAttemptAt: post.scheduledAt })
}

/** Moves a post on at `version` and only from `from`; follow it with `requireOneChange`. */
export function changePostStatement(db: Db, tenantId: string, id: string, version: number, from: PostStatus[], changes: PostChange, extra?: ReturnType<typeof sql>): Statement {
  return updateAtVersion(db, marketingPosts, { tenantId, id, version }, changes, and(inArray(marketingPosts.status, from), extra))
}

// --- Background-task writes ---

/**
 * Claims a due post for one run: counts the try and pushes its next time out, only if it's still
 * pending and due, so two overlapping runs never send it at once.
 */
export async function claimPost(db: Db, tenantId: string, id: string, until: Date, now: Date): Promise<(PostJobRow & WorkClaim) | undefined> {
  const claim = claimAttempt(marketingPosts)
  const [claimed] = await db.update(marketingPosts).set({ ...claim, nextAttemptAt: until, version: sql`${marketingPosts.version} + 1` })
    .where(inTenant(marketingPosts, tenantId, eq(marketingPosts.id, id), pendingWork(marketingPosts, now)))
    .returning(postJobColumns)
  return claimed ? { ...claimed, claimToken: claim.claimToken } : undefined
}

export async function settlePost(db: Db, tenantId: string, id: string, token: string, changes: PostChange): Promise<boolean> {
  const rows = await db.update(marketingPosts).set({ ...changes, claimToken: null, version: sql`${marketingPosts.version} + 1` })
    .where(ownsWork(marketingPosts, token, byId(marketingPosts, tenantId, id), eq(marketingPosts.status, 'pending'))).returning({ id: marketingPosts.id })
  return rows.length === 1
}
