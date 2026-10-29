import { and, asc, count, eq, exists, inArray, isNotNull, isNull, ne, not, notExists, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { ItemCountsQuery, ItemDeleteBlocker, ItemListQuery, ItemStatus } from '#shared/contracts/menu-items'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertAll, readInChunks, replaceAll, requireCount, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, firstRow, inTenant, nextPosition, readPage, searchIn, withStatus } from '#server/utils/query'
import { itemOnAnOrder } from '#server/features/orders'
import { childrenOf } from './categories.repository'
import { menuCategories, menuItemModifierGroups, menuItemModifierPrices, menuItemOptionSets, menuItems, menuItemVariations, menuModifierGroups, menuModifiers, menuOptionSets, menuOptionValues, menuPromotionItems, menuVariationOptionValues } from './menu.schema'

export interface ItemRow {
  id: string
  categoryId: string
  name: string
  description: string
  imageAssetId: string | null
  status: ItemStatus
  sortOrder: number
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface ItemSummaryRow extends ItemRow {
  categoryName: string
  priceMin: number | null
  priceMax: number | null
  deleteBlocker: ItemDeleteBlocker | null
}

export interface VariationRow {
  id: string
  combinationKey: string
  priceMinor: number | null
  status: 'active' | 'disabled' | 'retired'
  sortOrder: number
}

export interface SetWithValues {
  id: string
  name: string
  status: 'active' | 'archived'
  values: { id: string, name: string, status: 'active' | 'archived' }[]
}

/** An add-on group on an item, with the item's own rules if it overrides them. */
export interface ItemGroupRow {
  groupId: string
  rulesOverridden: boolean
  minSelect: number | null
  maxSelect: number | null
}

export interface GroupWithModifiers {
  id: string
  name: string
  minSelect: number
  maxSelect: number | null
  status: 'active' | 'archived'
  /** In the group's order. */
  modifiers: { id: string, name: string, priceDeltaMinor: number, isDefault: boolean, status: 'active' | 'archived' }[]
}

const itemColumns = {
  id: menuItems.id,
  categoryId: menuItems.categoryId,
  name: menuItems.name,
  description: menuItems.description,
  imageAssetId: menuItems.imageAssetId,
  status: menuItems.status,
  sortOrder: menuItems.sortOrder,
  version: menuItems.version,
  createdAt: menuItems.createdAt,
  updatedAt: menuItems.updatedAt,
}

const variationColumns = {
  id: menuItemVariations.id,
  combinationKey: menuItemVariations.combinationKey,
  priceMinor: menuItemVariations.priceMinor,
  status: menuItemVariations.status,
  sortOrder: menuItemVariations.sortOrder,
}

/** Drafts and active items: what holds a category, and what "used by N items" counts. */
export const listedItem = ne(menuItems.status, 'archived')

/** The cafe's drafts and active items of one category. */
const listedIn = (tenantId: string, categoryId: string) => inTenant(menuItems, tenantId, eq(menuItems.categoryId, categoryId), listedItem)

/**
 * A variation is sellable when it's active, priced, and none of its values is archived. Correlated
 * to the outer query's `menu_item_variations` row (the catalog, the price range, the guards).
 */
export function sellable(db: Db): SQL {
  return and(
    eq(menuItemVariations.status, 'active'),
    isNotNull(menuItemVariations.priceMinor),
    notExists(db
      .select({ one: sql`1` })
      .from(menuVariationOptionValues)
      .innerJoin(menuOptionValues, and(eq(menuOptionValues.tenantId, menuVariationOptionValues.tenantId), eq(menuOptionValues.id, menuVariationOptionValues.valueId)))
      .where(and(
        eq(menuVariationOptionValues.tenantId, menuItemVariations.tenantId),
        eq(menuVariationOptionValues.variationId, menuItemVariations.id),
        eq(menuOptionValues.status, 'archived'),
      ))),
  )!
}

/** Whether a promotion of any status names the item (deleting it would change that promotion). */
const inAPromotion = (db: Db) => exists(db
  .select({ one: sql`1` })
  .from(menuPromotionItems)
  .where(and(eq(menuPromotionItems.tenantId, menuItems.tenantId), eq(menuPromotionItems.itemId, menuItems.id))))

/**
 * What keeps the outer query's item from being deleted permanently (D200): an order line sold it,
 * or a promotion names it; `null` when nothing does. Its own SQL name (D170).
 */
const deleteBlocker = (db: Db) => sql<ItemDeleteBlocker | null>`case
  when ${itemOnAnOrder(db, menuItems)} then 'ordered'
  when ${inAPromotion(db)} then 'promotion'
end`.as('delete_blocker')

/** The cafe's items the list's shared filters match (search, category, add-on group). */
function filterConditions(db: Db, tenantId: string, query: ItemCountsQuery): SQL {
  // Items sit in sub-categories only, so a main category matches its sub-categories' items (two levels).
  const inCategory = query.categoryId
    ? or(
        eq(menuItems.categoryId, query.categoryId),
        inArray(menuItems.categoryId, db.select({ id: menuCategories.id }).from(menuCategories).where(childrenOf(tenantId, query.categoryId))),
      )
    : undefined
  const withGroup = query.modifierGroupId
    ? exists(db
        .select({ one: sql`1` })
        .from(menuItemModifierGroups)
        .where(and(
          eq(menuItemModifierGroups.tenantId, menuItems.tenantId),
          eq(menuItemModifierGroups.itemId, menuItems.id),
          eq(menuItemModifierGroups.groupId, query.modifierGroupId),
        )))
    : undefined
  return inTenant(menuItems, tenantId, inCategory, withGroup, searchIn(query.search, menuItems.name))
}

// --- Reads ---

export function findItem(db: Db, tenantId: string, id: string): Promise<ItemRow | undefined> {
  return firstRow(db.select(itemColumns).from(menuItems).where(byId(menuItems, tenantId, id)))
}

/** The item with what keeps it from being deleted permanently, for the delete's precise refusal. */
export function findItemForDelete(db: Db, tenantId: string, id: string): Promise<(ItemRow & { deleteBlocker: ItemDeleteBlocker | null }) | undefined> {
  return firstRow(db.select({ ...itemColumns, deleteBlocker: deleteBlocker(db) }).from(menuItems).where(byId(menuItems, tenantId, id)))
}

/**
 * A page of items by category order, then position, with their category's name and sellable price
 * range, and how many match: one batch. Without a status, archived items are left out.
 */
export function listItems(db: Db, tenantId: string, query: ItemListQuery): Promise<{ rows: ItemSummaryRow[], total: number }> {
  const where = and(
    filterConditions(db, tenantId, query),
    query.status ? withStatus(menuItems.status, query.status) : listedItem,
    query.photo === 'missing' ? isNull(menuItems.imageAssetId) : undefined,
  )
  const prices = db
    .select({
      itemId: menuItemVariations.itemId,
      priceMin: sql<number | null>`min(${menuItemVariations.priceMinor})`.as('price_min'),
      priceMax: sql<number | null>`max(${menuItemVariations.priceMinor})`.as('price_max'),
    })
    .from(menuItemVariations)
    .where(inTenant(menuItemVariations, tenantId, sellable(db)))
    .groupBy(menuItemVariations.itemId)
    .as('prices')
  return readPage(db,
    db.select({
      ...itemColumns,
      // Its own SQL name: the item's is `name` too, and D1's batch rows are keyed by name (D170).
      categoryName: sql<string>`${menuCategories.name}`.as('category_name'),
      priceMin: prices.priceMin,
      priceMax: prices.priceMax,
      deleteBlocker: deleteBlocker(db),
    })
      .from(menuItems)
      .innerJoin(menuCategories, and(eq(menuCategories.tenantId, menuItems.tenantId), eq(menuCategories.id, menuItems.categoryId)))
      .leftJoin(prices, eq(prices.itemId, menuItems.id))
      .where(where)
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuItems.sortOrder), asc(menuItems.name), asc(menuItems.id))
      .$dynamic(),
    db.select({ total: count() }).from(menuItems).where(where),
    query)
}

