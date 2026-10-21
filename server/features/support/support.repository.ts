import { and, desc, eq, getTableColumns, gt, isNull } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { requireCount } from '#server/utils/batch'
import { byId, firstRow, inTenant } from '#server/utils/query'
import { supportGrants, supportVisits } from './support.schema'

// --- Row types ---

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

// --- Columns and conditions ---

const grantColumns = getTableColumns(supportGrants)

const visitColumns = getTableColumns(supportVisits)

const grantActive = (now: Date) => and(isNull(supportGrants.endedAt), gt(supportGrants.expiresAt, now))

// --- Reads ---

/** The grant in force for the cafe, if any; uses support_grants_tenant_idx. */
export async function findActiveGrant(db: Db, tenantId: string, now: Date): Promise<GrantRow | undefined> {
  return firstRow(db.select(grantColumns).from(supportGrants)
    .where(inTenant(supportGrants, tenantId, grantActive(now)))
    .orderBy(desc(supportGrants.grantedAt), desc(supportGrants.id)))
}

/** The latest grants and their visits in one snapshot. Uses support_grants_tenant_idx and support_visits_grant_idx. */
export async function historyRows(db: Db, tenantId: string, limit: number): Promise<{ grants: GrantRow[], visits: VisitRow[] }> {
  const recent = db.select({ id: supportGrants.id, tenantId: supportGrants.tenantId }).from(supportGrants)
    .where(inTenant(supportGrants, tenantId))
    .orderBy(desc(supportGrants.grantedAt), desc(supportGrants.id)).limit(limit).as('recent_grants')
  const [grants, visits] = await db.batch([
    db.select(grantColumns).from(supportGrants).where(inTenant(supportGrants, tenantId))
      .orderBy(desc(supportGrants.grantedAt), desc(supportGrants.id)).limit(limit),
    db.select(visitColumns).from(supportVisits)
      .innerJoin(recent, and(eq(recent.tenantId, supportVisits.tenantId), eq(recent.id, supportVisits.grantId)))
      .where(inTenant(supportVisits, tenantId))
      .orderBy(desc(supportVisits.openedAt), desc(supportVisits.id)),
  ])
  return { grants, visits }
}

/** This session's open visit under a grant still in force; uses support_visits_session_idx. */
export async function findOpenVisit(db: Db, tenantId: string, sessionId: string, now: Date): Promise<(VisitRow & { grantExpiresAt: Date }) | undefined> {
  const row = await firstRow(db.select({ visit: visitColumns, grantExpiresAt: supportGrants.expiresAt }).from(supportVisits)
    .innerJoin(supportGrants, and(eq(supportGrants.tenantId, supportVisits.tenantId), eq(supportGrants.id, supportVisits.grantId)))
    .where(inTenant(
      supportVisits,
      tenantId,
      eq(supportVisits.sessionId, sessionId),
      isNull(supportVisits.closedAt),
      gt(supportVisits.expiresAt, now),
      grantActive(now),
    ))
    .orderBy(desc(supportVisits.openedAt), desc(supportVisits.id)))
  return row ? { ...row.visit, grantExpiresAt: row.grantExpiresAt } : undefined
}

// --- Guards ---

/** Aborts if the cafe already has a grant in force. */
export function requireNoActiveGrant(db: Db, tenantId: string, now: Date): Statement {
  return requireCount(db, db.$count(supportGrants, inTenant(supportGrants, tenantId, grantActive(now))), 0)
}

/** Aborts unless the cafe's grant is still in force. */
export function requireGrantActive(db: Db, tenantId: string, grantId: string, now: Date): Statement {
  return requireCount(db, db.$count(supportGrants, and(byId(supportGrants, tenantId, grantId), grantActive(now))), 1)
}

// --- Write statements ---

export function insertGrantStatement(db: Db, row: { id: string, tenantId: string, grantedBy: string, grantedAt: Date, expiresAt: Date }): Statement {
  return db.insert(supportGrants).values(row)
}

/** Ends the grant if it is still in force. Follow it with `requireOneChange`. */
export function endGrantStatement(db: Db, tenantId: string, grantId: string, endedBy: string, now: Date): Statement {
  return db.update(supportGrants).set({ endedAt: now, endedBy })
    .where(and(byId(supportGrants, tenantId, grantId), grantActive(now)))
}

/** Closes the grant's open, unexpired visits. */
export function closeGrantVisitsStatement(db: Db, tenantId: string, grantId: string, now: Date): Statement {
  return db.update(supportVisits).set({ closedAt: now })
    .where(inTenant(
      supportVisits,
      tenantId,
      eq(supportVisits.grantId, grantId),
      isNull(supportVisits.closedAt),
      gt(supportVisits.expiresAt, now),
    ))
}

/** Closes one open, unexpired visit. Follow it with `requireOneChange`. */
export function endVisitStatement(db: Db, tenantId: string, visitId: string, now: Date): Statement {
  return db.update(supportVisits).set({ closedAt: now })
    .where(and(
      byId(supportVisits, tenantId, visitId),
      isNull(supportVisits.closedAt),
      gt(supportVisits.expiresAt, now),
    ))
}

export function insertVisitStatement(db: Db, row: { id: string, tenantId: string, grantId: string, userId: string, sessionId: string, openedAt: Date, expiresAt: Date }): Statement {
  return db.insert(supportVisits).values(row)
}

/** Closes this session's open, unexpired visits in the cafe. */
export function closeSessionVisitsStatement(db: Db, tenantId: string, sessionId: string, now: Date): Statement {
  return db.update(supportVisits).set({ closedAt: now })
    .where(inTenant(
      supportVisits,
      tenantId,
      eq(supportVisits.sessionId, sessionId),
      isNull(supportVisits.closedAt),
      gt(supportVisits.expiresAt, now),
    ))
}
