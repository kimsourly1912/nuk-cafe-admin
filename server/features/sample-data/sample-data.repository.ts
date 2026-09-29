import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { SampleMenuSize } from '#shared/contracts/sample-data'
import type { Db, Statement } from '../../utils/batch'
import { SAMPLE_MENU_RUN_ID, sampleDataRuns } from './sample-data.schema'

export interface RunRow {
  size: SampleMenuSize
  finishedAt: Date | null
  lockedUntil: Date | null
}

export async function findRun(db: Db): Promise<RunRow | undefined> {
  const rows = await db.select({ size: sampleDataRuns.size, finishedAt: sampleDataRuns.finishedAt, lockedUntil: sampleDataRuns.lockedUntil })
    .from(sampleDataRuns).where(eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID)).limit(1)
  return rows[0]
}

/** Starts the load; `false` when another request started one first (the primary key refuses it). */
export async function insertRun(db: Db, row: { size: SampleMenuSize, startedBy: string, now: Date }): Promise<boolean> {
  const result = await db.insert(sampleDataRuns)
    .values({ id: SAMPLE_MENU_RUN_ID, size: row.size, startedBy: row.startedBy, startedAt: row.now })
    .onConflictDoNothing()
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}

/** Takes the step lock until `until`; `false` while another step holds it. */
export async function claimRun(db: Db, now: Date, until: Date): Promise<boolean> {
  const result = await db.update(sampleDataRuns).set({ lockedUntil: until })
    .where(and(eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID), or(isNull(sampleDataRuns.lockedUntil), lt(sampleDataRuns.lockedUntil, now))))
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}

export async function releaseRun(db: Db, finishedAt?: Date): Promise<void> {
  await db.update(sampleDataRuns).set({ lockedUntil: null, ...(finishedAt ? { finishedAt } : {}) })
    .where(eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID))
}

export function deleteRunStatement(db: Db): Statement {
  return db.delete(sampleDataRuns).where(eq(sampleDataRuns.id, SAMPLE_MENU_RUN_ID))
}