/** Per status, the items the filters match and those without a photo: one grouped read. */
export function countItems(db: Db, tenantId: string, query: ItemCountsQuery): Promise<{ status: ItemStatus, items: number, withoutPhoto: number }[]> {
  return db
    .select({
      status: menuItems.status,
      items: count(),
      withoutPhoto: sql<number>`sum(case when ${menuItems.imageAssetId} is null then 1 else 0 end)`.mapWith(Number),
    })
    .from(menuItems)
    .where(filterConditions(db, tenantId, query))
    .groupBy(menuItems.status)
}

/** The item's option sets in grid order. */
export async function itemSetIds(db: Db, tenantId: string, itemId: string): Promise<string[]> {
  const rows = await db
    .select({ setId: menuItemOptionSets.setId })
    .from(menuItemOptionSets)
    .where(inTenant(menuItemOptionSets, tenantId, eq(menuItemOptionSets.itemId, itemId)))
    .orderBy(asc(menuItemOptionSets.sortOrder))
  return rows.map(r => r.setId)
}

/**
 * These option sets of the cafe with all their values, in the order of `ids` (others left out):
 * one batch. At most MAX_ITEM_OPTION_SETS (2) sets of 20 values, so one IN list each.
 */
export async function setsWithValues(db: Db, tenantId: string, ids: string[]): Promise<SetWithValues[]> {
  if (!ids.length) return []
  const [sets, values] = await db.batch([
    db.select({ id: menuOptionSets.id, name: menuOptionSets.name, status: menuOptionSets.status })
      .from(menuOptionSets)
      .where(inTenant(menuOptionSets, tenantId, inArray(menuOptionSets.id, ids))),
    db.select({ id: menuOptionValues.id, setId: menuOptionValues.setId, name: menuOptionValues.name, status: menuOptionValues.status })
      .from(menuOptionValues)
      .where(inTenant(menuOptionValues, tenantId, inArray(menuOptionValues.setId, ids)))
      .orderBy(asc(menuOptionValues.sortOrder), asc(menuOptionValues.name)),
  ])
  return ids.flatMap((id) => {
    const set = sets.find(s => s.id === id)
    return set ? [{ ...set, values: values.filter(v => v.setId === id).map(({ setId: _, ...value }) => value) }] : []
  })
}

