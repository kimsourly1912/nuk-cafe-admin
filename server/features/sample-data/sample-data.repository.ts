import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { SampleMenuSize } from '#shared/contracts/sample-data'
import type { Db, Statement } from '#server/utils/batch'
import { SAMPLE_MENU_RUN_ID, sampleDataRuns } from './sample-data.schema'

export interface RunRow {
  size: SampleMenuSize
  finishedAt: Date | null
  lockedUntil: Date | null
}

export async function findRun(db: Db, tenantId: string): Promise<RunRow | undefined> {
  const rows = await db.select({ size: sampleDataRuns.size, finishedAt: sampleDataRuns.finishedAt, lockedUntil: sampleDataRuns.lockedUntil })
    .from(sampleDataRuns).where(and(eq(sampleDataRuns.tenantId, tenantId), eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID))).limit(1)
  return rows[0]
}

/** Starts the load; `false` when another request started one first (the primary key refuses it). */
export async function insertRun(db: Db, tenantId: string, row: { size: SampleMenuSize, startedBy: string, now: Date }): Promise<boolean> {
  const result = await db.insert(sampleDataRuns)
    .values({ tenantId, id: SAMPLE_MENU_RUN_ID, size: row.size, startedBy: row.startedBy, startedAt: row.now })
    .onConflictDoNothing()
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}

/** Takes the step lock until `until`; `false` while another step holds it. */
export async function claimRun(db: Db, tenantId: string, now: Date, until: Date): Promise<boolean> {
  const result = await db.update(sampleDataRuns).set({ lockedUntil: until })
    .where(and(eq(sampleDataRuns.tenantId, tenantId), eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID), or(isNull(sampleDataRuns.lockedUntil), lt(sampleDataRuns.lockedUntil, now))))
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}

export async function releaseRun(db: Db, tenantId: string, finishedAt?: Date): Promise<void> {
  await db.update(sampleDataRuns).set({ lockedUntil: null, ...(finishedAt ? { finishedAt } : {}) })
    .where(and(eq(sampleDataRuns.tenantId, tenantId), eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID)))
}

export function deleteRunStatement(db: Db, tenantId: string): Statement {
  return db.delete(sampleDataRuns).where(and(eq(sampleDataRuns.tenantId, tenantId), eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID)))
}
