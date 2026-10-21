import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { newId } from './ids'

/** Every queue returns the token and attempt count from its atomic claim. */
export interface WorkClaim {
  claimToken: string
  attempts: number
}

interface TokenWork {
  claimToken: SQLiteColumn
  attempts: SQLiteColumn
}

/** A fresh claim and its attempt counter, computed in the claiming update, never from a due-list row. */
export function claimAttempt(work: TokenWork): { claimToken: string, attempts: SQL } {
  return { claimToken: newId(), attempts: sql`${work.attempts} + 1` }
}

/** Work whose scheduled attempt is due. A null time means nothing is scheduled. */
export function pendingWork(work: { status: SQLiteColumn, nextAttemptAt: SQLiteColumn }, now: Date): SQL {
  return and(eq(work.status, 'pending'), lte(work.nextAttemptAt, now))!
}

/** No lease, or its deadline has passed. This never checks a retry time. */
export function availableLease(until: SQLiteColumn, now: Date): SQL {
  return or(isNull(until), lte(until, now))!
}

/** A settlement must name its row, the still-valid state and the exact claim token. */
export function ownsWork(work: Pick<TokenWork, 'claimToken'>, token: string, scope: SQL, state: SQL): SQL {
  return and(scope, state, eq(work.claimToken, token))!
}
