import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { requireCount } from '#server/utils/batch'
import { supportGrants, supportVisits } from './support.schema'

/** Support grants and visits (step P5, D193). Every query names the cafe. */

export interface GrantRow {
  id: string
  tenantId: string
  grantedBy: string
  grantedAt: Date
  expiresAt: Date
  endedAt: Date | null
  endedBy: string | null
}

export interface VisitRow {
  id: string
  tenantId: string
  grantId: string
  userId: string
  sessionId: string
  openedAt: Date
  expiresAt: Date
  closedAt: Date | null
}

const grantActive = (now: Date) => and(isNull(supportGrants.endedAt), gt(supportGrants.expiresAt, now))

/** The grant in force for the cafe, if any. */
export async function findActiveGrant(db: Db, tenantId: string, now: Date): Promise<GrantRow | undefined> {
  const rows: GrantRow[] = await db.select().from(supportGrants)
    .where(and(eq(supportGrants.tenantId, tenantId), grantActive(now)))
    .orderBy(desc(supportGrants.grantedAt)).limit(1)
  return rows[0]
}

/** The cafe's latest grants, newest first. */
export async function latestGrants(db: Db, tenantId: string, limit: number): Promise<GrantRow[]> {
  return db.select().from(supportGrants).where(eq(supportGrants.tenantId, tenantId))
    .orderBy(desc(supportGrants.grantedAt), desc(supportGrants.id)).limit(limit)
}

/** The visits under these grants of the cafe, newest first. */
export async function visitsOf(db: Db, tenantId: string, grantIds: string[]): Promise<VisitRow[]> {
  if (!grantIds.length) return []
  return db.select().from(supportVisits)
    .where(and(eq(supportVisits.tenantId, tenantId), inArray(supportVisits.grantId, grantIds)))
    .orderBy(desc(supportVisits.openedAt))
}

/**
 * The visit this session has open in the cafe, under a grant still in force: the only way a super
 * admin reads a cafe's admin (D193).
 */
export async function findOpenVisit(db: Db, tenantId: string, sessionId: string, now: Date): Promise<(VisitRow & { grantExpiresAt: Date }) | undefined> {
  const rows = await db.select({ visit: supportVisits, grantExpiresAt: supportGrants.expiresAt }).from(supportVisits)
    .innerJoin(supportGrants, and(eq(supportGrants.tenantId, supportVisits.tenantId), eq(supportGrants.id, supportVisits.grantId)))
    .where(and(
      eq(supportVisits.sessionId, sessionId),
      eq(supportVisits.tenantId, tenantId),
      isNull(supportVisits.closedAt),
      gt(supportVisits.expiresAt, now),
      grantActive(now),
    ))
    .orderBy(desc(supportVisits.openedAt)).limit(1)
  const row = rows[0]
  return row ? { ...row.visit, grantExpiresAt: row.grantExpiresAt } : undefined
}

// --- Writes: statements for the service's batch ---

/** Aborts the batch if the cafe already has a grant in force: two clicks make one grant. */
export function requireNoActiveGrant(db: Db, tenantId: string, now: Date): Statement {
  return requireCount(db, sql`select count(*) from ${supportGrants} where ${supportGrants.tenantId} = ${tenantId} and ${supportGrants.endedAt} is null and ${supportGrants.expiresAt} > ${now.getTime()}`, 0)
}

/** Aborts the batch unless the grant is still in force: one ended meanwhile opens nothing. */
export function requireGrantActive(db: Db, tenantId: string, grantId: string, now: Date): Statement {
  return requireCount(db, sql`select count(*) from ${supportGrants} where ${supportGrants.tenantId} = ${tenantId} and ${supportGrants.id} = ${grantId} and ${supportGrants.endedAt} is null and ${supportGrants.expiresAt} > ${now.getTime()}`, 1)
}

export function insertGrantStatement(db: Db, row: { id: string, tenantId: string, grantedBy: string, grantedAt: Date, expiresAt: Date }): Statement {
  return db.insert(supportGrants).values(row)
}

/** Ends the grant if it's still in force. Follow it with `requireOneChange`. */
export function endGrantStatement(db: Db, tenantId: string, grantId: string, endedBy: string, now: Date): Statement {
  return db.update(supportGrants).set({ endedAt: now, endedBy })
    .where(and(eq(supportGrants.tenantId, tenantId), eq(supportGrants.id, grantId), grantActive(now)))
}

/** Closes the grant's open visits: they would stop anyway, this records when. */
export function closeGrantVisitsStatement(db: Db, tenantId: string, grantId: string, now: Date): Statement {
  return db.update(supportVisits).set({ closedAt: now })
    .where(and(eq(supportVisits.tenantId, tenantId), eq(supportVisits.grantId, grantId), isNull(supportVisits.closedAt), gt(supportVisits.expiresAt, now)))
}

export function insertVisitStatement(db: Db, row: { id: string, tenantId: string, grantId: string, userId: string, sessionId: string, openedAt: Date, expiresAt: Date }): Statement {
  return db.insert(supportVisits).values(row)
}

/** Closes this session's open visits in the cafe (Leave support). */
export function closeSessionVisitsStatement(db: Db, tenantId: string, sessionId: string, now: Date): Statement {
  return db.update(supportVisits).set({ closedAt: now })
    .where(and(eq(supportVisits.tenantId, tenantId), eq(supportVisits.sessionId, sessionId), isNull(supportVisits.closedAt), gt(supportVisits.expiresAt, now)))
}
