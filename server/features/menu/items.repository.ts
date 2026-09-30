import { and, asc, count, eq, inArray, max, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { ItemListQuery, ItemStatus } from '#shared/contracts/menu-items'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertPieces, readInChunks, requireCount } from '#server/utils/batch'
import { menuCategories, menuItemModifierGroups, menuItemModifierPrices, menuItemOptionSets, menuItems, menuItemVariations, menuModifierGroups, menuModifiers, menuOptionSets, menuOptionValues, menuVariationOptionValues } from './menu.schema'

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

/** A variation is sellable when it's active, priced, and none of its values is archived. */
export const sellable = sql`${menuItemVariations.status} = 'active' and ${menuItemVariations.priceMinor} is not null and not exists (
  select 1 from ${menuVariationOptionValues} join ${menuOptionValues} on ${menuOptionValues.id} = ${menuVariationOptionValues.valueId}
  where ${menuVariationOptionValues.variationId} = ${menuItemVariations.id} and ${menuOptionValues.status} = 'archived')`

export async function findItem(db: Db, id: string): Promise<ItemRow | undefined> {
  const rows: ItemRow[] = await db.select(itemColumns).from(menuItems).where(eq(menuItems.id, id)).limit(1)
  return rows[0]
}

export interface ItemSummaryRow extends ItemRow {
  categoryName: string
  priceMin: number | null
  priceMax: number | null
}

/** Items by category order, then position, with their category's name and sellable price range. */
export async function listItems(db: Db, query: ItemListQuery): Promise<{ rows: ItemSummaryRow[], total: number }> {
  const conditions: SQL[] = []
  if (query.status && query.status !== 'all') conditions.push(eq(menuItems.status, query.status))
  else if (!query.status) conditions.push(ne(menuItems.status, 'archived'))
  if (query.categoryId) conditions.push(eq(menuItems.categoryId, query.categoryId))
  if (query.modifierGroupId) {
    conditions.push(sql`exists (select 1 from ${menuItemModifierGroups} where ${menuItemModifierGroups.itemId} = ${menuItems.id} and ${menuItemModifierGroups.groupId} = ${query.modifierGroupId})`)
  }
  if (query.search) conditions.push(sql`${menuItems.name} like ${`%${query.search.replace(/[\\%_]/g, c => `\\${c}`)}%`} escape '\\'`)
  const where = conditions.length ? and(...conditions) : undefined

  const prices = db.select({
    itemId: menuItemVariations.itemId,
    priceMin: sql<number | null>`min(${menuItemVariations.priceMinor})`.as('price_min'),
    priceMax: sql<number | null>`max(${menuItemVariations.priceMinor})`.as('price_max'),
  }).from(menuItemVariations).where(sellable).groupBy(menuItemVariations.itemId).as('prices')

  const [totals, rows] = await Promise.all([
    db.select({ total: count() }).from(menuItems).where(where) as Promise<{ total: number }[]>,
    db.select({ ...itemColumns, categoryName: menuCategories.name, priceMin: prices.priceMin, priceMax: prices.priceMax })
      .from(menuItems)
      .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
      .leftJoin(prices, eq(prices.itemId, menuItems.id))
      .where(where)
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuItems.sortOrder), asc(menuItems.name))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize) as Promise<ItemSummaryRow[]>,
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

/** The item's option sets in grid order. */
export async function itemSetIds(db: Db, itemId: string): Promise<string[]> {
  const rows: { setId: string }[] = await db.select({ setId: menuItemOptionSets.setId }).from(menuItemOptionSets)
    .where(eq(menuItemOptionSets.itemId, itemId)).orderBy(asc(menuItemOptionSets.sortOrder))
  return rows.map(r => r.setId)
}

/** These option sets with all their values, in the order of `ids`. */
export async function setsWithValues(db: Db, ids: string[]): Promise<SetWithValues[]> {
  if (!ids.length) return []
  const sets: { id: string, name: string, status: 'active' | 'archived' }[] = await db.select({ id: menuOptionSets.id, name: menuOptionSets.name, status: menuOptionSets.status })
    .from(menuOptionSets).where(inArray(menuOptionSets.id, ids))
  const values: { id: string, setId: string, name: string, status: 'active' | 'archived' }[] = await db
    .select({ id: menuOptionValues.id, setId: menuOptionValues.setId, name: menuOptionValues.name, status: menuOptionValues.status })
    .from(menuOptionValues).where(inArray(menuOptionValues.setId, ids)).orderBy(asc(menuOptionValues.sortOrder), asc(menuOptionValues.name))
  return ids.flatMap((id) => {
    const set = sets.find(s => s.id === id)
    return set ? [{ ...set, values: values.filter(v => v.setId === id).map(({ setId: _, ...value }) => value) }] : []
  })
}

