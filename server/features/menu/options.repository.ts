import { and, asc, eq, exists, inArray, not, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { OptionDeleteBlocker, OptionStatus } from '#shared/contracts/menu-options'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, readInChunks, requireCount, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant, nextPosition, withStatus } from '#server/utils/query'
import { menuItemOptionSets, menuOptionSets, menuOptionValues, menuVariationOptionValues } from './menu.schema'

export interface OptionSetRow {
  id: string
  name: string
  status: OptionStatus
  version: number
  createdAt: Date
  updatedAt: Date
  /** What keeps it from being deleted permanently (D200). */
  deleteBlocker: OptionDeleteBlocker | null
}

export interface OptionValueRow {
  id: string
  setId: string
  name: string
  sortOrder: number
  status: OptionStatus
  /** What keeps it from being deleted permanently (D200). */
  deleteBlocker: OptionDeleteBlocker | null
}

/** An item version (any item, any status, retired ones too) uses the outer query's value. */
const valueInUse = (db: Db) => exists(db.select({ one: sql`1` }).from(menuVariationOptionValues)
  .where(and(eq(menuVariationOptionValues.tenantId, menuOptionValues.tenantId), eq(menuVariationOptionValues.valueId, menuOptionValues.id))))

const setValue = alias(menuOptionValues, 'set_value')

/**
 * An item of any status uses the outer query's set, or an item version uses one of its values
 * (`menu_item_option_sets_set_fk` and `menu_variation_option_values_value_fk` restrict).
 */
const setInUse = (db: Db) => sql`(${exists(db.select({ one: sql`1` }).from(menuItemOptionSets)
  .where(and(eq(menuItemOptionSets.tenantId, menuOptionSets.tenantId), eq(menuItemOptionSets.setId, menuOptionSets.id))))} or ${exists(db.select({ one: sql`1` }).from(menuVariationOptionValues)
  .innerJoin(setValue, and(eq(setValue.tenantId, menuVariationOptionValues.tenantId), eq(setValue.id, menuVariationOptionValues.valueId)))
  .where(and(eq(setValue.tenantId, menuOptionSets.tenantId), eq(setValue.setId, menuOptionSets.id))))})`

/** `'items'` while menu items (archived ones too) use it, else `null`. Their own SQL names (D170). */
const setBlocker = (db: Db) => sql<OptionDeleteBlocker | null>`case when ${setInUse(db)} then 'items' end`.as('delete_blocker')
const valueBlocker = (db: Db) => sql<OptionDeleteBlocker | null>`case when ${valueInUse(db)} then 'items' end`.as('value_delete_blocker')

const setColumns = (db: Db) => ({
  id: menuOptionSets.id,
  name: menuOptionSets.name,
  status: menuOptionSets.status,
  version: menuOptionSets.version,
  createdAt: menuOptionSets.createdAt,
  updatedAt: menuOptionSets.updatedAt,
  deleteBlocker: setBlocker(db),
})

const valueColumns = (db: Db) => ({
  id: menuOptionValues.id,
  setId: menuOptionValues.setId,
  name: menuOptionValues.name,
  sortOrder: menuOptionValues.sortOrder,
  status: menuOptionValues.status,
  deleteBlocker: valueBlocker(db),
})

/** The cafe's values of one set. */
const valuesOfSet = (tenantId: string, setId: string, ...conditions: SQL[]) =>
  inTenant(menuOptionValues, tenantId, eq(menuOptionValues.setId, setId), ...conditions)

// --- Reads ---

export function findSet(db: Db, tenantId: string, id: string): Promise<OptionSetRow | undefined> {
  return firstRow(db.select(setColumns(db)).from(menuOptionSets).where(byId(menuOptionSets, tenantId, id)))
}

export function listSets(db: Db, tenantId: string, status: OptionStatus | 'all'): Promise<OptionSetRow[]> {
  return db.select(setColumns(db))
    .from(menuOptionSets)
    .where(inTenant(menuOptionSets, tenantId, withStatus(menuOptionSets.status, status)))
    .orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id))
}

/** The values of these sets, each set's in order (`readInChunks` runs no query for none). */
export function valuesOf(db: Db, tenantId: string, setIds: string[]): Promise<OptionValueRow[]> {
  return readInChunks(setIds, ids => db
    .select(valueColumns(db))
    .from(menuOptionValues)
    .where(inTenant(menuOptionValues, tenantId, inArray(menuOptionValues.setId, ids)))
    .orderBy(asc(menuOptionValues.setId), asc(menuOptionValues.sortOrder), asc(menuOptionValues.name)))
}

export function findValue(db: Db, tenantId: string, setId: string, valueId: string): Promise<OptionValueRow | undefined> {
  return firstRow(db.select(valueColumns(db)).from(menuOptionValues).where(valuesOfSet(tenantId, setId, eq(menuOptionValues.id, valueId))))
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

/**
 * Deletes one archived value no item version uses (D200), checked in the statement itself: follow
 * it with `requireOneChange`. Run it after the set's `touchSetStatement` (the set's lock).
 */
export function deleteValueStatement(db: Db, tenantId: string, setId: string, valueId: string): Statement {
  return db.delete(menuOptionValues).where(valuesOfSet(tenantId, setId, eq(menuOptionValues.id, valueId), eq(menuOptionValues.status, 'archived'), not(valueInUse(db))))
}

/**
 * A permanent set delete (D200): a guard that the set is still at `version`, archived and unused
 * (so nothing below hits a foreign key), then its values, then the set; follow with `requireOneChange`.
 */
export function deleteSetStatements(db: Db, tenantId: string, id: string, version: number): Statement[] {
  const deletable = db.$count(menuOptionSets, and(atVersion(menuOptionSets, tenantId, id, version), eq(menuOptionSets.status, 'archived'), not(setInUse(db))))
  return [
    requireCount(db, deletable, 1),
    db.delete(menuOptionValues).where(valuesOfSet(tenantId, id)),
    db.delete(menuOptionSets).where(atVersion(menuOptionSets, tenantId, id, version)),
  ]
}