export function variationsOf(db: Db, tenantId: string, itemId: string): Promise<VariationRow[]> {
  return db
    .select(variationColumns)
    .from(menuItemVariations)
    .where(inTenant(menuItemVariations, tenantId, eq(menuItemVariations.itemId, itemId)))
    .orderBy(asc(menuItemVariations.sortOrder))
}

/** Drafts and active items of a category, in order (what a reorder must list). */
export function listedItems(db: Db, tenantId: string, categoryId: string): Promise<{ id: string, version: number }[]> {
  return db
    .select({ id: menuItems.id, version: menuItems.version })
    .from(menuItems)
    .where(listedIn(tenantId, categoryId))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name), asc(menuItems.id))
}

/** Drafts and active items in a category (archived ones don't hold it). */
export function countListedItems(db: Db, tenantId: string, categoryId: string): Promise<number> {
  return db.$count(menuItems, listedIn(tenantId, categoryId))
}

/** Drafts and active items per category id (categories without any are left out). */
export async function listedItemCounts(db: Db, tenantId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ categoryId: menuItems.categoryId, n: count() })
    .from(menuItems)
    .where(inTenant(menuItems, tenantId, listedItem))
    .groupBy(menuItems.categoryId)
  return new Map(rows.map(r => [r.categoryId, r.n]))
}

export function nextItemOrder(db: Db, tenantId: string, categoryId: string): Promise<number> {
  return nextPosition(db, menuItems, menuItems.sortOrder, inTenant(menuItems, tenantId, eq(menuItems.categoryId, categoryId)))
}

export async function countSellable(db: Db, tenantId: string, itemId: string): Promise<number> {
  return db.$count(menuItemVariations, inTenant(menuItemVariations, tenantId, eq(menuItemVariations.itemId, itemId), sellable(db)))
}

