import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm'
import type { AvailabilityRuleRef, AvailabilityStatus, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertPieces, readInChunks, requireCount } from '#server/utils/batch'
import { menuAvailabilityRules, menuAvailabilityWindows, menuCategories, menuCategoryAvailability, menuItemAvailability, menuItems } from './menu.schema'

export interface RuleRow {
  id: string
  name: string
  status: AvailabilityStatus
  version: number
  createdAt: Date
  updatedAt: Date
}

const ruleColumns = {
  id: menuAvailabilityRules.id,
  name: menuAvailabilityRules.name,
  status: menuAvailabilityRules.status,
  version: menuAvailabilityRules.version,
  createdAt: menuAvailabilityRules.createdAt,
  updatedAt: menuAvailabilityRules.updatedAt,
}

const refColumns = { id: menuAvailabilityRules.id, name: menuAvailabilityRules.name, status: menuAvailabilityRules.status }
const byName = asc(sql`lower(${menuAvailabilityRules.name})`)

export async function findRule(db: Db, tenantId: string, id: string): Promise<RuleRow | undefined> {
  const rows: RuleRow[] = await db.select(ruleColumns).from(menuAvailabilityRules).where(and(eq(menuAvailabilityRules.tenantId, tenantId), eq(menuAvailabilityRules.id, id))).limit(1)
  return rows[0]
}

export async function listRules(db: Db, tenantId: string, status: AvailabilityStatus | 'all'): Promise<RuleRow[]> {
  return db.select(ruleColumns).from(menuAvailabilityRules)
    .where(and(eq(menuAvailabilityRules.tenantId, tenantId), status === 'all' ? undefined : eq(menuAvailabilityRules.status, status))).orderBy(byName)
}

/** The windows of these rules, by rule id (each list by weekday, then start). */
export async function windowsOf(db: Db, ruleIds: string[]): Promise<Map<string, AvailabilityWindow[]>> {
  const rows: (AvailabilityWindow & { ruleId: string })[] = ruleIds.length
    ? await readInChunks(ruleIds, ids => db.select({ ruleId: menuAvailabilityWindows.ruleId, weekday: menuAvailabilityWindows.weekday, startMinute: menuAvailabilityWindows.startMinute, endMinute: menuAvailabilityWindows.endMinute })
        .from(menuAvailabilityWindows).where(inArray(menuAvailabilityWindows.ruleId, ids)))
    : []
  rows.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
  const windows = new Map<string, AvailabilityWindow[]>()
  for (const { ruleId, ...window } of rows) windows.set(ruleId, [...(windows.get(ruleId) ?? []), window])
  return windows
}

/** "Used by": drafts and active items, and active categories, per rule. */
export async function usageCounts(db: Db, ruleIds: string[]): Promise<{ items: Map<string, number>, categories: Map<string, number> }> {
  if (!ruleIds.length) return { items: new Map(), categories: new Map() }
  const [items, categories] = await Promise.all([
    readInChunks<{ ruleId: string, n: number }>(ruleIds, ids => db.select({ ruleId: menuItemAvailability.ruleId, n: count() }).from(menuItemAvailability)
      .innerJoin(menuItems, eq(menuItems.id, menuItemAvailability.itemId))
      .where(and(inArray(menuItemAvailability.ruleId, ids), ne(menuItems.status, 'archived')))
      .groupBy(menuItemAvailability.ruleId)),
    readInChunks<{ ruleId: string, n: number }>(ruleIds, ids => db.select({ ruleId: menuCategoryAvailability.ruleId, n: count() }).from(menuCategoryAvailability)
      .innerJoin(menuCategories, eq(menuCategories.id, menuCategoryAvailability.categoryId))
      .where(and(inArray(menuCategoryAvailability.ruleId, ids), eq(menuCategories.status, 'active')))
      .groupBy(menuCategoryAvailability.ruleId)),
  ])
  return { items: new Map(items.map(r => [r.ruleId, r.n])), categories: new Map(categories.map(r => [r.ruleId, r.n])) }
}

