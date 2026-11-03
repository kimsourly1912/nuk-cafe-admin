import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { inJsonArray, inTenant, snapshotRows } from '#server/utils/query'
import type { VersionedTable } from '#server/utils/query'
import { branchItemStates, menuAvailabilityRules, menuCategories, menuItemModifierGroups, menuItemOptionSets, menuItems, menuItemVariations, menuModifierGroups, menuOptionSets, menuPromotions } from './menu.schema'

/**
 * Capture BEFORE loading the public menu. Parent versions cover their child rows/links, including
 * option values, add-ons, price grids, availability windows and promotion targets (D194).
 * Library sets include additions/removals: a newly published promotion must also invalidate.
 */
export function checkoutSnapshot(db: Db, tenantId: string, branchId: string, itemIds: readonly string[]): SQL<string> {
  const items = inJsonArray(menuItems.id, itemIds)
  const selectedItems = db.select({ id: menuItems.id }).from(menuItems).where(inTenant(menuItems, tenantId, items))
  const sets = db.select({ id: menuItemOptionSets.setId }).from(menuItemOptionSets)
    .where(inTenant(menuItemOptionSets, tenantId, inArray(menuItemOptionSets.itemId, selectedItems)))
  const groups = db.select({ id: menuItemModifierGroups.groupId }).from(menuItemModifierGroups)
    .where(inTenant(menuItemModifierGroups, tenantId, inArray(menuItemModifierGroups.itemId, selectedItems)))
  const variations = db.select({ id: menuItemVariations.id }).from(menuItemVariations)
    .where(inTenant(menuItemVariations, tenantId, inArray(menuItemVariations.itemId, selectedItems)))
  const versions = (table: VersionedTable, extra?: SQL) => snapshotRows(db, table, [table.id, table.version], inTenant(table, tenantId, extra), [table.id])
  return sql<string>`json_array(
    ${versions(menuItems, items)},
    ${versions(menuCategories)},
    ${versions(menuOptionSets, inArray(menuOptionSets.id, sets))},
    ${versions(menuModifierGroups, inArray(menuModifierGroups.id, groups))},
    ${versions(menuAvailabilityRules)},
    ${versions(menuPromotions)},
    ${snapshotRows(db, branchItemStates, [branchItemStates.variationId, branchItemStates.soldOut], and(
      inTenant(branchItemStates, tenantId), eq(branchItemStates.branchId, branchId), inArray(branchItemStates.variationId, variations),
    )!, [branchItemStates.variationId])}
  )`
}