/** Non-archived items per option set, for "used by N items". Uses `menu_item_option_sets_set_idx`. */
export async function itemCountsBySet(db: Db, tenantId: string, setIds: string[]): Promise<Map<string, number>> {
  const rows = await readInChunks(setIds, ids => db
    .select({ setId: menuItemOptionSets.setId, n: count() })
    .from(menuItemOptionSets)
    .innerJoin(menuItems, and(eq(menuItems.tenantId, menuItemOptionSets.tenantId), eq(menuItems.id, menuItemOptionSets.itemId)))
    .where(inTenant(menuItemOptionSets, tenantId, inArray(menuItemOptionSets.setId, ids), listedItem))
    .groupBy(menuItemOptionSets.setId))
  return new Map(rows.map(r => [r.setId, r.n]))
}

/** The item's add-on groups in order. */
export function itemGroups(db: Db, tenantId: string, itemId: string): Promise<ItemGroupRow[]> {
  return db
    .select({
      groupId: menuItemModifierGroups.groupId,
      rulesOverridden: menuItemModifierGroups.rulesOverridden,
      minSelect: menuItemModifierGroups.minSelect,
      maxSelect: menuItemModifierGroups.maxSelect,
    })
    .from(menuItemModifierGroups)
    .where(inTenant(menuItemModifierGroups, tenantId, eq(menuItemModifierGroups.itemId, itemId)))
    .orderBy(asc(menuItemModifierGroups.sortOrder))
}

/** The item's own add-on prices, by modifier id. */
export async function itemModifierPrices(db: Db, tenantId: string, itemId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ modifierId: menuItemModifierPrices.modifierId, priceDeltaMinor: menuItemModifierPrices.priceDeltaMinor })
    .from(menuItemModifierPrices)
    .where(inTenant(menuItemModifierPrices, tenantId, eq(menuItemModifierPrices.itemId, itemId)))
  return new Map(rows.map(r => [r.modifierId, r.priceDeltaMinor]))
}

/**
 * These add-on groups of the cafe with all their add-ons, in the order of `ids` (others left out):
 * one batch. At most MAX_ITEM_MODIFIER_GROUPS (10) groups, so one IN list each.
 */
export async function groupsWithModifiers(db: Db, tenantId: string, ids: string[]): Promise<GroupWithModifiers[]> {
  if (!ids.length) return []
  const [groups, modifiers] = await db.batch([
    db.select({ id: menuModifierGroups.id, name: menuModifierGroups.name, minSelect: menuModifierGroups.minSelect, maxSelect: menuModifierGroups.maxSelect, status: menuModifierGroups.status })
      .from(menuModifierGroups)
      .where(inTenant(menuModifierGroups, tenantId, inArray(menuModifierGroups.id, ids))),
    db.select({ id: menuModifiers.id, groupId: menuModifiers.groupId, name: menuModifiers.name, priceDeltaMinor: menuModifiers.priceDeltaMinor, isDefault: menuModifiers.isDefault, status: menuModifiers.status })
      .from(menuModifiers)
      .where(inTenant(menuModifiers, tenantId, inArray(menuModifiers.groupId, ids)))
      .orderBy(asc(menuModifiers.sortOrder), asc(menuModifiers.name)),
  ])
  return ids.flatMap((id) => {
    const group = groups.find(g => g.id === id)
    return group ? [{ ...group, modifiers: modifiers.filter(m => m.groupId === id).map(({ groupId: _, ...modifier }) => modifier) }] : []
  })
}

/** Non-archived items per add-on group, for "used by N items". */
export async function itemCountsByGroup(db: Db, tenantId: string, groupIds: string[]): Promise<Map<string, number>> {
  const rows = await readInChunks(groupIds, ids => db
    .select({ groupId: menuItemModifierGroups.groupId, n: count() })
    .from(menuItemModifierGroups)
    .innerJoin(menuItems, and(eq(menuItems.tenantId, menuItemModifierGroups.tenantId), eq(menuItems.id, menuItemModifierGroups.itemId)))
    .where(inTenant(menuItemModifierGroups, tenantId, inArray(menuItemModifierGroups.groupId, ids), listedItem))
    .groupBy(menuItemModifierGroups.groupId))
  return new Map(rows.map(r => [r.groupId, r.n]))
}

