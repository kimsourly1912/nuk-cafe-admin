import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { ModifierStatus } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import type { Db, Statement } from '../../utils/batch'
import { requireCount } from '../../utils/batch'
import { menuModifierGroups, menuModifiers } from './menu.schema'

export interface ModifierGroupRow {
  id: string
  name: string
  minSelect: number
  maxSelect: number | null
  status: ModifierStatus
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface ModifierRow {
  id: string
  groupId: string
  name: string
  priceDeltaMinor: number
  isDefault: boolean
  sortOrder: number
  status: ModifierStatus
}

const groupColumns = {
  id: menuModifierGroups.id,
  name: menuModifierGroups.name,
  minSelect: menuModifierGroups.minSelect,
  maxSelect: menuModifierGroups.maxSelect,
  status: menuModifierGroups.status,
  version: menuModifierGroups.version,
  createdAt: menuModifierGroups.createdAt,
  updatedAt: menuModifierGroups.updatedAt,
}

const modifierColumns = {
  id: menuModifiers.id,
  groupId: menuModifiers.groupId,
  name: menuModifiers.name,
  priceDeltaMinor: menuModifiers.priceDeltaMinor,
  isDefault: menuModifiers.isDefault,
  sortOrder: menuModifiers.sortOrder,
  status: menuModifiers.status,
}

export async function findGroup(db: Db, id: string): Promise<ModifierGroupRow | undefined> {
  const rows: ModifierGroupRow[] = await db.select(groupColumns).from(menuModifierGroups).where(eq(menuModifierGroups.id, id)).limit(1)
  return rows[0]
}

export async function listGroups(db: Db, status: ModifierStatus | 'all'): Promise<ModifierGroupRow[]> {
  const query = db.select(groupColumns).from(menuModifierGroups)
  return (status === 'all' ? query : query.where(eq(menuModifierGroups.status, status))).orderBy(asc(sql`lower(${menuModifierGroups.name})`))
}

export async function modifiersOf(db: Db, groupIds: string[]): Promise<ModifierRow[]> {
  if (!groupIds.length) return []
  return db.select(modifierColumns).from(menuModifiers)
    .where(inArray(menuModifiers.groupId, groupIds))
    .orderBy(asc(menuModifiers.sortOrder), asc(menuModifiers.name))
}

export async function findModifier(db: Db, groupId: string, modifierId: string): Promise<ModifierRow | undefined> {
  const rows: ModifierRow[] = await db.select(modifierColumns).from(menuModifiers)
    .where(and(eq(menuModifiers.id, modifierId), eq(menuModifiers.groupId, groupId))).limit(1)
  return rows[0]
}

export async function nextModifierOrder(db: Db, groupId: string): Promise<number> {
  const rows: { top: number | null }[] = await db.select({ top: max(menuModifiers.sortOrder) }).from(menuModifiers)
    .where(eq(menuModifiers.groupId, groupId))
  return (rows[0]?.top ?? 0) + 1
}

// --- Writes: statements for the service's batch ---

/**
 * Moves the group to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), optionally changing it. Every change to a group or its add-ons starts with this plus
 * `requireOneChange`: the group's version is the lock for all of it.
 */
export function touchGroupStatement(db: Db, id: string, version: number, now: Date, changes: Partial<Pick<ModifierGroupRow, 'name' | 'status' | 'minSelect' | 'maxSelect'>> = {}, anyStatus = false): Statement {
  return db.update(menuModifierGroups)
    .set({ ...changes, version: sql`${menuModifierGroups.version} + 1`, updatedAt: now })
    .where(and(eq(menuModifierGroups.id, id), eq(menuModifierGroups.version, version), anyStatus ? undefined : eq(menuModifierGroups.status, 'active')))
}

export function insertGroupStatement(db: Db, row: { id: string, name: string, minSelect: number, maxSelect: number | null, now: Date }): Statement {
  return db.insert(menuModifierGroups).values({ id: row.id, name: row.name, minSelect: row.minSelect, maxSelect: row.maxSelect, createdAt: row.now, updatedAt: row.now })
}

export function insertModifiersStatement(db: Db, rows: { id: string, groupId: string, name: string, priceDeltaMinor: number, isDefault: boolean, sortOrder: number }[], now: Date): Statement {
  return db.insert(menuModifiers).values(rows.map(row => ({ ...row, createdAt: now, updatedAt: now })))
}

export function updateModifierStatement(db: Db, groupId: string, modifierId: string, changes: Partial<Pick<ModifierRow, 'name' | 'priceDeltaMinor' | 'isDefault' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuModifiers).set({ ...changes, updatedAt: now })
    .where(and(eq(menuModifiers.id, modifierId), eq(menuModifiers.groupId, groupId)))
}

/**
 * Aborts the batch unless the group's rules can still be met after the change: 1 to 30 active
 * add-ons, at least `min_select` of them, and no more active defaults than `max_select`.
 */
export function requireSelectionRules(db: Db, groupId: string): Statement {
  const active = sql`(select count(*) from ${menuModifiers} where ${menuModifiers.groupId} = ${groupId} and ${menuModifiers.status} = 'active')`
  const defaults = sql`(select count(*) from ${menuModifiers} where ${menuModifiers.groupId} = ${groupId} and ${menuModifiers.status} = 'active' and ${menuModifiers.isDefault} = 1)`
  return requireCount(db, sql`select count(*) from ${menuModifierGroups} where ${menuModifierGroups.id} = ${groupId}
    and ${active} between max(1, ${menuModifierGroups.minSelect}) and ${MAX_MODIFIERS}
    and (${menuModifierGroups.maxSelect} is null or ${defaults} <= ${menuModifierGroups.maxSelect})`, 1)
}