/** These rules of the tenant, by name (unknown ids and other tenants' are left out). */
export async function findRefs(db: Db, tenantId: string, ids: string[]): Promise<AvailabilityRuleRef[]> {
  if (!ids.length) return []
  const rows: AvailabilityRuleRef[] = await readInChunks(ids, piece => db.select(refColumns).from(menuAvailabilityRules).where(and(eq(menuAvailabilityRules.tenantId, tenantId), inArray(menuAvailabilityRules.id, piece))))
  return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** The rules an item uses, by name. */
export async function itemRules(db: Db, itemId: string): Promise<AvailabilityRuleRef[]> {
  return db.select(refColumns).from(menuItemAvailability)
    .innerJoin(menuAvailabilityRules, eq(menuAvailabilityRules.id, menuItemAvailability.ruleId))
    .where(eq(menuItemAvailability.itemId, itemId)).orderBy(byName)
}

/** The rules of these categories, by category id (each list by name). */
export async function categoryRules(db: Db, categoryIds: string[]): Promise<Map<string, AvailabilityRuleRef[]>> {
  const rows: (AvailabilityRuleRef & { categoryId: string })[] = categoryIds.length
    ? await readInChunks(categoryIds, ids => db.select({ categoryId: menuCategoryAvailability.categoryId, ...refColumns }).from(menuCategoryAvailability)
        .innerJoin(menuAvailabilityRules, eq(menuAvailabilityRules.id, menuCategoryAvailability.ruleId))
        .where(inArray(menuCategoryAvailability.categoryId, ids)))
    : []
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const rules = new Map<string, AvailabilityRuleRef[]>()
  for (const { categoryId, ...rule } of rows) rules.set(categoryId, [...(rules.get(categoryId) ?? []), rule])
  return rules
}

// --- Guards (checked again inside the batch) ---

/** Aborts unless every one of these rules is still the tenant's and active. */
export function requireActiveRules(db: Db, tenantId: string, ruleIds: string[]): Statement[] {
  return chunk(ruleIds).map(ids => requireCount(db, sql`select count(*) from ${menuAvailabilityRules} where ${menuAvailabilityRules.tenantId} = ${tenantId} and ${inArray(menuAvailabilityRules.id, ids)} and ${menuAvailabilityRules.status} = 'active'`, ids.length))
}

/** Aborts if a draft or active item, or an active category, uses the rule. */
export function requireRuleUnused(db: Db, ruleId: string): Statement {
  return requireCount(db, sql`(select count(*) from ${menuItemAvailability} l join ${menuItems} i on i.id = l.item_id where l.rule_id = ${ruleId} and i.status <> 'archived')
    + (select count(*) from ${menuCategoryAvailability} l join ${menuCategories} c on c.id = l.category_id where l.rule_id = ${ruleId} and c.status = 'active')`, 0)
}

// --- Writes: statements for the service's batch ---

export function insertRuleStatement(db: Db, row: { id: string, tenantId: string, name: string, now: Date }): Statement {
  return db.insert(menuAvailabilityRules).values({ id: row.id, tenantId: row.tenantId, name: row.name, createdAt: row.now, updatedAt: row.now })
}

/**
 * Moves the rule to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), applying `changes`. Follow it with `requireOneChange`.
 */
export function touchRuleStatement(db: Db, tenantId: string, id: string, version: number, now: Date, changes: Partial<Pick<RuleRow, 'name' | 'status'>> = {}, anyStatus = false): Statement {
  return db.update(menuAvailabilityRules)
    .set({ ...changes, version: sql`${menuAvailabilityRules.version} + 1`, updatedAt: now })
    .where(and(eq(menuAvailabilityRules.tenantId, tenantId), eq(menuAvailabilityRules.id, id), eq(menuAvailabilityRules.version, version), anyStatus ? undefined : eq(menuAvailabilityRules.status, 'active')))
}

export function replaceWindowsStatements(db: Db, tenantId: string, ruleId: string, windows: AvailabilityWindow[]): Statement[] {
  return [
    db.delete(menuAvailabilityWindows).where(eq(menuAvailabilityWindows.ruleId, ruleId)),
    ...insertPieces(menuAvailabilityWindows, windows).map(piece => db.insert(menuAvailabilityWindows).values(piece.map(window => ({ tenantId, ruleId, ...window })))),
  ]
}

export function replaceItemRulesStatements(db: Db, tenantId: string, itemId: string, ruleIds: string[]): Statement[] {
  return [
    db.delete(menuItemAvailability).where(eq(menuItemAvailability.itemId, itemId)),
    ...insertPieces(menuItemAvailability, ruleIds).map(ids => db.insert(menuItemAvailability).values(ids.map(ruleId => ({ tenantId, itemId, ruleId })))),
  ]
}

export function replaceCategoryRulesStatements(db: Db, tenantId: string, categoryId: string, ruleIds: string[]): Statement[] {
  return [
    db.delete(menuCategoryAvailability).where(eq(menuCategoryAvailability.categoryId, categoryId)),
    ...insertPieces(menuCategoryAvailability, ruleIds).map(ids => db.insert(menuCategoryAvailability).values(ids.map(ruleId => ({ tenantId, categoryId, ruleId })))),
  ]
}