// --- Guards (checked again inside the batch) ---

/** Aborts unless the category is still active and has no sub-categories (items go in leaves). */
export function requireLeafCategory(db: Db, tenantId: string, categoryId: string): Statement {
  const active = db.$count(menuCategories, and(byId(menuCategories, tenantId, categoryId), eq(menuCategories.status, 'active')))
  const children = db.$count(menuCategories, childrenOf(tenantId, categoryId))
  return requireCount(db, sql`${active} = 1 and ${children} = 0`, 1)
}

/** Aborts unless every one of these option sets is still the cafe's and active (at most MAX_ITEM_OPTION_SETS, 2). */
export function requireActiveSets(db: Db, tenantId: string, setIds: string[]): Statement {
  return requireCount(db, db.$count(menuOptionSets, inTenant(menuOptionSets, tenantId, inArray(menuOptionSets.id, setIds), eq(menuOptionSets.status, 'active'))), setIds.length)
}

/** Aborts unless every one of these option values is still the cafe's and active (at most 2 sets of MAX_OPTION_VALUES, 20). */
export function requireActiveValues(db: Db, tenantId: string, valueIds: string[]): Statement {
  return requireCount(db, db.$count(menuOptionValues, inTenant(menuOptionValues, tenantId, inArray(menuOptionValues.id, valueIds), eq(menuOptionValues.status, 'active'))), valueIds.length)
}

/** Aborts unless every one of these add-on groups is still the cafe's and active (at most MAX_ITEM_MODIFIER_GROUPS, 10). */
export function requireActiveGroups(db: Db, tenantId: string, groupIds: string[]): Statement {
  return requireCount(db, db.$count(menuModifierGroups, inTenant(menuModifierGroups, tenantId, inArray(menuModifierGroups.id, groupIds), eq(menuModifierGroups.status, 'active'))), groupIds.length)
}

/** Abort unless every one of these add-ons is still the cafe's and active (one guard per piece of the list). */
export function requireActiveModifiers(db: Db, tenantId: string, modifierIds: string[]): Statement[] {
  return chunk(modifierIds).map(ids => requireCount(db, db.$count(menuModifiers, inTenant(menuModifiers, tenantId, inArray(menuModifiers.id, ids), eq(menuModifiers.status, 'active'))), ids.length))
}

/** Aborts unless the item has at least one sellable variation. */
export function requireSellable(db: Db, tenantId: string, itemId: string): Statement {
  const sellableCount = db.$count(menuItemVariations, inTenant(menuItemVariations, tenantId, eq(menuItemVariations.itemId, itemId), sellable(db)))
  return requireCount(db, sql`${sellableCount} > 0`, 1)
}

/** Aborts unless the category has exactly `n` drafts and active items. */
export function requireListedCount(db: Db, tenantId: string, categoryId: string, n: number): Statement {
  return requireCount(db, db.$count(menuItems, listedIn(tenantId, categoryId)), n)
}

// --- Writes: statements for the service's batch ---

export function insertItemStatement(db: Db, row: { tenantId: string } & Pick<ItemRow, 'id' | 'categoryId' | 'name' | 'description' | 'imageAssetId' | 'sortOrder'>, now: Date): Statement {
  return db.insert(menuItems).values({ ...row, status: 'draft', createdAt: now, updatedAt: now })
}

/**
 * Moves the item to the next version if it's still at `version` (and, with `from`, in one of those
 * states), applying `changes`. Follow it with `requireOneChange`.
 */
export function touchItemStatement(db: Db, tenantId: string, id: string, version: number, now: Date, changes: Partial<Pick<ItemRow, 'categoryId' | 'name' | 'description' | 'imageAssetId' | 'status' | 'sortOrder'>> = {}, from?: ItemStatus[]): Statement {
  return updateAtVersion(db, menuItems, { tenantId, id, version }, { ...changes, updatedAt: now }, from ? inArray(menuItems.status, from) : undefined)
}

