import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { Actor } from '#server/features/identity'
import type { Db, Statement } from '#server/utils/batch'
import type { AssistantImportFailure, AssistantImportReviewRow } from '#shared/contracts/assistant-import'
import { assistantImportLeases, assistantImports } from './assistant.schema'

const owned = (actor: Actor) => and(eq(assistantImports.tenantId, actor.tenantId), eq(assistantImports.userId, actor.userId))
const visible = (actor: Actor, id: string, now: Date) => and(owned(actor), eq(assistantImports.id, id), eq(assistantImports.state, 'uploaded'), gt(assistantImports.expiresAt, now))
const leaseOwner = (actor: Actor) => and(eq(assistantImportLeases.tenantId, actor.tenantId), eq(assistantImportLeases.userId, actor.userId))

export async function activeLease(db: Db, actor: Actor, now: Date) {
  return (await db.select().from(assistantImportLeases).where(and(leaseOwner(actor), gt(assistantImportLeases.deadline, now))).limit(1))[0]
}
export function claimLeaseStatement(db: Db, actor: Actor, extractionId: string, deadline: Date, now: Date): Statement {
  return db.insert(assistantImportLeases).values({ tenantId: actor.tenantId, userId: actor.userId, extractionId, deadline })
    .onConflictDoUpdate({ target: [assistantImportLeases.tenantId, assistantImportLeases.userId], set: { extractionId, deadline }, setWhere: lte(assistantImportLeases.deadline, now) })
}
export async function releaseLease(db: Db, actor: Actor, extractionId: string) {
  await db.delete(assistantImportLeases).where(and(leaseOwner(actor), eq(assistantImportLeases.extractionId, extractionId)))
}
export function beginStatement(db: Db, actor: Actor, id: string, version: number, extractionId: string, deadline: Date, now: Date): Statement {
  return db.update(assistantImports).set({ reviewState: 'processing', extractionId, extractionDeadline: deadline, extractionError: null, reviewRows: null, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), sql`${assistantImports.reviewState} != 'ready'`))
}
export function finishStatement(db: Db, actor: Actor, id: string, extractionId: string, rows: AssistantImportReviewRow[], now: Date): Statement {
  return db.update(assistantImports).set({ reviewState: 'ready', reviewRows: rows, extractionId: null, extractionDeadline: null, extractionError: null, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.reviewState, 'processing'), eq(assistantImports.extractionId, extractionId), gt(assistantImports.extractionDeadline, now)))
}
/** No rows after a discard/expiry, and an old worker cannot fail a newer attempt. */
export async function failExtraction(db: Db, actor: Actor, id: string, extractionId: string, error: AssistantImportFailure) {
  await db.update(assistantImports).set({ reviewState: 'failed', extractionId: null, extractionDeadline: null, extractionError: error, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, new Date()), eq(assistantImports.reviewState, 'processing'), eq(assistantImports.extractionId, extractionId)))
}
export function updateRowsStatement(db: Db, actor: Actor, id: string, version: number, rows: AssistantImportReviewRow[], now: Date): Statement {
  return db.update(assistantImports).set({ reviewRows: rows, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.reviewState, 'ready'), eq(assistantImports.version, version)))
}
export function cancelStatement(db: Db, actor: Actor, id: string, version: number, now: Date): Statement {
  return db.update(assistantImports).set({ reviewState: 'failed', extractionId: null, extractionError: 'AI_IMPORT_CANCELLED', version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), eq(assistantImports.reviewState, 'processing')))
}
