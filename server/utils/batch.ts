import { sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

/**
 * The database that services and repositories receive. Locally and in tests it's libsql; on
 * Cloudflare it's D1. Only the query builder and `batch` are used (both drivers have them), never
 * interactive transactions: D1 has none. A multi-statement write is one `batch`, which is atomic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = LibSQLDatabase<any>

/** One statement of a batch (built by a repository, not yet executed). */
export type Statement = BatchItem<'sqlite'>

/**
 * A guard statement: aborts the whole batch unless the previous statement changed exactly one
 * row. Put it right after a conditional `UPDATE … WHERE version = ?`, so nothing after it applies
 * to a record someone else changed meanwhile. SQLite's `json()` raises on the malformed text.
 */
export function requireOneChange(db: Db): Statement {
  return db.run(sql`select case when changes() = 1 then 1 else json('stale write') end`)
}

/** A guard statement: aborts the batch unless the scalar subquery `count` equals `expected`. */
export function requireCount(db: Db, count: ReturnType<typeof sql>, expected: number): Statement {
  return db.run(sql`select case when (${count}) = ${expected} then 1 else json('stale write') end`)
}

function messageChain(error: unknown): string[] {
  const messages: string[] = []
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    messages.push(String((e as { message?: unknown }).message ?? e))
  }
  return messages
}

/** Whether a batch failed on a guard statement. */
export const isStaleWrite = (error: unknown) => messageChain(error).some(m => /malformed json/i.test(m))

/** Whether a write failed on a foreign key (a referenced row is missing, or a row is still referenced). */
export const isForeignKeyError = (error: unknown) => messageChain(error).some(m => /foreign key/i.test(m))

/** Whether a write failed on a unique index (e.g. a replayed idempotency key). */
export const isUniqueViolation = (error: unknown) => messageChain(error).some(m => /unique constraint/i.test(m))

/**
 * Runs statements as one atomic batch. When a guard stops it, throws `onStale()` (usually the
 * feature's version-conflict error) instead of the driver's error.
 *
 * @example
 * await runBatch(db, [repo.updateStatement(db, item), requireOneChange(db), audit], () => versionConflict('This item'))
 */
export async function runBatch(db: Db, statements: Statement[], onStale: () => Error): Promise<unknown[]> {
  if (!statements.length) return []
  try {
    return await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isStaleWrite(error)) throw onStale()
    throw error
  }
}
