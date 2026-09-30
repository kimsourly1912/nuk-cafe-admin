import { and, asc, eq, sql } from 'drizzle-orm'
import type { AvailabilityStatus, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { Db } from '#server/utils/batch'
import { sellable } from './items.repository'
import { menuAvailabilityRules, menuAvailabilityWindows, menuCategories, menuCategoryAvailability, menuItemAvailability, menuItemModifierGroups, menuItemModifierPrices, menuItemOptionSets, menuItems, menuItemVariations, menuModifierGroups, menuModifiers, menuOptionSets, menuOptionValues } from './menu.schema'

/**
 * The reads behind the customer menu (D65). Each one reads the whole active menu through joins
 * rather than `IN` lists of ids, so none grows with the menu's size (D1's 100 parameters, D62).
 */

const activeItem = eq(menuItems.status, 'active')

export function activeCategories(db: Db): Promise<{ id: string, parentId: string | null, name: string, description: string }[]> {
  return db.select({ id: menuCategories.id, parentId: menuCategories.parentId, name: menuCategories.name, description: menuCategories.description })
    .from(menuCategories).where(eq(menuCategories.status, 'active'))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
}

export function categoryRuleLinks(db: Db): Promise<{ categoryId: string, ruleId: string }[]> {
  return db.select({ categoryId: menuCategoryAvailability.categoryId, ruleId: menuCategoryAvailability.ruleId })
    .from(menuCategoryAvailability)
    .innerJoin(menuCategories, eq(menuCategories.id, menuCategoryAvailability.categoryId))
    .where(eq(menuCategories.status, 'active'))
}

export function activeItems(db: Db): Promise<{ id: string, categoryId: string, name: string, description: string, imageAssetId: string | null }[]> {
  return db.select({ id: menuItems.id, categoryId: menuItems.categoryId, name: menuItems.name, description: menuItems.description, imageAssetId: menuItems.imageAssetId })
    .from(menuItems).where(activeItem)
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name))
}

export function itemRuleLinks(db: Db): Promise<{ itemId: string, ruleId: string }[]> {
  return db.select({ itemId: menuItemAvailability.itemId, ruleId: menuItemAvailability.ruleId })
    .from(menuItemAvailability)
    .innerJoin(menuItems, eq(menuItems.id, menuItemAvailability.itemId))
    .where(activeItem)
}

/** Sellable versions of active items, in grid order. */
export function sellableVariations(db: Db): Promise<{ id: string, itemId: string, combinationKey: string, priceMinor: number }[]> {
  return db.select({ id: menuItemVariations.id, itemId: menuItemVariations.itemId, combinationKey: menuItemVariations.combinationKey, priceMinor: sql<number>`${menuItemVariations.priceMinor}` })
    .from(menuItemVariations)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .where(and(activeItem, sellable))
    .orderBy(asc(menuItemVariations.sortOrder))
}

/** The option sets of active items, in grid order, with the set's name. */
export function itemOptionSets(db: Db): Promise<{ itemId: string, setId: string, name: string }[]> {
  return db.select({ itemId: menuItemOptionSets.itemId, setId: menuItemOptionSets.setId, name: menuOptionSets.name })
    .from(menuItemOptionSets)
    .innerJoin(menuItems, eq(menuItems.id, menuItemOptionSets.itemId))
    .innerJoin(menuOptionSets, eq(menuOptionSets.id, menuItemOptionSets.setId))
    .where(activeItem)
    .orderBy(asc(menuItemOptionSets.sortOrder))
}

/**
 * Active values of every option set some active item uses, in order. Versions using an archived
 * value aren't sellable, so the menu would drop that value anyway; filtering here keeps the
 * catalog small.
 */
export function activeOptionValues(db: Db): Promise<{ id: string, setId: string, name: string }[]> {
  return db.select({ id: menuOptionValues.id, setId: menuOptionValues.setId, name: menuOptionValues.name })
    .from(menuOptionValues)
    .where(and(eq(menuOptionValues.status, 'active'), sql`${menuOptionValues.setId} in (select ${menuItemOptionSets.setId} from ${menuItemOptionSets} join ${menuItems} on ${menuItems.id} = ${menuItemOptionSets.itemId} where ${menuItems.status} = 'active')`))
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
export function itemModifierGroups(db: Db): Promise<ItemGroupLink[]> {
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
    .where(and(activeItem, eq(menuModifierGroups.status, 'active')))
    .orderBy(asc(menuItemModifierGroups.sortOrder))
}

/** Active add-ons of every group some active item offers, in order (`itemModifierGroups` drops archived groups). */
export function activeModifiers(db: Db): Promise<{ id: string, groupId: string, name: string, priceDeltaMinor: number, isDefault: boolean }[]> {
  return db.select({ id: menuModifiers.id, groupId: menuModifiers.groupId, name: menuModifiers.name, priceDeltaMinor: menuModifiers.priceDeltaMinor, isDefault: menuModifiers.isDefault })
    .from(menuModifiers)
    .where(and(eq(menuModifiers.status, 'active'), sql`${menuModifiers.groupId} in (select ${menuItemModifierGroups.groupId} from ${menuItemModifierGroups} join ${menuItems} on ${menuItems.id} = ${menuItemModifierGroups.itemId} where ${menuItems.status} = 'active')`))
    .orderBy(asc(menuModifiers.sortOrder), asc(menuModifiers.name))
}

/** Active items' own add-on prices. */
export function itemModifierPrices(db: Db): Promise<{ itemId: string, modifierId: string, priceDeltaMinor: number }[]> {
  return db.select({ itemId: menuItemModifierPrices.itemId, modifierId: menuItemModifierPrices.modifierId, priceDeltaMinor: menuItemModifierPrices.priceDeltaMinor })
    .from(menuItemModifierPrices)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierPrices.itemId))
    .where(activeItem)
}

/** Every availability rule's status (the library is small). */
export function allRules(db: Db): Promise<{ id: string, status: AvailabilityStatus }[]> {
  return db.select({ id: menuAvailabilityRules.id, status: menuAvailabilityRules.status }).from(menuAvailabilityRules)
}

/** Every availability window, with its rule. */
export function allWindows(db: Db): Promise<(AvailabilityWindow & { ruleId: string })[]> {
  return db.select({ ruleId: menuAvailabilityWindows.ruleId, weekday: menuAvailabilityWindows.weekday, startMinute: menuAvailabilityWindows.startMinute, endMinute: menuAvailabilityWindows.endMinute })
    .from(menuAvailabilityWindows)
}
