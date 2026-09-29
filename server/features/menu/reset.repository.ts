import { count, isNotNull, sql } from 'drizzle-orm'
import type { Db, Statement } from '../../utils/batch'
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

/** Every menu record, archived ones included, by kind. */
export interface MenuDataCounts {
  categories: number
  optionSets: number
  modifierGroups: number
  availabilityRules: number
  items: { draft: number, active: number, archived: number }
}

export async function countMenuData(db: Db): Promise<MenuDataCounts> {
  const [categories, optionSets, modifierGroups, rules, items] = await Promise.all([
    db.select({ n: count() }).from(menuCategories),
    db.select({ n: count() }).from(menuOptionSets),
    db.select({ n: count() }).from(menuModifierGroups),
    db.select({ n: count() }).from(menuAvailabilityRules),
    db.select({ status: menuItems.status, n: count() }).from(menuItems).groupBy(menuItems.status),
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
 * Deletes every menu row, children first (D1 checks each foreign key as rows go, `restrict` ones
 * included): links and states, versions, items, sub-categories, categories, then the libraries.
 * No parameters, so D1's limit doesn't apply.
 */
export function deleteAllMenuStatements(db: Db): Statement[] {
  return [
    db.delete(branchItemStates),
    db.delete(menuItemAvailability),
    db.delete(menuCategoryAvailability),
    db.delete(menuItemModifierPrices),
    db.delete(menuItemModifierGroups),
    db.delete(menuVariationOptionValues),
    db.delete(menuItemVariations),
    db.delete(menuItemOptionSets),
    db.delete(menuItems),
    db.delete(menuCategories).where(isNotNull(menuCategories.parentId)),
    db.delete(menuCategories).where(sql`1 = 1`),
    db.delete(menuAvailabilityWindows),
    db.delete(menuAvailabilityRules),
    db.delete(menuModifiers),
    db.delete(menuModifierGroups),
    db.delete(menuOptionValues),
    db.delete(menuOptionSets),
  ]
}