/**
 * Deletes a draft or archived item still at `version` that no order line sold and no promotion
 * names (D200), checked in the statement itself: follow it with `requireOneChange`. Its option
 * sets, versions (with their sold-out switches), add-on groups and prices, and availability links
 * go with it (cascade).
 */
export function deleteItemStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(menuItems).where(and(
    atVersion(menuItems, tenantId, id, version),
    inArray(menuItems.status, ['draft', 'archived']),
    not(itemOnAnOrder(db, menuItems)),
    not(inAPromotion(db)),
  ))
}

export function replaceOptionSetsStatements(db: Db, tenantId: string, itemId: string, setIds: string[]): Statement[] {
  const rows = setIds.map((setId, i) => ({ tenantId, itemId, setId, sortOrder: i + 1 }))
  return replaceAll(db, menuItemOptionSets, inTenant(menuItemOptionSets, tenantId, eq(menuItemOptionSets.itemId, itemId)), rows)
}

/** Replaces the item's add-on groups and its own add-on prices (the prices go first and come back last). */
export function replaceModifierGroupsStatements(db: Db, tenantId: string, itemId: string, groups: { groupId: string, rules: { minSelect: number, maxSelect: number | null } | null }[], prices: { modifierId: string, priceDeltaMinor: number }[]): Statement[] {
  const groupRows = groups.map((group, i) => ({
    tenantId,
    itemId,
    groupId: group.groupId,
    sortOrder: i + 1,
    rulesOverridden: group.rules !== null,
    minSelect: group.rules?.minSelect ?? null,
    maxSelect: group.rules?.maxSelect ?? null,
  }))
  return [
    db.delete(menuItemModifierPrices).where(inTenant(menuItemModifierPrices, tenantId, eq(menuItemModifierPrices.itemId, itemId))),
    ...replaceAll(db, menuItemModifierGroups, inTenant(menuItemModifierGroups, tenantId, eq(menuItemModifierGroups.itemId, itemId)), groupRows),
    ...insertAll(db, menuItemModifierPrices, prices.map(price => ({ tenantId, itemId, ...price }))),
  ]
}

export function insertVariationStatements(db: Db, tenantId: string, itemId: string, cell: { id: string, key: string, valueIds: string[], priceMinor: number | null, status: 'active' | 'disabled', sortOrder: number }, now: Date): Statement[] {
  return [
    db.insert(menuItemVariations).values({ id: cell.id, tenantId, itemId, combinationKey: cell.key, priceMinor: cell.priceMinor, status: cell.status, sortOrder: cell.sortOrder, createdAt: now, updatedAt: now }),
    ...insertAll(db, menuVariationOptionValues, cell.valueIds.map(valueId => ({ tenantId, variationId: cell.id, valueId }))),
  ]
}

export function updateVariationStatement(db: Db, tenantId: string, itemId: string, variationId: string, changes: Partial<Pick<VariationRow, 'priceMinor' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuItemVariations)
    .set({ ...changes, updatedAt: now })
    .where(inTenant(menuItemVariations, tenantId, eq(menuItemVariations.itemId, itemId), eq(menuItemVariations.id, variationId)))
}

export function retireVariationsStatements(db: Db, tenantId: string, itemId: string, variationIds: string[], now: Date): Statement[] {
  return chunk(variationIds).map(ids => db.update(menuItemVariations)
    .set({ status: 'retired', updatedAt: now })
    .where(inTenant(menuItemVariations, tenantId, eq(menuItemVariations.itemId, itemId), inArray(menuItemVariations.id, ids))))
}

/** Moves one listed item of the category to `sortOrder` if it's still at `version`. Follow it with `requireOneChange`. */
export function positionItemStatement(db: Db, tenantId: string, categoryId: string, id: string, version: number, sortOrder: number, now: Date): Statement {
  return updateAtVersion(db, menuItems, { tenantId, id, version }, { sortOrder, updatedAt: now }, and(eq(menuItems.categoryId, categoryId), listedItem))
}
