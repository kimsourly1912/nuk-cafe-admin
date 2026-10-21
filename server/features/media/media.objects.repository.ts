import { asc, eq, getTableColumns, inArray, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertPieces } from '#server/utils/batch'
import { inTenant } from '#server/utils/query'
import { mediaAssets, mediaObjectDeletions } from './media.schema'

// --- Row types ---

export type ObjectDeletionRow = typeof mediaObjectDeletions.$inferSelect

// --- Columns and conditions ---

const deletionColumns = getTableColumns(mediaObjectDeletions)

// --- Reads ---

/** Across cafes: durable R2 deletion work due now; uses media_object_deletions_due_idx. */
export function dueObjectDeletions(db: Db, now: Date, limit: number): Promise<ObjectDeletionRow[]> {
  return db.select(deletionColumns).from(mediaObjectDeletions).where(lte(mediaObjectDeletions.nextAttemptAt, now))
    .orderBy(asc(mediaObjectDeletions.nextAttemptAt), asc(mediaObjectDeletions.objectKey)).limit(limit)
}

// --- Write statements ---

/** Queues the source and variants in the same batch that removes their rows. */
export function queueAssetObjectsStatement(db: Db, tenantId: string, id: string, extra?: SQL): Statement {
  return db.insert(mediaObjectDeletions).select(db.select({ objectKey: mediaAssets.objectKey, tenantId: mediaAssets.tenantId, nextAttemptAt: sql<Date>`0`.as('next_attempt_at') }).from(mediaAssets)
    .where(inTenant(mediaAssets, tenantId, or(eq(mediaAssets.id, id), eq(mediaAssets.parentId, id)), extra))).onConflictDoNothing()
}

/** Provisional keys are durable before R2 is written. Run every piece in one service-owned batch. */
export function insertObjectPlansStatements(db: Db, tenantId: string, keys: string[], after: Date): Statement[] {
  return insertPieces(mediaObjectDeletions, keys.map(objectKey => ({ objectKey, tenantId, nextAttemptAt: after })))
    .map(rows => db.insert(mediaObjectDeletions).values(rows).onConflictDoNothing())
}

export function deleteObjectPlansStatements(db: Db, tenantId: string, keys: string[]): Statement[] {
  return chunk(keys).map(piece => db.delete(mediaObjectDeletions).where(inTenant(mediaObjectDeletions, tenantId, inArray(mediaObjectDeletions.objectKey, piece))))
}

/** Acknowledge only after R2 confirmed deletion. */
export function deleteObjectStatement(db: Db, tenantId: string, key: string): Statement {
  return db.delete(mediaObjectDeletions).where(inTenant(mediaObjectDeletions, tenantId, eq(mediaObjectDeletions.objectKey, key)))
}

export function retryObjectDeletionStatement(db: Db, tenantId: string, key: string, after: Date): Statement {
  return db.update(mediaObjectDeletions).set({ nextAttemptAt: after }).where(inTenant(mediaObjectDeletions, tenantId, eq(mediaObjectDeletions.objectKey, key)))
}
