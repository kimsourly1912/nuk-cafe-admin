import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

/**
 * The database the services receive. Locally and in tests it's libsql; on Cloudflare it's D1.
 * Services use only the query builder and `batch`, which both drivers have, never interactive
 * transactions (D1 has none): a multi-statement write is one `batch`, which is atomic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = LibSQLDatabase<any>

/**
 * A batch statement that aborts the whole batch unless the previous statement changed exactly one
 * row. D1 and libsql batches run their statements in order in one transaction, and a failing
 * statement rolls it back; SQLite's `json()` raises an error on the malformed text. Put it right
 * after a conditional `UPDATE … WHERE version = ?`, so the dependent statements after it never
 * apply to a record someone else changed meanwhile. The caller re-reads to report the conflict.
 */
export function requireOneChange(db: Db) {
  return db.run(sql`select case when changes() = 1 then 1 else json('stale write') end`)
}

/**
 * Aborts the batch unless `count` (a scalar subquery) equals `expected`: for a statement set that
 * is only valid for a known set of rows, e.g. reordering all children of a parent.
 */
export function requireCount(db: Db, count: ReturnType<typeof sql>, expected: number) {
  return db.run(sql`select case when (${count}) = ${expected} then 1 else json('stale write') end`)
}

/** Whether a batch failed on a `requireOneChange` / `requireCount` guard. */
export function isStaleWrite(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (/malformed json/i.test(String((e as { message?: unknown }).message ?? e))) return true
  }
  return false
}

/** Whether a write failed on a foreign key (a referenced row is missing, or a row is still referenced). */
export function isForeignKeyError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (/foreign key/i.test(String((e as { message?: unknown }).message ?? e))) return true
  }
  return false
}

export const toIso = (date: Date) => date.toISOString()
