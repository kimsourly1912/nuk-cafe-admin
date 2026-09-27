import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { OptionStatus } from '#shared/contracts/menu-options'
import type { Db, Statement } from '../../utils/batch'
import { requireCount } from '../../utils/batch'
import { menuOptionSets, menuOptionValues } from './menu.schema'

export interface OptionSetRow {
  id: string
  name: string
  status: OptionStatus
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface OptionValueRow {
  id: string
  setId: string
  name: string
  sortOrder: number
  status: OptionStatus
}

const setColumns = {
  id: menuOptionSets.id,
  name: menuOptionSets.name,
  status: menuOptionSets.status,
  version: menuOptionSets.version,
  createdAt: menuOptionSets.createdAt,
  updatedAt: menuOptionSets.updatedAt,
}

const valueColumns = {
  id: menuOptionValues.id,
  setId: menuOptionValues.setId,
  name: menuOptionValues.name,
  sortOrder: menuOptionValues.sortOrder,
  status: menuOptionValues.status,
}

export async function findSet(db: Db, id: string): Promise<OptionSetRow | undefined> {
  const rows: OptionSetRow[] = await db.select(setColumns).from(menuOptionSets).where(eq(menuOptionSets.id, id)).limit(1)
  return rows[0]
}

export async function listSets(db: Db, status: OptionStatus | 'all'): Promise<OptionSetRow[]> {
  const query = db.select(setColumns).from(menuOptionSets)
  return (status === 'all' ? query : query.where(eq(menuOptionSets.status, status))).orderBy(asc(sql`lower(${menuOptionSets.name})`))
}

/** The values of these sets, in order. */
export async function valuesOf(db: Db, setIds: string[]): Promise<OptionValueRow[]> {
  if (!setIds.length) return []
  return db.select(valueColumns).from(menuOptionValues)
    .where(inArray(menuOptionValues.setId, setIds))
    .orderBy(asc(menuOptionValues.sortOrder), asc(menuOptionValues.name))
}

export async function findValue(db: Db, setId: string, valueId: string): Promise<OptionValueRow | undefined> {
  const rows: OptionValueRow[] = await db.select(valueColumns).from(menuOptionValues)
    .where(and(eq(menuOptionValues.id, valueId), eq(menuOptionValues.setId, setId))).limit(1)
  return rows[0]
}

export async function nextValueOrder(db: Db, setId: string): Promise<number> {
  const rows: { top: number | null }[] = await db.select({ top: max(menuOptionValues.sortOrder) }).from(menuOptionValues)
    .where(eq(menuOptionValues.setId, setId))
  return (rows[0]?.top ?? 0) + 1
}

// --- Writes: statements for the service's batch ---

/**
 * Moves the set to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), optionally changing it. Every change to a set or its values starts with this plus
 * `requireOneChange`: the set's version is the lock for all of it.
 */
export function touchSetStatement(db: Db, id: string, version: number, now: Date, changes: Partial<Pick<OptionSetRow, 'name' | 'status'>> = {}, anyStatus = false): Statement {
  return db.update(menuOptionSets)
    .set({ ...changes, version: sql`${menuOptionSets.version} + 1`, updatedAt: now })
    .where(and(eq(menuOptionSets.id, id), eq(menuOptionSets.version, version), anyStatus ? undefined : eq(menuOptionSets.status, 'active')))
}

export function insertSetStatement(db: Db, row: { id: string, name: string, now: Date }): Statement {
  return db.insert(menuOptionSets).values({ id: row.id, name: row.name, createdAt: row.now, updatedAt: row.now })
}

export function insertValuesStatement(db: Db, values: { id: string, setId: string, name: string, sortOrder: number }[], now: Date): Statement {
  return db.insert(menuOptionValues).values(values.map(value => ({ ...value, createdAt: now, updatedAt: now })))
}

export function updateValueStatement(db: Db, setId: string, valueId: string, changes: Partial<Pick<OptionValueRow, 'name' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuOptionValues).set({ ...changes, updatedAt: now })
    .where(and(eq(menuOptionValues.id, valueId), eq(menuOptionValues.setId, setId)))
}

/** Aborts the batch unless the set has between 1 and `max` active values (run it after the change). */
export function requireActiveValueCount(db: Db, setId: string, maxValues: number): Statement {
  return requireCount(db, sql`select count(*) between 1 and ${maxValues} from ${menuOptionValues} where ${menuOptionValues.setId} = ${setId} and ${menuOptionValues.status} = 'active'`, 1)
}
