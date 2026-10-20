import { count, isNotNull } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { inTenant } from '#server/utils/query'
import {
  branchItemStates,
  menuAvailabilityRules,
  menuAvailabilityWindows,
  menuCategories,
  menuCategoryAvailability,
  menuItemAvailability,
  menuItemModifierGroups,
  menuItemModifierPrices,
  menuItemOptionSets,
  menuItems,
  menuItemVariations,
  menuModifierGroups,
  menuModifiers,
  menuOptionSets,
  menuOptionValues,
  menuVariationOptionValues,
} from './menu.schema'
import { deleteAllPromotionsStatements } from './promotions.repository'

/** The cafe's menu records, archived ones included, by kind. */
export interface MenuDataCounts {
  categories: number
  optionSets: number
  modifierGroups: number
  availabilityRules: number
  items: { draft: number, active: number, archived: number }
}

/** The cafe's menu records, by kind: one batch. */
export async function countMenuData(db: Db, tenantId: string): Promise<MenuDataCounts> {
  const [categories, optionSets, modifierGroups, rules, items] = await db.batch([
    db.select({ n: count() }).from(menuCategories).where(inTenant(menuCategories, tenantId)),
    db.select({ n: count() }).from(menuOptionSets).where(inTenant(menuOptionSets, tenantId)),
    db.select({ n: count() }).from(menuModifierGroups).where(inTenant(menuModifierGroups, tenantId)),
    db.select({ n: count() }).from(menuAvailabilityRules).where(inTenant(menuAvailabilityRules, tenantId)),
    db.select({ status: menuItems.status, n: count() }).from(menuItems).where(inTenant(menuItems, tenantId)).groupBy(menuItems.status),
  ])
  const byStatus = new Map(items.map(row => [row.status, row.n]))
  return {
    categories: categories[0]?.n ?? 0,
    optionSets: optionSets[0]?.n ?? 0,
    modifierGroups: modifierGroups[0]?.n ?? 0,
    availabilityRules: rules[0]?.n ?? 0,
    items: { draft: byStatus.get('draft') ?? 0, active: byStatus.get('active') ?? 0, archived: byStatus.get('archived') ?? 0 },
  }
}

/**
 * Deletes the cafe's menu rows, children first (D1 checks each foreign key as rows go, `restrict`
 * ones included): links and states, versions, items, sub-categories, categories, then the
 * libraries. One parameter each (the cafe), so D1's limit doesn't apply.
 */
export function deleteAllMenuStatements(db: Db, tenantId: string): Statement[] {
  const children = [
    branchItemStates,
    menuItemAvailability,
    menuCategoryAvailability,
    menuItemModifierPrices,
    menuItemModifierGroups,
    menuVariationOptionValues,
    menuItemVariations,
    menuItemOptionSets,
    menuItems,
  ]
  const libraries = [menuCategories, menuAvailabilityWindows, menuAvailabilityRules, menuModifiers, menuModifierGroups, menuOptionValues, menuOptionSets]
  return [
    // Promotions first: their links point at items and categories (M1, D163).
    ...deleteAllPromotionsStatements(db, tenantId),
    ...children.map(table => db.delete(table).where(inTenant(table, tenantId))),
    // Sub-categories before their parents.
    db.delete(menuCategories).where(inTenant(menuCategories, tenantId, isNotNull(menuCategories.parentId))),
    ...libraries.map(table => db.delete(table).where(inTenant(table, tenantId))),
  ]
}
