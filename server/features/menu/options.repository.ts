import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OptionStatus } from '#shared/contracts/menu-options'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, readInChunks, requireCount, updateAtVersion } from '#server/utils/batch'
import { byId, byName, firstRow, inTenant, nextPosition, withStatus } from '#server/utils/query'
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

/** The cafe's values of one set. */
const valuesOfSet = (tenantId: string, setId: string, ...conditions: SQL[]) =>
  inTenant(menuOptionValues, tenantId, eq(menuOptionValues.setId, setId), ...conditions)

// --- Reads ---

export function findSet(db: Db, tenantId: string, id: string): Promise<OptionSetRow | undefined> {
  return firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, tenantId, id)))
}

export function listSets(db: Db, tenantId: string, status: OptionStatus | 'all'): Promise<OptionSetRow[]> {
  return db.select(setColumns)
    .from(menuOptionSets)
    .where(inTenant(menuOptionSets, tenantId, withStatus(menuOptionSets.status, status)))
    .orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id))
}

/** The values of these sets, each set's in order (`readInChunks` runs no query for none). */
export function valuesOf(db: Db, tenantId: string, setIds: string[]): Promise<OptionValueRow[]> {
  return readInChunks(setIds, ids => db
    .select(valueColumns)
    .from(menuOptionValues)
    .where(inTenant(menuOptionValues, tenantId, inArray(menuOptionValues.setId, ids)))
    .orderBy(asc(menuOptionValues.setId), asc(menuOptionValues.sortOrder), asc(menuOptionValues.name)))
}

export function findValue(db: Db, tenantId: string, setId: string, valueId: string): Promise<OptionValueRow | undefined> {
  return firstRow(db.select(valueColumns).from(menuOptionValues).where(valuesOfSet(tenantId, setId, eq(menuOptionValues.id, valueId))))
}

export function nextValueOrder(db: Db, tenantId: string, setId: string): Promise<number> {
  return nextPosition(db, menuOptionValues, menuOptionValues.sortOrder, valuesOfSet(tenantId, setId))
}

// --- Guards ---

/** Aborts the batch unless the set has between 1 and `maxValues` active values (run it after the change). */
export function requireActiveValueCount(db: Db, tenantId: string, setId: string, maxValues: number): Statement {
  const active = db.$count(menuOptionValues, valuesOfSet(tenantId, setId, eq(menuOptionValues.status, 'active')))
  return requireCount(db, sql`${active} between 1 and ${maxValues}`, 1)
}

// --- Writes: statements for the service's batch ---

/**
 * Moves the set to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), optionally changing it. Every change to a set or its values starts with this plus
 * `requireOneChange`: the set's version is the lock for all of it.
 */
export function touchSetStatement(db: Db, tenantId: string, id: string, version: number, now: Date, changes: Partial<Pick<OptionSetRow, 'name' | 'status'>> = {}, anyStatus = false): Statement {
  return updateAtVersion(db, menuOptionSets, { tenantId, id, version }, { ...changes, updatedAt: now }, anyStatus ? undefined : eq(menuOptionSets.status, 'active'))
}

export function insertSetStatement(db: Db, row: { id: string, tenantId: string, name: string, now: Date }): Statement {
  return db.insert(menuOptionSets).values({ id: row.id, tenantId: row.tenantId, name: row.name, createdAt: row.now, updatedAt: row.now })
}

export function insertValuesStatements(db: Db, values: { id: string, tenantId: string, setId: string, name: string, sortOrder: number }[], now: Date): Statement[] {
  return insertAll(db, menuOptionValues, values.map(value => ({ ...value, createdAt: now, updatedAt: now })))
}

export function updateValueStatement(db: Db, tenantId: string, setId: string, valueId: string, changes: Partial<Pick<OptionValueRow, 'name' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuOptionValues)
    .set({ ...changes, updatedAt: now })
    .where(valuesOfSet(tenantId, setId, eq(menuOptionValues.id, valueId)))
}
