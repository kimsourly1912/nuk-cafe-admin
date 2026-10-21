import { and, asc, eq, inArray, max, or, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { SQLiteSelect, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db, Statement } from './batch'
import { containsText } from './search'

/**
 * Building blocks for repositories (docs/server/repositories.md → Shared helpers, D194): the
 * conditions and reads every feature repeats. They take the tenant as a required argument and
 * keep Drizzle's inferred result types; nothing here runs a write.
 */

/** A table that belongs to a cafe (every such table has `tenant_id`). */
export type TenantTable = SQLiteTable & { tenantId: AnyColumn }
/** A cafe's table with an `id` key. */
export type KeyedTable = TenantTable & { id: AnyColumn }
/** A cafe's table with an `id` key and a `version` (optimistic concurrency). */
export type VersionedTable = KeyedTable & { version: AnyColumn }

/** A 1-based page, as `pageQuerySchema` validates it. */
export interface PageQuery {
  page: number
  pageSize: number
}

// --- Conditions ---

/** A chosen column in a growing string set, bound once to preserve one query/snapshot with other lists. */
export function inJsonArray(column: AnyColumn, values: readonly string[]): SQL {
  return inArray(column, sql`(select value from json_each(${JSON.stringify([...new Set(values)])}))`)
}

/** The cafe's rows of `table`, and every other condition given (`undefined` ones are skipped). */
export function inTenant(table: TenantTable, tenantId: string, ...conditions: (SQL | undefined)[]): SQL {
  return and(eq(table.tenantId, tenantId), ...conditions)!
}

/** One row of the cafe, by id. */
export function byId(table: KeyedTable, tenantId: string, id: string): SQL {
  return inTenant(table, tenantId, eq(table.id, id))
}

/** One row of the cafe, by id, only while it's still at `version` (the condition of an edit). */
export function atVersion(table: VersionedTable, tenantId: string, id: string, version: number): SQL {
  return inTenant(table, tenantId, eq(table.id, id), eq(table.version, version))
}

/** A status filter: `undefined` (no condition) for `'all'` or no status. */
export function withStatus(column: AnyColumn, status: string | undefined): SQL | undefined {
  return status === undefined || status === 'all' ? undefined : eq(column, status)
}

/** Rows where any of `columns` contains `search` (`containsText`, D183); `undefined` without a search. */
export function searchIn(search: string | undefined, ...columns: AnyColumn[]): SQL | undefined {
  return search ? or(...columns.map(column => containsText(column, search))) : undefined
}

/** A name order that ignores ASCII case, like the searches. Add a unique column after it. */
export function byName(column: AnyColumn): SQL {
  return asc(sql`lower(${column})`)
}

// --- Reads ---

/**
 * The first row of a select, or `undefined`: adds `limit 1`. Pass the query without a limit.
 *
 * @example
 * return firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, tenantId, id)))
 */
export async function firstRow<T>(query: { limit: (n: number) => PromiseLike<T[]> }): Promise<T | undefined> {
  const [row] = await query.limit(1)
  return row
}

/**
 * Limits a select to one page, as Drizzle's pagination guide does (a `.$dynamic()` query). The
 * query must be ordered, ending with a unique column, or pages can overlap.
 */
export function withPage<T extends SQLiteSelect>(query: T, at: PageQuery) {
  return query.limit(at.pageSize).offset((at.page - 1) * at.pageSize)
}

/**
 * A page of rows and how many rows match, in one `db.batch` (one D1 round trip, one snapshot).
 * `rows` is ordered and in dynamic mode (`.$dynamic()`); `total` is `select({ total: count() })`
 * with the same `where`. D1 returns object rows: the two queries' columns don't collide (D170).
 *
 * @example
 * const where = inTenant(menuItems, tenantId, withStatus(menuItems.status, query.status))
 * return readPage(db, db.select(itemColumns).from(menuItems).where(where).orderBy(asc(menuItems.sortOrder), asc(menuItems.id)).$dynamic(),
 *   db.select({ total: count() }).from(menuItems).where(where), query)
 */
export async function readPage<T extends SQLiteSelect>(
  db: Db,
  rows: T,
  total: Statement & PromiseLike<{ total: number }[]>,
  at: PageQuery,
): Promise<{ rows: Awaited<T>, total: number }> {
  // `db.batch`'s tuple types don't pass through a generic: the one cast of this helper.
  const [list, counted] = await db.batch([withPage(rows, at), total] as never) as [Awaited<T>, { total: number }[]]
  return { rows: list, total: counted[0]?.total ?? 0 }
}

/** Whether any row of `table` matches (`select 1 … limit 1`). */
export async function hasAny(db: Db, table: SQLiteTable, where: SQL | undefined): Promise<boolean> {
  const rows = await db.select({ one: sql<number>`1` }).from(table).where(where).limit(1)
  return rows.length > 0
}

/** The next position after the matching rows' highest `column` (1 when none match). */
export async function nextPosition(db: Db, table: SQLiteTable, column: AnyColumn, where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ top: max(column) }).from(table).where(where)
  return (Number(row?.top) || 0) + 1
}
