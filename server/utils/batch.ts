import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { SQL, Table } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { SQLiteColumn, SQLiteInsertValue, SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core'
import type { VersionedTable } from './query'

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
 * A guard: a one-row `select` that raises inside the batch unless `condition` holds, so the whole
 * batch rolls back. SQLite's `json()` raises on the malformed text. Built with the query builder,
 * not `db.run(sql)`: drizzle's D1 driver can't batch a raw statement that has bound parameters (it
 * crashes reading `stmt.bind`; found on staging, D53). libsql runs both forms.
 */
function guard(db: Db, condition: SQL): Statement {
  return db.select({ guard: sql<number>`case when ${condition} then 1 else json('stale write') end` }).from(sql`(select 1)`)
}

/**
 * A guard statement: aborts the whole batch unless the previous statement changed exactly one
 * row. Put it right after a conditional `UPDATE … WHERE version = ?`, so nothing after it applies
 * to a record someone else changed meanwhile.
 */
export function requireOneChange(db: Db): Statement {
  return guard(db, sql`changes() = 1`)
}

/** A guard statement: aborts the batch unless the scalar subquery `count` equals `expected`. */
export function requireCount(db: Db, count: SQL, expected: number): Statement {
  return guard(db, sql`(${count}) = ${expected}`)
}

/** A guard statement: aborts the batch when the scalar subquery `count` exceeds `max`. */
export function requireAtMost(db: Db, count: SQL, max: number): Statement {
  return guard(db, sql`(${count}) <= ${max}`)
}

/**
 * D1 refuses a statement with more than 100 bound parameters ("too many SQL variables"; checked on
 * staging, D62). libsql allows 32,766, so the test database enforces D1's limit
 * (`server/tests/support/db.ts`). Any list that can grow goes through the helpers below.
 */
export const MAX_PARAMS = 100
/** Ids per `IN (…)` list, leaving room for the statement's other parameters. */
export const IDS_PER_STATEMENT = 90

/** `list` in consecutive pieces of at most `size`. */
export function chunk<T>(list: readonly T[], size = IDS_PER_STATEMENT): T[][] {
  const pieces: T[][] = []
  for (let i = 0; i < list.length; i += size) pieces.push(list.slice(i, i + size))
  return pieces
}

/**
 * Runs a read for `ids` in pieces small enough for D1 and joins the rows. Rows keep their order
 * within a piece only: sort afterwards, or group by the id you passed.
 */
export async function readInChunks<T>(ids: readonly string[], read: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const pieces = await Promise.all(chunk(ids).map(read))
  return pieces.flat()
}

/**
 * Rows for a multi-row insert, in pieces that stay under D1's limit: each row binds at most one
 * parameter per column of the table.
 */
export function insertPieces<T>(table: Table, rows: readonly T[]): T[][] {
  return chunk(rows, Math.max(1, Math.floor(MAX_PARAMS / Object.keys(getTableColumns(table)).length)))
}

// --- Statements every repository writes the same way (docs/server/repositories.md → Shared helpers) ---

/**
 * Changes one of the cafe's rows only while it's still at `version`, and moves it to the next
 * version. Follow it with `requireOneChange`, so a change made meanwhile stops the whole batch.
 * `extra` narrows it further (`eq(table.status, 'active')`).
 *
 * @example
 * updateAtVersion(db, menuOptionSets, { tenantId, id, version }, { name, updatedAt: now }, eq(menuOptionSets.status, 'active'))
 */
export function updateAtVersion<T extends VersionedTable>(
  db: Db,
  table: T,
  key: { tenantId: string, id: string, version: number },
  set: SQLiteUpdateSetSource<T>,
  extra?: SQL,
): Statement {
  return db.update(table)
    .set({ ...set, version: sql`${table.version} + 1` } as SQLiteUpdateSetSource<T>)
    .where(and(eq(table.tenantId, key.tenantId), eq(table.id, key.id), eq(table.version, key.version), extra))
}

/** Inserts the rows in pieces under D1's limit (`insertPieces`); no statement for no rows. */
export function insertAll<T extends SQLiteTable>(db: Db, table: T, rows: readonly SQLiteInsertValue<T>[]): Statement[] {
  return insertPieces(table, rows).map(piece => db.insert(table).values(piece))
}

/** Deletes the rows `where` matches, then inserts `rows` (a parent's links, a rule's windows). */
export function replaceAll<T extends SQLiteTable>(db: Db, table: T, where: SQL, rows: readonly SQLiteInsertValue<T>[]): Statement[] {
  return [db.delete(table).where(where), ...insertAll(db, table, rows)]
}

/**
 * A scheduled cleanup: deletes at most `limit` rows `where` matches, first by `orderBy`, and
 * returns how many. `key` is the table's unique key (the bounded set is chosen by it).
 */
export async function deleteOldest(db: Db, table: SQLiteTable, key: SQLiteColumn, where: SQL, orderBy: SQL[], limit: number): Promise<number> {
  const chosen = db.select({ key }).from(table).where(where).orderBy(...orderBy).limit(limit)
  const removed = await db.delete(table).where(inArray(key, chosen)).returning({ key })
  return removed.length
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
