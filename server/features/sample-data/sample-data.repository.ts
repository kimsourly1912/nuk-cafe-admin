import { and, isNull, lt, or } from 'drizzle-orm'
import type { SampleMenuSize } from '#shared/contracts/sample-data'
import type { Db, Statement } from '#server/utils/batch'
import { byId, firstRow } from '#server/utils/query'
import { SAMPLE_MENU_RUN_ID, sampleDataRuns } from './sample-data.schema'

// --- Row types ---

export interface RunRow {
  size: SampleMenuSize
  finishedAt: Date | null
  lockedUntil: Date | null
}

// --- Columns and conditions ---

const runColumns = { size: sampleDataRuns.size, finishedAt: sampleDataRuns.finishedAt, lockedUntil: sampleDataRuns.lockedUntil }

// --- Reads ---

export async function findRun(db: Db, tenantId: string): Promise<RunRow | undefined> {
  return firstRow(db.select(runColumns)
    .from(sampleDataRuns).where(byId(sampleDataRuns, tenantId, SAMPLE_MENU_RUN_ID)))
}

// --- Write statements ---

export function releaseRunStatement(db: Db, tenantId: string, finishedAt?: Date): Statement {
  return db.update(sampleDataRuns).set({ lockedUntil: null, ...(finishedAt ? { finishedAt } : {}) })
    .where(byId(sampleDataRuns, tenantId, SAMPLE_MENU_RUN_ID))
}

export function deleteRunStatement(db: Db, tenantId: string): Statement {
  return db.delete(sampleDataRuns).where(byId(sampleDataRuns, tenantId, SAMPLE_MENU_RUN_ID))
}

// --- Background-task writes ---

/** Starts the load; `false` when another request started one first (the primary key refuses it). */
export async function claimNewRun(db: Db, tenantId: string, row: { size: SampleMenuSize, startedBy: string, now: Date }): Promise<boolean> {
  const result = await db.insert(sampleDataRuns)
    .values({ tenantId, id: SAMPLE_MENU_RUN_ID, size: row.size, startedBy: row.startedBy, startedAt: row.now })
    .onConflictDoNothing()
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}

/** Takes the step lock until `until`; `false` while another step holds it. */
export async function claimRun(db: Db, tenantId: string, until: Date, now: Date): Promise<boolean> {
  const result = await db.update(sampleDataRuns).set({ lockedUntil: until })
    .where(and(
      byId(sampleDataRuns, tenantId, SAMPLE_MENU_RUN_ID),
      or(isNull(sampleDataRuns.lockedUntil), lt(sampleDataRuns.lockedUntil, now)),
    ))
    .returning({ id: sampleDataRuns.id })
  return result.length === 1
}
