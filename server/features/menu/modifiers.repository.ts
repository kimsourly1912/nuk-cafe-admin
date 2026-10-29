import { and, asc, eq, exists, inArray, isNull, lte, not, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { ModifierDeleteBlocker, ModifierStatus } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, readInChunks, requireCount, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant, nextPosition, withStatus } from '#server/utils/query'
import { menuItemModifierGroups, menuItemModifierPrices, menuModifierGroups, menuModifiers } from './menu.schema'

export interface ModifierGroupRow {
  id: string
  name: string
  minSelect: number
  maxSelect: number | null
  status: ModifierStatus
  version: number
  createdAt: Date
  updatedAt: Date
  /** What keeps it from being deleted permanently (D200). */
  deleteBlocker: ModifierDeleteBlocker | null
}

export interface ModifierRow {
  id: string
  groupId: string
  name: string
  priceDeltaMinor: number
  isDefault: boolean
  sortOrder: number
  status: ModifierStatus
  /** What keeps it from being deleted permanently (D200). */
  deleteBlocker: ModifierDeleteBlocker | null
}

/** An item of any status has its own price for the outer query's add-on (`menu_item_modifier_prices_modifier_fk` restricts). Uses `menu_item_modifier_prices_modifier_idx`. */
const modifierPriced = (db: Db) => exists(db.select({ one: sql`1` }).from(menuItemModifierPrices)
  .where(and(eq(menuItemModifierPrices.tenantId, menuModifiers.tenantId), eq(menuItemModifierPrices.modifierId, menuModifiers.id))))

const groupModifier = alias(menuModifiers, 'group_modifier')

/**
 * An item of any status offers the outer query's group, or has its own price for one of its
 * add-ons (both foreign keys restrict). Order lines keep add-ons as name and price, read by
 * nothing through their ids, so they don't count (D200). Uses `menu_item_modifier_groups_group_idx`
 * and `menu_item_modifier_prices_modifier_idx`.
 */
const groupInUse = (db: Db) => sql`(${exists(db.select({ one: sql`1` }).from(menuItemModifierGroups)
  .where(and(eq(menuItemModifierGroups.tenantId, menuModifierGroups.tenantId), eq(menuItemModifierGroups.groupId, menuModifierGroups.id))))} or ${exists(db.select({ one: sql`1` }).from(menuItemModifierPrices)
  .innerJoin(groupModifier, and(eq(groupModifier.tenantId, menuItemModifierPrices.tenantId), eq(groupModifier.id, menuItemModifierPrices.modifierId)))
  .where(and(eq(groupModifier.tenantId, menuModifierGroups.tenantId), eq(groupModifier.groupId, menuModifierGroups.id))))})`

/** `'items'` while menu items (archived ones too) use it, else `null`. Their own SQL names (D170). */
const groupBlocker = (db: Db) => sql<ModifierDeleteBlocker | null>`case when ${groupInUse(db)} then 'items' end`.as('delete_blocker')
const modifierBlocker = (db: Db) => sql<ModifierDeleteBlocker | null>`case when ${modifierPriced(db)} then 'items' end`.as('modifier_delete_blocker')

const groupColumns = (db: Db) => ({
  id: menuModifierGroups.id,
  name: menuModifierGroups.name,
  minSelect: menuModifierGroups.minSelect,
  maxSelect: menuModifierGroups.maxSelect,
  status: menuModifierGroups.status,
  version: menuModifierGroups.version,
  createdAt: menuModifierGroups.createdAt,
  updatedAt: menuModifierGroups.updatedAt,
  deleteBlocker: groupBlocker(db),
})

const modifierColumns = (db: Db) => ({
  id: menuModifiers.id,
  groupId: menuModifiers.groupId,
  name: menuModifiers.name,
  priceDeltaMinor: menuModifiers.priceDeltaMinor,
  isDefault: menuModifiers.isDefault,
  sortOrder: menuModifiers.sortOrder,
  status: menuModifiers.status,
  deleteBlocker: modifierBlocker(db),
})

/** The cafe's add-ons of one group. */
const modifiersOfGroup = (tenantId: string, groupId: string, ...conditions: SQL[]) =>
  inTenant(menuModifiers, tenantId, eq(menuModifiers.groupId, groupId), ...conditions)

// --- Reads ---

export function findGroup(db: Db, tenantId: string, id: string): Promise<ModifierGroupRow | undefined> {
  return firstRow(db.select(groupColumns(db)).from(menuModifierGroups).where(byId(menuModifierGroups, tenantId, id)))
}

export function listGroups(db: Db, tenantId: string, status: ModifierStatus | 'all'): Promise<ModifierGroupRow[]> {
  return db.select(groupColumns(db))
    .from(menuModifierGroups)
    .where(inTenant(menuModifierGroups, tenantId, withStatus(menuModifierGroups.status, status)))
    .orderBy(byName(menuModifierGroups.name), asc(menuModifierGroups.id))
}