export async function variationsOf(db: Db, itemId: string): Promise<VariationRow[]> {
  return db.select({ id: menuItemVariations.id, combinationKey: menuItemVariations.combinationKey, priceMinor: menuItemVariations.priceMinor, status: menuItemVariations.status, sortOrder: menuItemVariations.sortOrder })
    .from(menuItemVariations).where(eq(menuItemVariations.itemId, itemId)).orderBy(asc(menuItemVariations.sortOrder))
}

export async function findCategory(db: Db, id: string) {
  const rows: { id: string, status: string, parentId: string | null }[] = await db.select({ id: menuCategories.id, status: menuCategories.status, parentId: menuCategories.parentId })
    .from(menuCategories).where(eq(menuCategories.id, id)).limit(1)
  return rows[0]
}

export async function countChildCategories(db: Db, categoryId: string): Promise<number> {
  const rows: { n: number }[] = await db.select({ n: count() }).from(menuCategories).where(eq(menuCategories.parentId, categoryId))
  return rows[0]?.n ?? 0
}

/** Drafts and active items of a category, in order (what a reorder must list). */
export async function listedItems(db: Db, categoryId: string): Promise<{ id: string, version: number }[]> {
  return db.select({ id: menuItems.id, version: menuItems.version }).from(menuItems)
    .where(and(eq(menuItems.categoryId, categoryId), ne(menuItems.status, 'archived')))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name))
}

export async function nextItemOrder(db: Db, categoryId: string): Promise<number> {
  const rows: { top: number | null }[] = await db.select({ top: max(menuItems.sortOrder) }).from(menuItems).where(eq(menuItems.categoryId, categoryId))
  return (rows[0]?.top ?? 0) + 1
}

export async function countSellable(db: Db, itemId: string): Promise<number> {
  const rows: { n: number }[] = await db.select({ n: count() }).from(menuItemVariations).where(and(eq(menuItemVariations.itemId, itemId), sellable))
  return rows[0]?.n ?? 0
}

/** Non-archived items per option set, for "used by N items". */
export async function itemCountsBySet(db: Db, setIds: string[]): Promise<Map<string, number>> {
  if (!setIds.length) return new Map()
  const rows: { setId: string, n: number }[] = await readInChunks(setIds, ids => db.select({ setId: menuItemOptionSets.setId, n: count() }).from(menuItemOptionSets)
    .innerJoin(menuItems, eq(menuItems.id, menuItemOptionSets.itemId))
    .where(and(inArray(menuItemOptionSets.setId, ids), ne(menuItems.status, 'archived')))
    .groupBy(menuItemOptionSets.setId))
  return new Map(rows.map(r => [r.setId, r.n]))
}

/** The item's add-on groups in order. */
export async function itemGroups(db: Db, itemId: string): Promise<ItemGroupRow[]> {
  return db.select({ groupId: menuItemModifierGroups.groupId, rulesOverridden: menuItemModifierGroups.rulesOverridden, minSelect: menuItemModifierGroups.minSelect, maxSelect: menuItemModifierGroups.maxSelect })
    .from(menuItemModifierGroups).where(eq(menuItemModifierGroups.itemId, itemId)).orderBy(asc(menuItemModifierGroups.sortOrder))
}

/** The item's own add-on prices, by modifier id. */
export async function itemModifierPrices(db: Db, itemId: string): Promise<Map<string, number>> {
  const rows: { modifierId: string, priceDeltaMinor: number }[] = await db.select({ modifierId: menuItemModifierPrices.modifierId, priceDeltaMinor: menuItemModifierPrices.priceDeltaMinor })
    .from(menuItemModifierPrices).where(eq(menuItemModifierPrices.itemId, itemId))
  return new Map(rows.map(r => [r.modifierId, r.priceDeltaMinor]))
}

