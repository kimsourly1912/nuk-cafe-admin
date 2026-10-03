import { and, count, eq, isNotNull } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
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

/** The tenant's menu records, archived ones included, by kind. */
export interface MenuDataCounts {
  categories: number
  optionSets: number
  modifierGroups: number
  availabilityRules: number
  items: { draft: number, active: number, archived: number }
}

export async function countMenuData(db: Db, tenantId: string): Promise<MenuDataCounts> {
  const [categories, optionSets, modifierGroups, rules, items] = await Promise.all([
    db.select({ n: count() }).from(menuCategories).where(eq(menuCategories.tenantId, tenantId)),
    db.select({ n: count() }).from(menuOptionSets).where(eq(menuOptionSets.tenantId, tenantId)),
    db.select({ n: count() }).from(menuModifierGroups).where(eq(menuModifierGroups.tenantId, tenantId)),
    db.select({ n: count() }).from(menuAvailabilityRules).where(eq(menuAvailabilityRules.tenantId, tenantId)),
    db.select({ status: menuItems.status, n: count() }).from(menuItems).where(eq(menuItems.tenantId, tenantId)).groupBy(menuItems.status),
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
 * Deletes the tenant's menu rows, children first (D1 checks each foreign key as rows go, `restrict`
 * ones included): links and states, versions, items, sub-categories, categories, then the
 * libraries. One parameter each (the tenant), so D1's limit doesn't apply.
 */
export function deleteAllMenuStatements(db: Db, tenantId: string): Statement[] {
  return [
    db.delete(branchItemStates).where(eq(branchItemStates.tenantId, tenantId)),
    db.delete(menuItemAvailability).where(eq(menuItemAvailability.tenantId, tenantId)),
    db.delete(menuCategoryAvailability).where(eq(menuCategoryAvailability.tenantId, tenantId)),
    db.delete(menuItemModifierPrices).where(eq(menuItemModifierPrices.tenantId, tenantId)),
    db.delete(menuItemModifierGroups).where(eq(menuItemModifierGroups.tenantId, tenantId)),
    db.delete(menuVariationOptionValues).where(eq(menuVariationOptionValues.tenantId, tenantId)),
    db.delete(menuItemVariations).where(eq(menuItemVariations.tenantId, tenantId)),
    db.delete(menuItemOptionSets).where(eq(menuItemOptionSets.tenantId, tenantId)),
    db.delete(menuItems).where(eq(menuItems.tenantId, tenantId)),
    db.delete(menuCategories).where(and(eq(menuCategories.tenantId, tenantId), isNotNull(menuCategories.parentId))),
    db.delete(menuCategories).where(eq(menuCategories.tenantId, tenantId)),
    db.delete(menuAvailabilityWindows).where(eq(menuAvailabilityWindows.tenantId, tenantId)),
    db.delete(menuAvailabilityRules).where(eq(menuAvailabilityRules.tenantId, tenantId)),
    db.delete(menuModifiers).where(eq(menuModifiers.tenantId, tenantId)),
    db.delete(menuModifierGroups).where(eq(menuModifierGroups.tenantId, tenantId)),
    db.delete(menuOptionValues).where(eq(menuOptionValues.tenantId, tenantId)),
    db.delete(menuOptionSets).where(eq(menuOptionSets.tenantId, tenantId)),
  ]
}
