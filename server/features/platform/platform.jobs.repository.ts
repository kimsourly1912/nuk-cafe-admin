import { asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { firstRow } from '#server/utils/query'
import { jobCursors, jobRuns } from './platform.schema'

// --- Row types ---

export interface JobRunRow {
  job: string
  lastRunAt: Date
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  failuresInARow: number
}

export interface JobProgressRow { activityAt: Date, succeededAt: Date | null, processed: number, failures: number }

// --- Columns and conditions ---

/** A success within this long of the last one isn't written again while nothing failed. */
export const JOB_RUN_SUCCESS_EVERY_MS = 5 * 60_000

const jobRunColumns = { job: jobRuns.job, lastRunAt: jobRuns.lastRunAt, lastSuccessAt: jobRuns.lastSuccessAt, lastFailureAt: jobRuns.lastFailureAt, failuresInARow: jobRuns.failuresInARow }

// --- Reads ---

export async function currentJobCursor(db: Db, job: string): Promise<string | null> {
  const row = await firstRow(db.select({ cursor: jobCursors.cursor }).from(jobCursors).where(eq(jobCursors.job, job)))
  return row?.cursor ?? null
}

export async function findJobProgress(db: Db, job: string): Promise<JobProgressRow | undefined> {
  return firstRow(db.select({ activityAt: jobCursors.updatedAt, succeededAt: jobCursors.succeededAt, processed: jobCursors.processed, failures: jobCursors.failures })
    .from(jobCursors).where(eq(jobCursors.job, job)))
}

export async function listJobRuns(db: Db): Promise<JobRunRow[]> {
  return db.select(jobRunColumns).from(jobRuns).orderBy(asc(jobRuns.job))
}

// --- Write statements ---

export function upsertJobCursorStatement(db: Db, job: string, cursor: string | null, result: { processed?: number, failures?: number }, now: Date): Statement {
  const processed = result.processed ?? 0
  const failures = result.failures ?? 0
  const succeededAt = failures === 0 || processed > failures ? now : null
  return db.insert(jobCursors).values({ job, cursor, updatedAt: now, succeededAt, processed, failures }).onConflictDoUpdate({
    target: jobCursors.job,
    set: { cursor, updatedAt: now, succeededAt: succeededAt ?? jobCursors.succeededAt, processed, failures },
  })
}

/** Records a job's run: a failure always, a success only when the last one is older than the interval or a failure came between. */
export function upsertJobRunStatement(db: Db, job: string, outcome: 'success' | 'failure', now: Date): Statement {
  if (outcome === 'failure') {
    return db.insert(jobRuns).values({ job, lastRunAt: now, lastFailureAt: now, failuresInARow: 1 }).onConflictDoUpdate({
      target: jobRuns.job,
      set: { lastRunAt: now, lastFailureAt: now, failuresInARow: sql`${jobRuns.failuresInARow} + 1` },
    })
  }
  return db.insert(jobRuns).values({ job, lastRunAt: now, lastSuccessAt: now, failuresInARow: 0 }).onConflictDoUpdate({
    target: jobRuns.job,
    set: { lastRunAt: now, lastSuccessAt: now, failuresInARow: 0 },
    setWhere: or(
      gt(jobRuns.failuresInARow, 0),
      isNull(jobRuns.lastSuccessAt),
      lte(jobRuns.lastSuccessAt, new Date(now.getTime() - JOB_RUN_SUCCESS_EVERY_MS)),
    ),
  })
}