/** These add-on groups with all their add-ons, in the order of `ids`. */
export async function groupsWithModifiers(db: Db, ids: string[]): Promise<GroupWithModifiers[]> {
  if (!ids.length) return []
  // At most 10 groups per item (the contract), so one IN list each.
  const groups: Omit<GroupWithModifiers, 'modifiers'>[] = await db.select({ id: menuModifierGroups.id, name: menuModifierGroups.name, minSelect: menuModifierGroups.minSelect, maxSelect: menuModifierGroups.maxSelect, status: menuModifierGroups.status })
    .from(menuModifierGroups).where(inArray(menuModifierGroups.id, ids))
  const modifiers: (GroupWithModifiers['modifiers'][number] & { groupId: string })[] = await db
    .select({ id: menuModifiers.id, groupId: menuModifiers.groupId, name: menuModifiers.name, priceDeltaMinor: menuModifiers.priceDeltaMinor, isDefault: menuModifiers.isDefault, status: menuModifiers.status })
    .from(menuModifiers).where(inArray(menuModifiers.groupId, ids)).orderBy(asc(menuModifiers.sortOrder), asc(menuModifiers.name))
  return ids.flatMap((id) => {
    const group = groups.find(g => g.id === id)
    return group ? [{ ...group, modifiers: modifiers.filter(m => m.groupId === id).map(({ groupId: _, ...modifier }) => modifier) }] : []
  })
}

/** Non-archived items per add-on group, for "used by N items". */
export async function itemCountsByGroup(db: Db, groupIds: string[]): Promise<Map<string, number>> {
  if (!groupIds.length) return new Map()
  const rows: { groupId: string, n: number }[] = await readInChunks(groupIds, ids => db.select({ groupId: menuItemModifierGroups.groupId, n: count() }).from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.itemId))
    .where(and(inArray(menuItemModifierGroups.groupId, ids), ne(menuItems.status, 'archived')))
    .groupBy(menuItemModifierGroups.groupId))
  return new Map(rows.map(r => [r.groupId, r.n]))
}

// --- Guards (checked again inside the batch) ---

/** Aborts unless the category is still active and has no sub-categories (items go in leaves). */
export function requireLeafCategory(db: Db, categoryId: string): Statement {
  return requireCount(db, sql`select count(*) from ${menuCategories} c where c.id = ${categoryId} and c.status = 'active'
    and not exists (select 1 from ${menuCategories} s where s.parent_id = c.id)`, 1)
}

/** Aborts unless every one of these option sets is still active. */
export function requireActiveSets(db: Db, setIds: string[]): Statement {
  return requireCount(db, sql`select count(*) from ${menuOptionSets} where ${inArray(menuOptionSets.id, setIds)} and ${menuOptionSets.status} = 'active'`, setIds.length)
}

/** Aborts unless every one of these option values is still active. */
export function requireActiveValues(db: Db, valueIds: string[]): Statement {
  return requireCount(db, sql`select count(*) from ${menuOptionValues} where ${inArray(menuOptionValues.id, valueIds)} and ${menuOptionValues.status} = 'active'`, valueIds.length)
}

/** Aborts unless every one of these add-on groups is still active. */
export function requireActiveGroups(db: Db, groupIds: string[]): Statement {
  return requireCount(db, sql`select count(*) from ${menuModifierGroups} where ${inArray(menuModifierGroups.id, groupIds)} and ${menuModifierGroups.status} = 'active'`, groupIds.length)
}

/** Abort unless every one of these add-ons is still active (one guard per piece of the list). */
export function requireActiveModifiers(db: Db, modifierIds: string[]): Statement[] {
  return chunk(modifierIds).map(ids => requireCount(db, sql`select count(*) from ${menuModifiers} where ${inArray(menuModifiers.id, ids)} and ${menuModifiers.status} = 'active'`, ids.length))
}

/** Aborts unless the item has at least one sellable variation. */
export function requireSellable(db: Db, itemId: string): Statement {
  return requireCount(db, sql`select count(*) > 0 from ${menuItemVariations} where ${menuItemVariations.itemId} = ${itemId} and ${sellable}`, 1)
}

/** Aborts unless the category has exactly `n` drafts and active items. */
export function requireListedCount(db: Db, categoryId: string, n: number): Statement {
  return requireCount(db, sql`select count(*) from ${menuItems} where ${menuItems.categoryId} = ${categoryId} and ${menuItems.status} <> 'archived'`, n)
}

