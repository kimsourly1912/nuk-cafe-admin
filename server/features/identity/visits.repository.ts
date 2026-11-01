import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { workspaceVisits } from './identity.schema'

// --- Queries ---

/** When each of these people last opened this cafe's admin or counter; absent: never since D248. */
export async function lastVisitsOf(db: Db, tenantId: string, userIds: string[]): Promise<Map<string, Date>> {
  // In pieces: a full page of staff and the cafe would pass D1's 100 bound values.
  const rows = await readInChunks(userIds, ids => db.select({ userId: workspaceVisits.userId, lastActiveAt: workspaceVisits.lastActiveAt })
    .from(workspaceVisits)
    .where(and(eq(workspaceVisits.tenantId, tenantId), inArray(workspaceVisits.userId, ids))))
  return new Map(rows.map(row => [row.userId, row.lastActiveAt]))
}

// --- Write statements ---

/**
 * This visit, unless one was recorded since `staleBefore`: the row is written at most once per
 * interval, however often the workspace is opened. One statement, so two tabs at once can't fail.
 */
export function recordVisitStatement(db: Db, tenantId: string, userId: string, now: Date, staleBefore: Date): Statement {
  return db.insert(workspaceVisits).values({ tenantId, userId, lastActiveAt: now }).onConflictDoUpdate({
    target: [workspaceVisits.tenantId, workspaceVisits.userId],
    set: { lastActiveAt: now },
    setWhere: lt(workspaceVisits.lastActiveAt, staleBefore),
  })
}

/** Every cafe's record of this person (account deletion, D237). */
export function deleteVisitsStatement(db: Db, userId: string): Statement {
  return db.delete(workspaceVisits).where(eq(workspaceVisits.userId, userId))
}
