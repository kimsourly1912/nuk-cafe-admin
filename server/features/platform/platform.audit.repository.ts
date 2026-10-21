import { and, count, desc, eq, gte, lt } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { inJsonArray } from '#server/utils/query'
import { auditEvents } from './platform.schema'
import type { AuditActor, AuditEntry, AuditFilter, AuditRow } from './platform.types'

// --- Columns and conditions ---

const auditColumns = { id: auditEvents.id, at: auditEvents.at, tenantId: auditEvents.tenantId, actorId: auditEvents.actorId, action: auditEvents.action, targetType: auditEvents.targetType, targetId: auditEvents.targetId, metadata: auditEvents.metadata }

// --- Reads ---

/**
 * Across cafes: platform audit rows with one of `actions`, newest first, a page at a time (the platform console's Activity,
 * D191). The action list is the boundary: a cafe's own rows never match it. Served by
 * `audit_events_at_idx`, `audit_events_tenant_idx` (a cafe) and `audit_events_actor_idx` (an actor).
 */
export async function listAuditEvents(db: Db, filter: AuditFilter): Promise<{ rows: AuditRow[], total: number }> {
  const where = and(
    inJsonArray(auditEvents.action, filter.actions),
    filter.actorId ? eq(auditEvents.actorId, filter.actorId) : undefined,
    filter.tenantId ? eq(auditEvents.tenantId, filter.tenantId) : undefined,
    filter.since ? gte(auditEvents.at, filter.since) : undefined,
    filter.before ? lt(auditEvents.at, filter.before) : undefined,
  )
  const [rows, [total]] = await db.batch([
    db.select(auditColumns)
      .from(auditEvents).where(where).orderBy(desc(auditEvents.at), desc(auditEvents.id)).limit(filter.limit).offset(filter.offset),
    db.select({ total: count() }).from(auditEvents).where(where),
  ])
  return { rows, total: total?.total ?? 0 }
}

// --- Write statements ---

export function insertAuditStatement(db: Db, actor: AuditActor, entry: AuditEntry): Statement {
  return db.insert(auditEvents).values({
    id: newId(),
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    branchId: entry.branchId ?? null,
    metadata: entry.metadata ?? null,
    requestId: actor.requestId ?? null,
  })
}
