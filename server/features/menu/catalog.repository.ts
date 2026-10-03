import { and, asc, eq, sql } from 'drizzle-orm'
import type { AvailabilityStatus, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { Db } from '#server/utils/batch'
import { sellable } from './items.repository'
import { menuAvailabilityRules, menuAvailabilityWindows, menuCategories, menuCategoryAvailability, menuItemAvailability, menuItemModifierGroups, menuItemModifierPrices, menuItemOptionSets, menuItems, menuItemVariations, menuModifierGroups, menuModifiers, menuOptionSets, menuOptionValues } from './menu.schema'

/**
 * The reads behind the customer menu (D65). Each one reads the whole active menu through joins
 * rather than `IN` lists of ids, so none grows with the menu's size (D1's 100 parameters, D62).
 * Each reads one tenant's menu: its outer table is filtered by the tenant, and its joins follow
 * links the composite foreign keys keep inside that tenant.
 */

const activeItem = (tenantId: string) => and(eq(menuItems.tenantId, tenantId), eq(menuItems.status, 'active'))

export function activeCategories(db: Db, tenantId: string): Promise<{ id: string, parentId: string | null, name: string, description: string }[]> {
  return db.select({ id: menuCategories.id, parentId: menuCategories.parentId, name: menuCategories.name, description: menuCategories.description })
    .from(menuCategories).where(and(eq(menuCategories.tenantId, tenantId), eq(menuCategories.status, 'active')))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
}

export function categoryRuleLinks(db: Db, tenantId: string): Promise<{ categoryId: string, ruleId: string }[]> {
  return db.select({ categoryId: menuCategoryAvailability.categoryId, ruleId: menuCategoryAvailability.ruleId })
    .from(menuCategoryAvailability)
    .innerJoin(menuCategories, eq(menuCategories.id, menuCategoryAvailability.categoryId))
    .where(and(eq(menuCategoryAvailability.tenantId, tenantId), eq(menuCategories.status, 'active')))
}

export function activeItems(db: Db, tenantId: string): Promise<{ id: string, categoryId: string, name: string, description: string, imageAssetId: string | null }[]> {
  return db.select({ id: menuItems.id, categoryId: menuItems.categoryId, name: menuItems.name, description: menuItems.description, imageAssetId: menuItems.imageAssetId })
    .from(menuItems).where(activeItem(tenantId))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name))
}

export function itemRuleLinks(db: Db, tenantId: string): Promise<{ itemId: string, ruleId: string }[]> {
  return db.select({ itemId: menuItemAvailability.itemId, ruleId: menuItemAvailability.ruleId })
    .from(menuItemAvailability)
    .innerJoin(menuItems, eq(menuItems.id, menuItemAvailability.itemId))
    .where(activeItem(tenantId))
}

/** Sellable versions of active items, in grid order. */
export function sellableVariations(db: Db, tenantId: string): Promise<{ id: string, itemId: string, combinationKey: string, priceMinor: number }[]> {
  return db.select({ id: menuItemVariations.id, itemId: menuItemVariations.itemId, combinationKey: menuItemVariations.combinationKey, priceMinor: sql<number>`${menuItemVariations.priceMinor}` })
    .from(menuItemVariations)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .where(and(activeItem(tenantId), sellable))
    .orderBy(asc(menuItemVariations.sortOrder))
}

/** The option sets of active items, in grid order, with the set's name. */
export function itemOptionSets(db: Db, tenantId: string): Promise<{ itemId: string, setId: string, name: string }[]> {
  return db.select({ itemId: menuItemOptionSets.itemId, setId: menuItemOptionSets.setId, name: menuOptionSets.name })
    .from(menuItemOptionSets)
    .innerJoin(menuItems, eq(menuItems.id, menuItemOptionSets.itemId))
    .innerJoin(menuOptionSets, eq(menuOptionSets.id, menuItemOptionSets.setId))
    .where(activeItem(tenantId))
    .orderBy(asc(menuItemOptionSets.sortOrder))
}

/**
 * Active values of every option set some active item uses, in order. Versions using an archived
 * value aren't sellable, so the menu would drop that value anyway; filtering here keeps the
 * catalog small.
 */
