import { and, asc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db, Statement } from '../../utils/batch'
import { insertPieces } from '../../utils/batch'
import { branchItemStates, menuCategories, menuItemOptionSets, menuItems, menuItemVariations, menuOptionValues, menuVariationOptionValues } from './menu.schema'

/**
 * What the counter sees (D63): published items in active categories (and an active parent), and
 * their sellable variations with this branch's sold-out switch. Every query filters by status and
 * joins; none takes a list of ids, so none grows past D1's parameter limit (D62).
 */

const parent = alias(menuCategories, 'parent')

/** Published items customers can see: active item, active category, active parent (if any). */
const visibleItem = and(
  eq(menuItems.status, 'active'),
  eq(menuCategories.status, 'active'),
  sql`(${parent.id} is null or ${parent.status} = 'active')`,
)!

/** Active, priced, and no archived option value (the same rule as `sellable` in items.repository). */
const sellableVariation = sql`${menuItemVariations.status} = 'active' and ${menuItemVariations.priceMinor} is not null and not exists (
  select 1 from ${menuVariationOptionValues} join ${menuOptionValues} on ${menuOptionValues.id} = ${menuVariationOptionValues.valueId}
  where ${menuVariationOptionValues.variationId} = ${menuItemVariations.id} and ${menuOptionValues.status} = 'archived')`

export interface CounterItemRow {
  id: string
  name: string
  categoryId: string
  categoryName: string
}

export interface CounterVariationRow {
  id: string
  itemId: string
  priceMinor: number
  soldOut: boolean | null
  changedAt: Date | null
}

export interface VariationValueRow {
  variationId: string
  name: string
  setOrder: number
}

/** Visible items in menu order: top-level category, sub-category, then the item's position. */
export async function visibleItems(db: Db, filter: { itemId?: string, search?: string } = {}): Promise<CounterItemRow[]> {
  const conditions: SQL[] = [visibleItem]
  if (filter.itemId) conditions.push(eq(menuItems.id, filter.itemId))
  if (filter.search) conditions.push(sql`${menuItems.name} like ${`%${filter.search.replace(/[\\%_]/g, c => `\\${c}`)}%`} escape '\\'`)
  return db.select({ id: menuItems.id, name: menuItems.name, categoryId: menuItems.categoryId, categoryName: menuCategories.name })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .leftJoin(parent, eq(parent.id, menuCategories.parentId))
    .where(and(...conditions))
    .orderBy(
      sql`coalesce(${parent.sortOrder}, ${menuCategories.sortOrder})`,
      sql`case when ${parent.id} is null then 0 else ${menuCategories.sortOrder} end`,
      asc(menuItems.sortOrder),
      asc(menuItems.name),
    )
}

/** Sellable variations of visible items (or of one item), in grid order, with the branch's switch. */
export async function visibleVariations(db: Db, branchId: string, itemId?: string): Promise<CounterVariationRow[]> {
  return db.select({
    id: menuItemVariations.id,
    itemId: menuItemVariations.itemId,
    priceMinor: sql<number>`${menuItemVariations.priceMinor}`,
    soldOut: branchItemStates.soldOut,
    changedAt: branchItemStates.updatedAt,
  })
    .from(menuItemVariations)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .leftJoin(parent, eq(parent.id, menuCategories.parentId))
    .leftJoin(branchItemStates, and(eq(branchItemStates.variationId, menuItemVariations.id), eq(branchItemStates.branchId, branchId)))
    .where(and(visibleItem, sellableVariation, itemId ? eq(menuItemVariations.itemId, itemId) : undefined))
    .orderBy(asc(menuItemVariations.sortOrder))
}

/** The option value names of those variations, with their option set's position on the item. */
export async function variationValues(db: Db, itemId?: string): Promise<VariationValueRow[]> {
  return db.select({ variationId: menuVariationOptionValues.variationId, name: menuOptionValues.name, setOrder: menuItemOptionSets.sortOrder })
    .from(menuVariationOptionValues)
    .innerJoin(menuOptionValues, eq(menuOptionValues.id, menuVariationOptionValues.valueId))
    .innerJoin(menuItemVariations, eq(menuItemVariations.id, menuVariationOptionValues.variationId))
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .innerJoin(menuItemOptionSets, and(eq(menuItemOptionSets.itemId, menuItems.id), eq(menuItemOptionSets.setId, menuOptionValues.setId)))
    .where(and(eq(menuItems.status, 'active'), eq(menuItemVariations.status, 'active'), itemId ? eq(menuItems.id, itemId) : undefined))
}

// --- Writes: statements for the service's batch ---

/** Sets the switch of these variations in this branch (creating the rows the first time). */
export function setSoldOutStatements(db: Db, branchId: string, variationIds: string[], soldOut: boolean, userId: string | null, now: Date): Statement[] {
  const rows = variationIds.map(variationId => ({ branchId, variationId, soldOut, updatedBy: userId, updatedAt: now }))
  return insertPieces(branchItemStates, rows, 3).map(piece => db.insert(branchItemStates).values(piece)
    .onConflictDoUpdate({ target: [branchItemStates.branchId, branchItemStates.variationId], set: { soldOut, updatedBy: userId, updatedAt: now } }))
}