// --- Writes: statements for the service's batch ---

export function insertItemStatement(db: Db, row: Pick<ItemRow, 'id' | 'categoryId' | 'name' | 'description' | 'imageAssetId' | 'sortOrder'>, now: Date): Statement {
  return db.insert(menuItems).values({ ...row, status: 'draft', createdAt: now, updatedAt: now })
}

/**
 * Moves the item to the next version if it's still at `version` (and, with `from`, in one of those
 * states), applying `changes`. Follow it with `requireOneChange`.
 */
export function touchItemStatement(db: Db, id: string, version: number, now: Date, changes: Partial<Pick<ItemRow, 'categoryId' | 'name' | 'description' | 'imageAssetId' | 'status' | 'sortOrder'>> = {}, from?: ItemStatus[]): Statement {
  return db.update(menuItems)
    .set({ ...changes, version: sql`${menuItems.version} + 1`, updatedAt: now })
    .where(and(eq(menuItems.id, id), eq(menuItems.version, version), from ? inArray(menuItems.status, from) : undefined))
}

export function replaceOptionSetsStatements(db: Db, itemId: string, setIds: string[]): Statement[] {
  return [
    db.delete(menuItemOptionSets).where(eq(menuItemOptionSets.itemId, itemId)),
    ...(setIds.length ? [db.insert(menuItemOptionSets).values(setIds.map((setId, i) => ({ itemId, setId, sortOrder: i + 1 })))] : []),
  ]
}

/** Replaces the item's add-on groups and its own add-on prices. */
export function replaceModifierGroupsStatements(db: Db, itemId: string, groups: { groupId: string, rules: { minSelect: number, maxSelect: number | null } | null }[], prices: { modifierId: string, priceDeltaMinor: number }[]): Statement[] {
  return [
    db.delete(menuItemModifierPrices).where(eq(menuItemModifierPrices.itemId, itemId)),
    db.delete(menuItemModifierGroups).where(eq(menuItemModifierGroups.itemId, itemId)),
    ...(groups.length
      ? [db.insert(menuItemModifierGroups).values(groups.map((group, i) => ({
          itemId,
          groupId: group.groupId,
          sortOrder: i + 1,
          rulesOverridden: group.rules !== null,
          minSelect: group.rules?.minSelect ?? null,
          maxSelect: group.rules?.maxSelect ?? null,
        })))]
      : []),
    ...insertPieces(menuItemModifierPrices, prices).map(piece => db.insert(menuItemModifierPrices).values(piece.map(price => ({ itemId, ...price })))),
  ]
}

export function insertVariationStatements(db: Db, itemId: string, cell: { id: string, key: string, valueIds: string[], priceMinor: number | null, status: 'active' | 'disabled', sortOrder: number }, now: Date): Statement[] {
  return [
    db.insert(menuItemVariations).values({ id: cell.id, itemId, combinationKey: cell.key, priceMinor: cell.priceMinor, status: cell.status, sortOrder: cell.sortOrder, createdAt: now, updatedAt: now }),
    ...(cell.valueIds.length ? [db.insert(menuVariationOptionValues).values(cell.valueIds.map(valueId => ({ variationId: cell.id, valueId })))] : []),
  ]
}

export function updateVariationStatement(db: Db, itemId: string, variationId: string, changes: Partial<Pick<VariationRow, 'priceMinor' | 'status' | 'sortOrder'>>, now: Date): Statement {
  return db.update(menuItemVariations).set({ ...changes, updatedAt: now })
    .where(and(eq(menuItemVariations.id, variationId), eq(menuItemVariations.itemId, itemId)))
}

export function retireVariationsStatements(db: Db, itemId: string, variationIds: string[], now: Date): Statement[] {
  return chunk(variationIds).map(ids => db.update(menuItemVariations).set({ status: 'retired', updatedAt: now })
    .where(and(eq(menuItemVariations.itemId, itemId), inArray(menuItemVariations.id, ids))))
}

export function positionItemStatement(db: Db, categoryId: string, id: string, version: number, sortOrder: number, now: Date): Statement {
  return db.update(menuItems).set({ sortOrder, version: sql`${menuItems.version} + 1`, updatedAt: now })
    .where(and(eq(menuItems.id, id), eq(menuItems.version, version), eq(menuItems.categoryId, categoryId), ne(menuItems.status, 'archived')))
}
