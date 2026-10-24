import { and, asc, count, eq, exists, inArray, not, sql } from 'drizzle-orm'
import type { AvailabilityRuleRef, AvailabilityStatus, AvailabilityWindow, RuleDeleteBlocker } from '#shared/contracts/menu-availability'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, readInChunks, replaceAll, requireCount, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant, withStatus } from '#server/utils/query'
import { groupBy } from '#shared/utils/collections'
import { activeCategory } from './categories.repository'
import { listedItem } from './items.repository'
import { menuAvailabilityRules, menuAvailabilityWindows, menuCategories, menuCategoryAvailability, menuItemAvailability, menuItems } from './menu.schema'

export interface RuleRow {
  id: string
  name: string
  status: AvailabilityStatus
  version: number
  createdAt: Date
  updatedAt: Date
}

/** A rule with what keeps it from being deleted permanently (D200). */
export interface RuleListRow extends RuleRow {
  deleteBlocker: RuleDeleteBlocker | null
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

/** The rule order every list uses: by name, ignoring case. */
const byRuleName = (a: AvailabilityRuleRef, b: AvailabilityRuleRef) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

/** Links of the cafe's drafts and active items to these rules (the join follows the composite key). */
const itemUses = (db: Db, tenantId: string, ruleIds: string[]) => inTenant(menuItemAvailability, tenantId, inArray(menuItemAvailability.ruleId, ruleIds), exists(db
  .select({ one: sql`1` })
  .from(menuItems)
  .where(and(eq(menuItems.tenantId, menuItemAvailability.tenantId), eq(menuItems.id, menuItemAvailability.itemId), listedItem))))

/** Links of the cafe's active categories to these rules. */
const categoryUses = (db: Db, tenantId: string, ruleIds: string[]) => inTenant(menuCategoryAvailability, tenantId, inArray(menuCategoryAvailability.ruleId, ruleIds), exists(db
  .select({ one: sql`1` })
  .from(menuCategories)
  .where(and(eq(menuCategories.tenantId, menuCategoryAvailability.tenantId), eq(menuCategories.id, menuCategoryAvailability.categoryId), activeCategory))))

/** An item of any status names the outer query's rule (`menu_item_availability_rule_fk` restricts). */
const linkedToItems = (db: Db) => exists(db.select({ one: sql`1` }).from(menuItemAvailability)
  .where(and(eq(menuItemAvailability.tenantId, menuAvailabilityRules.tenantId), eq(menuItemAvailability.ruleId, menuAvailabilityRules.id))))

/** A category of any status names the outer query's rule (`menu_category_availability_rule_fk` restricts). */
const linkedToCategories = (db: Db) => exists(db.select({ one: sql`1` }).from(menuCategoryAvailability)
  .where(and(eq(menuCategoryAvailability.tenantId, menuAvailabilityRules.tenantId), eq(menuCategoryAvailability.ruleId, menuAvailabilityRules.id))))

/**
 * What keeps the outer query's rule from being deleted permanently (D200): an item or a category,
 * archived ones too, still names it (dropping the link would make one sell at any hour once
 * restored); `null` when nothing does. Its own SQL name (D170).
 */
const deleteBlocker = (db: Db) => sql<RuleDeleteBlocker | null>`case
  when ${linkedToItems(db)} then 'items'
  when ${linkedToCategories(db)} then 'categories'
end`.as('delete_blocker')

const withBlocker = (db: Db) => ({ ...ruleColumns, deleteBlocker: deleteBlocker(db) })

// --- Reads ---

export function findRule(db: Db, tenantId: string, id: string): Promise<RuleRow | undefined> {
  return firstRow(db.select(ruleColumns).from(menuAvailabilityRules).where(byId(menuAvailabilityRules, tenantId, id)))
}

/** The rule with what keeps it from being deleted permanently (what the API answers, and the delete's refusal). */
export function findRuleWithBlocker(db: Db, tenantId: string, id: string): Promise<RuleListRow | undefined> {
  return firstRow(db.select(withBlocker(db)).from(menuAvailabilityRules).where(byId(menuAvailabilityRules, tenantId, id)))
}

export function listRules(db: Db, tenantId: string, status: AvailabilityStatus | 'all'): Promise<RuleListRow[]> {
  return db
    .select(withBlocker(db))
    .from(menuAvailabilityRules)
    .where(inTenant(menuAvailabilityRules, tenantId, withStatus(menuAvailabilityRules.status, status)))
    .orderBy(byName(menuAvailabilityRules.name), asc(menuAvailabilityRules.id))
}

/** The windows of these rules, by rule id (each list by weekday, then start). */
export async function windowsOf(db: Db, tenantId: string, ruleIds: string[]): Promise<Map<string, AvailabilityWindow[]>> {
  const rows = await readInChunks(ruleIds, ids => db
    .select({ ruleId: menuAvailabilityWindows.ruleId, weekday: menuAvailabilityWindows.weekday, startMinute: menuAvailabilityWindows.startMinute, endMinute: menuAvailabilityWindows.endMinute })
    .from(menuAvailabilityWindows)
    .where(inTenant(menuAvailabilityWindows, tenantId, inArray(menuAvailabilityWindows.ruleId, ids))))
  rows.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
  return new Map([...groupBy(rows, r => r.ruleId)].map(([ruleId, windows]) => [ruleId, windows.map(({ ruleId: _, ...window }) => window)]))
}

/** "Used by": drafts and active items, and active categories, per rule (one batch per piece of the list). */
export async function usageCounts(db: Db, tenantId: string, ruleIds: string[]): Promise<{ items: Map<string, number>, categories: Map<string, number> }> {
  const pieces = await Promise.all(chunk(ruleIds).map(ids => db.batch([
    db.select({ ruleId: menuItemAvailability.ruleId, n: count() })
      .from(menuItemAvailability)
      .where(itemUses(db, tenantId, ids))
      .groupBy(menuItemAvailability.ruleId),
    db.select({ ruleId: menuCategoryAvailability.ruleId, n: count() })
      .from(menuCategoryAvailability)
      .where(categoryUses(db, tenantId, ids))
      .groupBy(menuCategoryAvailability.ruleId),
  ])))
  return {
    items: new Map(pieces.flatMap(([items]) => items).map(r => [r.ruleId, r.n])),
    categories: new Map(pieces.flatMap(([, categories]) => categories).map(r => [r.ruleId, r.n])),
  }
}

/** These rules of the cafe, by name (unknown ids and other cafes' are left out). */
export async function findRefs(db: Db, tenantId: string, ids: string[]): Promise<AvailabilityRuleRef[]> {
  const rows = await readInChunks(ids, piece => db.select(refColumns).from(menuAvailabilityRules).where(inTenant(menuAvailabilityRules, tenantId, inArray(menuAvailabilityRules.id, piece))))
  return rows.sort(byRuleName)
}

/** The rules an item uses, by name. */
export function itemRules(db: Db, tenantId: string, itemId: string): Promise<AvailabilityRuleRef[]> {
  return db
    .select(refColumns)
    .from(menuItemAvailability)
    .innerJoin(menuAvailabilityRules, and(eq(menuAvailabilityRules.tenantId, menuItemAvailability.tenantId), eq(menuAvailabilityRules.id, menuItemAvailability.ruleId)))
    .where(inTenant(menuItemAvailability, tenantId, eq(menuItemAvailability.itemId, itemId)))
    .orderBy(byName(menuAvailabilityRules.name), asc(menuAvailabilityRules.id))
}

/** The rules of these categories, by category id (each list by name). */
export async function categoryRules(db: Db, tenantId: string, categoryIds: string[]): Promise<Map<string, AvailabilityRuleRef[]>> {
  const rows = await readInChunks(categoryIds, ids => db
    .select({ categoryId: menuCategoryAvailability.categoryId, ...refColumns })
    .from(menuCategoryAvailability)
    .innerJoin(menuAvailabilityRules, and(eq(menuAvailabilityRules.tenantId, menuCategoryAvailability.tenantId), eq(menuAvailabilityRules.id, menuCategoryAvailability.ruleId)))
    .where(inTenant(menuCategoryAvailability, tenantId, inArray(menuCategoryAvailability.categoryId, ids))))
  rows.sort(byRuleName)
  return new Map([...groupBy(rows, r => r.categoryId)].map(([categoryId, rules]) => [categoryId, rules.map(({ categoryId: _, ...rule }) => rule)]))
}

// --- Guards (checked again inside the batch) ---

/** Aborts unless every one of these rules is still the cafe's and active (one guard per piece of the list). */
export function requireActiveRules(db: Db, tenantId: string, ruleIds: string[]): Statement[] {
  return chunk(ruleIds).map(ids => requireCount(db, db.$count(menuAvailabilityRules, inTenant(menuAvailabilityRules, tenantId, inArray(menuAvailabilityRules.id, ids), eq(menuAvailabilityRules.status, 'active'))), ids.length))
}

/** Aborts if a draft or active item, or an active category, uses the rule (the same uses `usageCounts` counts). */
export function requireRuleUnused(db: Db, tenantId: string, ruleId: string): Statement {
  const items = db.$count(menuItemAvailability, itemUses(db, tenantId, [ruleId]))
  const categories = db.$count(menuCategoryAvailability, categoryUses(db, tenantId, [ruleId]))
  return requireCount(db, sql`${items} + ${categories}`, 0)
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
  return updateAtVersion(db, menuAvailabilityRules, { tenantId, id, version }, { ...changes, updatedAt: now }, anyStatus ? undefined : eq(menuAvailabilityRules.status, 'active'))
}

/**
 * Deletes an archived rule still at `version` that no item or category names (D200), checked in
 * the statement itself: follow it with `requireOneChange`. Its windows go with it (cascade).
 */
export function deleteRuleStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(menuAvailabilityRules).where(and(
    atVersion(menuAvailabilityRules, tenantId, id, version),
    eq(menuAvailabilityRules.status, 'archived'),
    not(linkedToItems(db)),
    not(linkedToCategories(db)),
  ))
}

export function replaceWindowsStatements(db: Db, tenantId: string, ruleId: string, windows: AvailabilityWindow[]): Statement[] {
  return replaceAll(db, menuAvailabilityWindows, inTenant(menuAvailabilityWindows, tenantId, eq(menuAvailabilityWindows.ruleId, ruleId)), windows.map(window => ({ tenantId, ruleId, ...window })))
}

export function replaceItemRulesStatements(db: Db, tenantId: string, itemId: string, ruleIds: string[]): Statement[] {
  return replaceAll(db, menuItemAvailability, inTenant(menuItemAvailability, tenantId, eq(menuItemAvailability.itemId, itemId)), ruleIds.map(ruleId => ({ tenantId, itemId, ruleId })))
}

export function replaceCategoryRulesStatements(db: Db, tenantId: string, categoryId: string, ruleIds: string[]): Statement[] {
  return replaceAll(db, menuCategoryAvailability, inTenant(menuCategoryAvailability, tenantId, eq(menuCategoryAvailability.categoryId, categoryId)), ruleIds.map(ruleId => ({ tenantId, categoryId, ruleId })))
}
