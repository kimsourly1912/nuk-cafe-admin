import { and, asc, count, eq, gt, lte, notExists, or, sql } from 'drizzle-orm'
import type { Actor } from '#server/features/identity'
import type { Db, Statement } from '#server/utils/batch'
import { assistantImportObjects, assistantImports } from './assistant.schema'

export type ImportRow = typeof assistantImports.$inferSelect

const owned = (actor: Actor) => and(eq(assistantImports.tenantId, actor.tenantId), eq(assistantImports.userId, actor.userId))
const visible = (actor: Actor, now: Date) => and(owned(actor), eq(assistantImports.state, 'uploaded'), gt(assistantImports.expiresAt, now))

export async function findSource(db: Db, actor: Actor, id: string, now: Date): Promise<ImportRow | undefined> {
  return (await db.select().from(assistantImports).where(and(visible(actor, now), eq(assistantImports.id, id))).limit(1))[0]
}

export async function listSources(db: Db, actor: Actor, now: Date): Promise<ImportRow[]> {
  return db.select().from(assistantImports).where(visible(actor, now)).orderBy(asc(assistantImports.createdAt)).limit(5)
}

export function activeSourceCount(db: Db, actor: Actor, now: Date) {
  return sql`${db.select({ n: count() }).from(assistantImports).where(and(owned(actor), gt(assistantImports.expiresAt, now)))}`
}

export function reserveStatements(db: Db, source: typeof assistantImports.$inferInsert): Statement[] {
  return [
    db.insert(assistantImportObjects).values({ objectKey: source.objectKey, expiresAt: source.expiresAt, createdAt: source.createdAt }),
    db.insert(assistantImports).values(source),
  ]
}

/** A slow/failed upload cannot revive a discarded/expired reservation. */
export async function finishUpload(db: Db, actor: Actor, id: string, now: Date): Promise<ImportRow | undefined> {
  return (await db.update(assistantImports).set({ state: 'uploaded' })
    .where(and(owned(actor), eq(assistantImports.id, id), eq(assistantImports.state, 'uploading'), gt(assistantImports.expiresAt, now)))
    .returning())[0]
}

export function discardStatement(db: Db, actor: Actor, id: string, version: number, now: Date): Statement {
  return db.delete(assistantImports).where(and(visible(actor, now), eq(assistantImports.id, id), eq(assistantImports.version, version)))
}

export function queueDeleteStatement(db: Db, objectKey: string): Statement {
  return db.update(assistantImportObjects).set({ deleteRequested: true }).where(eq(assistantImportObjects.objectKey, objectKey))
}

/** Internal compensation: a failed upload is hidden and its durable object record retained. */
export async function abandonUpload(db: Db, actor: Actor, id: string, objectKey: string) {
  await db.batch([
    db.delete(assistantImports).where(and(owned(actor), eq(assistantImports.id, id))),
    queueDeleteStatement(db, objectKey),
  ])
}

/** Operational ledger: survives tenant/user cascades, and contains no filename or review data. */
export async function dueObjects(db: Db, now: Date, limit: number): Promise<{ objectKey: string }[]> {
  const abandonedBefore = new Date(now.getTime() - 10 * 60 * 1000)
  const liveSource = db.select({ id: assistantImports.id }).from(assistantImports)
    .where(eq(assistantImports.objectKey, assistantImportObjects.objectKey))
  return db.select({ objectKey: assistantImportObjects.objectKey }).from(assistantImportObjects)
    .where(or(eq(assistantImportObjects.deleteRequested, true), lte(assistantImportObjects.expiresAt, now),
      and(lte(assistantImportObjects.createdAt, abandonedBefore), notExists(liveSource))))
    .orderBy(asc(assistantImportObjects.expiresAt)).limit(limit)
}

/** Hide the source before deleting bytes; expiry is immutable, so no active source is refreshed. */
export async function hideSource(db: Db, objectKey: string) {
  await db.batch([
    db.delete(assistantImports).where(eq(assistantImports.objectKey, objectKey)),
    queueDeleteStatement(db, objectKey),
  ])
}

/** Only called after storage confirms deletion; failures leave a retryable ledger row. */
export async function completeDelete(db: Db, objectKey: string) {
  await db.delete(assistantImportObjects).where(eq(assistantImportObjects.objectKey, objectKey))
}