export function activeOptionValues(db: Db, tenantId: string): Promise<{ id: string, setId: string, name: string }[]> {
  return db.select({ id: menuOptionValues.id, setId: menuOptionValues.setId, name: menuOptionValues.name })
    .from(menuOptionValues)
    .where(and(eq(menuOptionValues.tenantId, tenantId), eq(menuOptionValues.status, 'active'), sql`${menuOptionValues.setId} in (select ${menuItemOptionSets.setId} from ${menuItemOptionSets} join ${menuItems} on ${menuItems.id} = ${menuItemOptionSets.itemId} where ${menuItems.status} = 'active')`))
    .orderBy(asc(menuOptionValues.sortOrder), asc(menuOptionValues.name))
}

export interface ItemGroupLink {
  itemId: string
  groupId: string
  name: string
  rulesOverridden: boolean
  ownMin: number | null
  ownMax: number | null
  groupMin: number
  groupMax: number | null
}

/** The active add-on groups of active items, in each item's order. */
export function itemModifierGroups(db: Db, tenantId: string): Promise<ItemGroupLink[]> {
  return db.select({
    itemId: menuItemModifierGroups.itemId,
    groupId: menuItemModifierGroups.groupId,
    name: menuModifierGroups.name,
    rulesOverridden: menuItemModifierGroups.rulesOverridden,
    ownMin: menuItemModifierGroups.minSelect,
    ownMax: menuItemModifierGroups.maxSelect,
    groupMin: menuModifierGroups.minSelect,
    groupMax: menuModifierGroups.maxSelect,
  })
    .from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.itemId))
    .innerJoin(menuModifierGroups, eq(menuModifierGroups.id, menuItemModifierGroups.groupId))
    .where(and(activeItem(tenantId), eq(menuModifierGroups.status, 'active')))
    .orderBy(asc(menuItemModifierGroups.sortOrder))
}

/** Active add-ons of every group some active item offers, in order (`itemModifierGroups` drops archived groups). */
export function activeModifiers(db: Db, tenantId: string): Promise<{ id: string, groupId: string, name: string, priceDeltaMinor: number, isDefault: boolean }[]> {
  return db.select({ id: menuModifiers.id, groupId: menuModifiers.groupId, name: menuModifiers.name, priceDeltaMinor: menuModifiers.priceDeltaMinor, isDefault: menuModifiers.isDefault })
    .from(menuModifiers)
    .where(and(eq(menuModifiers.tenantId, tenantId), eq(menuModifiers.status, 'active'), sql`${menuModifiers.groupId} in (select ${menuItemModifierGroups.groupId} from ${menuItemModifierGroups} join ${menuItems} on ${menuItems.id} = ${menuItemModifierGroups.itemId} where ${menuItems.status} = 'active')`))
    .orderBy(asc(menuModifiers.sortOrder), asc(menuModifiers.name))
}

/** Active items' own add-on prices. */
export function itemModifierPrices(db: Db, tenantId: string): Promise<{ itemId: string, modifierId: string, priceDeltaMinor: number }[]> {
  return db.select({ itemId: menuItemModifierPrices.itemId, modifierId: menuItemModifierPrices.modifierId, priceDeltaMinor: menuItemModifierPrices.priceDeltaMinor })
    .from(menuItemModifierPrices)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierPrices.itemId))
    .where(activeItem(tenantId))
}

/** Every availability rule's status of the tenant (the library is small). */
export function allRules(db: Db, tenantId: string): Promise<{ id: string, status: AvailabilityStatus }[]> {
  return db.select({ id: menuAvailabilityRules.id, status: menuAvailabilityRules.status }).from(menuAvailabilityRules).where(eq(menuAvailabilityRules.tenantId, tenantId))
}

/** Every availability window, with its rule. */
export function allWindows(db: Db, tenantId: string): Promise<(AvailabilityWindow & { ruleId: string })[]> {
  return db.select({ ruleId: menuAvailabilityWindows.ruleId, weekday: menuAvailabilityWindows.weekday, startMinute: menuAvailabilityWindows.startMinute, endMinute: menuAvailabilityWindows.endMinute })
    .from(menuAvailabilityWindows).where(eq(menuAvailabilityWindows.tenantId, tenantId))
}