/** The add-ons of these groups, each group's in order (`readInChunks` runs no query for none). */
export function modifiersOf(db: Db, tenantId: string, groupIds: string[]): Promise<ModifierRow[]> {
  return readInChunks(groupIds, ids => db
    .select(modifierColumns(db))
    .from(menuModifiers)
    .where(inTenant(menuModifiers, tenantId, inArray(menuModifiers.groupId, ids)))
    .orderBy(asc(menuModifiers.groupId), asc(menuModifiers.sortOrder), asc(menuModifiers.name)))
}

export function findModifier(db: Db, tenantId: string, groupId: string, modifierId: string): Promise<ModifierRow | undefined> {
  return firstRow(db.select(modifierColumns(db)).from(menuModifiers).where(modifiersOfGroup(tenantId, groupId, eq(menuModifiers.id, modifierId))))
}

export function nextModifierOrder(db: Db, tenantId: string, groupId: string): Promise<number> {
  return nextPosition(db, menuModifiers, menuModifiers.sortOrder, modifiersOfGroup(tenantId, groupId))
}

// --- Guards ---

/**
 * Aborts the batch unless the group's rules can still be met after the change: 1 to 30 active
 * add-ons, at least `min_select` of them, and no more active defaults than `max_select`.
 */
export function requireSelectionRules(db: Db, tenantId: string, groupId: string): Statement {
  const active = eq(menuModifiers.status, 'active')
  const activeCount = db.$count(menuModifiers, modifiersOfGroup(tenantId, groupId, active))
  const defaultCount = db.$count(menuModifiers, modifiersOfGroup(tenantId, groupId, active, eq(menuModifiers.isDefault, true)))
  return requireCount(db, db.$count(menuModifierGroups, and(
    byId(menuModifierGroups, tenantId, groupId),
    sql`${activeCount} between max(1, ${menuModifierGroups.minSelect}) and ${MAX_MODIFIERS}`,
    or(isNull(menuModifierGroups.maxSelect), lte(defaultCount, menuModifierGroups.maxSelect)),
  )), 1)
}

// --- Writes: statements for the service's batch ---

/**
 * Moves the group to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), optionally changing it. Every change to a group or its add-ons starts with this plus
 * `requireOneChange`: the group's version is the lock for all of it.
 */
export function touchGroupStatement(db: Db, tenantId: string, id: string, version: number, now: Date, changes: Partial<Pick<ModifierGroupRow, 'name' | 'status' | 'minSelect' | 'maxSelect'>> = {}, anyStatus = false): Statement {
  return updateAtVersion(db, menuModifierGroups, { tenantId, id, version }, { ...changes, updatedAt: now }, anyStatus ? undefined : eq(menuModifierGroups.status, 'active'))
}

export function insertGroupStatement(db: Db, row: { id: string, tenantId: string, name: string, minSelect: number, maxSelect: number | null, now: Date }): Statement {
  return db.insert(menuModifierGroups).values({ id: row.id, tenantId: row.tenantId, name: row.name, minSelect: row.minSelect, maxSelect: row.maxSelect, createdAt: row.now, updatedAt: row.now })
}

export function insertModifiersStatements(db: Db, rows: { id: string, tenantId: string, groupId: string, name: string, priceDeltaMinor: number, isDefault: boolean, sortOrder: number }[], now: Date): Statement[] {
  return insertAll(db, menuModifiers, rows.map(row => ({ ...row, createdAt: now, updatedAt: now })))
}

export function updateModifierStatement(db: Db, tenantId: string, groupId: string, modifierId: string, changes: Partial<Pick<ModifierRow, 'name' | 'priceDeltaMinor' | 'isDefault' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuModifiers)
    .set({ ...changes, updatedAt: now })
    .where(modifiersOfGroup(tenantId, groupId, eq(menuModifiers.id, modifierId)))
}

/**
 * Deletes one archived add-on no item has its own price for (D200), checked in the statement
 * itself: follow it with `requireOneChange`. Run it after the group's `touchGroupStatement` (the lock).
 */
export function deleteModifierStatement(db: Db, tenantId: string, groupId: string, modifierId: string): Statement {
  return db.delete(menuModifiers).where(modifiersOfGroup(tenantId, groupId, eq(menuModifiers.id, modifierId), eq(menuModifiers.status, 'archived'), not(modifierPriced(db))))
}

/**
 * A permanent group delete (D200): a guard that the group is still at `version`, archived and
 * unused (so nothing below hits a foreign key), then its add-ons, then the group; follow with `requireOneChange`.
 */
export function deleteGroupStatements(db: Db, tenantId: string, id: string, version: number): Statement[] {
  const deletable = db.$count(menuModifierGroups, and(atVersion(menuModifierGroups, tenantId, id, version), eq(menuModifierGroups.status, 'archived'), not(groupInUse(db))))
  return [
    requireCount(db, deletable, 1),
    db.delete(menuModifiers).where(modifiersOfGroup(tenantId, id)),
    db.delete(menuModifierGroups).where(atVersion(menuModifierGroups, tenantId, id, version)),
  ]
}
