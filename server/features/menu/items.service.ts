import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { CreateItemInput, ItemListQuery, ItemModifierGroup, ItemModifierGroupsInput, ItemVersionInput, MenuItem, MenuItemSummary, ReorderItemsInput, UpdateItemInput } from '#shared/contracts/menu-items'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import type { Actor } from '../identity'
import { attachStatements, getAsset, mediaNotAvailable, releaseStatement } from '../media'
import { auditStatement } from '../platform'
import { categoryNotALeaf, categoryNotAvailable, itemChanged, itemInWrongState, itemNotFound, itemSelectionRules, itemsChanged, modifierGroupNotAvailable, modifierNotAvailable, nothingToSell, optionSetNotAvailable, priceGrid } from './items.errors'
import * as repo from './items.repository'
import type { GroupWithModifiers, ItemGroupRow, ItemRow, SetWithValues, VariationRow } from './items.repository'
import type { GridEntry, GridPlan } from './items.rules'
import { isGridProblem, planGrid } from './items.rules'
import { selectionProblem } from './modifiers.rules'

/**
 * Menu items (docs/server/data-model.md → Menu, D44, D60, D61). The item's `version` locks the item,
 * its option sets, its variations and its add-on groups. Writes check everything first (for precise
 * errors), then re-check the things other admins could change meanwhile (category, option sets and
 * values, add-on groups and add-ons, image) inside the batch.
 */

// --- Reading ---

interface AddOns {
  rows: ItemGroupRow[]
  groups: GroupWithModifiers[]
  prices: Map<string, number>
}

/** The item's add-on groups with the rules and prices that apply on it. */
function toItemGroups({ rows, groups, prices }: AddOns): ItemModifierGroup[] {
  return rows.flatMap((row) => {
    const group = groups.find(g => g.id === row.groupId)
    if (!group) return []
    const modifiers = [...group.modifiers.filter(m => m.status === 'active'), ...group.modifiers.filter(m => m.status === 'archived' && prices.has(m.id))]
    return [{
      id: group.id,
      name: group.name,
      status: group.status,
      minSelect: row.rulesOverridden ? row.minSelect! : group.minSelect,
      maxSelect: row.rulesOverridden ? row.maxSelect : group.maxSelect,
      rulesOverridden: row.rulesOverridden,
      modifiers: modifiers.map(m => ({
        id: m.id,
        name: m.name,
        priceDeltaMinor: prices.get(m.id) ?? m.priceDeltaMinor,
        defaultPriceDeltaMinor: m.priceDeltaMinor,
        priceOverridden: prices.has(m.id),
        isDefault: m.isDefault,
        status: m.status,
      })),
    }]
  })
}

async function loadAddOns(db: Db, itemId: string): Promise<AddOns> {
  const [rows, prices] = await Promise.all([repo.itemGroups(db, itemId), repo.itemModifierPrices(db, itemId)])
  return { rows, prices, groups: await repo.groupsWithModifiers(db, rows.map(r => r.groupId)) }
}

function toItem(row: ItemRow, sets: SetWithValues[], variations: VariationRow[], addOns: AddOns, imageUrl: string | null): MenuItem {
  const setIndex = new Map<string, number>()
  const valueName = new Map<string, string>()
  const archived = new Set<string>()
  sets.forEach((set, i) => set.values.forEach((value) => {
    setIndex.set(value.id, i)
    valueName.set(value.id, value.name)
    if (value.status === 'archived') archived.add(value.id)
  }))
  const visible = variations.filter(v => v.status !== 'retired').map((variation) => {
    const valueIds = (variation.combinationKey ? variation.combinationKey.split(',') : [])
      .sort((a, b) => (setIndex.get(a) ?? 0) - (setIndex.get(b) ?? 0))
    const hidden = valueIds.some(id => archived.has(id))
    return {
      hidden,
      variation: {
        id: variation.id,
        valueIds,
        label: valueIds.map(id => valueName.get(id) ?? '?').join(', '),
        priceMinor: variation.priceMinor,
        status: variation.status as 'active' | 'disabled',
        sellable: variation.status === 'active' && variation.priceMinor !== null && !hidden,
      },
    }
  })
  const usedValues = new Set(visible.flatMap(v => v.variation.valueIds))
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    image: row.imageAssetId && imageUrl ? { id: row.imageAssetId, url: imageUrl } : null,
    status: row.status,
    sortOrder: row.sortOrder,
    optionSets: sets.map(set => ({
      id: set.id,
      name: set.name,
      status: set.status,
      values: [...set.values.filter(v => v.status === 'active'), ...set.values.filter(v => v.status === 'archived' && usedValues.has(v.id))],
    })),
    variations: [...visible.filter(v => !v.hidden), ...visible.filter(v => v.hidden)].map(v => v.variation),
    modifierGroups: toItemGroups(addOns),
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadItem(db: Db, id: string): Promise<MenuItem> {
  const row = await repo.findItem(db, id)
  if (!row) throw itemNotFound()
  const [sets, variations, addOns, image] = await Promise.all([
    repo.itemSetIds(db, id).then(ids => repo.setsWithValues(db, ids)),
    repo.variationsOf(db, id),
    loadAddOns(db, id),
    row.imageAssetId ? getAsset(db, row.imageAssetId) : undefined,
  ])
  return toItem(row, sets, variations, addOns, image?.url ?? null)
}

export async function listItems(db: Db, query: ItemListQuery): Promise<Page<MenuItemSummary>> {
  const { rows, total } = await repo.listItems(db, query)
  const images = await Promise.all(rows.map(row => row.imageAssetId ? getAsset(db, row.imageAssetId) : undefined))
  return {
    items: rows.map((row, i) => ({
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      status: row.status,
      imageUrl: images[i]?.url ?? null,
      priceMinMinor: row.priceMin,
      priceMaxMinor: row.priceMax,
      sortOrder: row.sortOrder,
      version: row.version,
      updatedAt: toIso(row.updatedAt),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

export async function getItem(db: Db, id: string): Promise<MenuItem> {
  return loadItem(db, id)
}

// --- Checks shared by the writes ---

async function ensureLeafCategory(db: Db, categoryId: string) {
  const category = await repo.findCategory(db, categoryId)
  if (!category || category.status !== 'active') throw categoryNotAvailable()
  if (await repo.countChildCategories(db, categoryId) > 0) throw categoryNotALeaf()
}

/** The chosen option sets with their values; newly chosen ones must be active. */
async function loadSets(db: Db, setIds: string[], alreadyOnItem: string[] = []): Promise<SetWithValues[]> {
  const sets = await repo.setsWithValues(db, setIds)
  setIds.forEach((id, i) => {
    const set = sets.find(s => s.id === id)
    if (!set || (set.status !== 'active' && !alreadyOnItem.includes(id))) throw optionSetNotAvailable(i)
  })
  return sets
}

function plan(sets: SetWithValues[], existing: VariationRow[], entries: GridEntry[]): GridPlan {
  const result = planGrid(
    sets.map(set => ({ id: set.id, activeValueIds: set.values.filter(v => v.status === 'active').map(v => v.id), archivedValueIds: set.values.filter(v => v.status === 'archived').map(v => v.id) })),
    existing,
    entries,
  )
  if (isGridProblem(result)) throw priceGrid(result)
  return result
}

/** The statements that write a planned grid: update or create each cell, retire what left the grid. */
function gridStatements(db: Db, itemId: string, grid: GridPlan, now: Date): Statement[] {
  return [
    ...grid.cells.flatMap(cell => cell.id
      ? [repo.updateVariationStatement(db, itemId, cell.id, { priceMinor: cell.priceMinor, status: cell.status, sortOrder: cell.sortOrder }, now)]
      : repo.insertVariationStatements(db, itemId, { ...cell, id: newId() }, now)),
    ...(grid.retire.length ? [repo.retireVariationsStatement(db, itemId, grid.retire, now)] : []),
  ]
}

const gridValueIds = (grid: GridPlan) => [...new Set(grid.cells.flatMap(cell => cell.valueIds))]

interface AddOnPlan {
  groups: { groupId: string, rules: { minSelect: number, maxSelect: number | null } | null }[]
  prices: { modifierId: string, priceDeltaMinor: number }[]
  /** Groups not on the item before: they must be active (checked again in the batch). */
  newGroupIds: string[]
  /** Add-ons priced now but not before: they must be active (checked again in the batch). */
  newPricedIds: string[]
}

/**
 * Checks the submitted add-on groups. A group newly offered must be active; one already on the item
 * may stay after it was archived. The item's own rules must be possible with the group's active
 * add-ons and defaults. Its own prices are for add-ons of that group: active ones, or archived ones
 * it already had a price for (so the form can send back what it read).
 */
async function planAddOns(db: Db, input: ItemModifierGroupsInput, current?: AddOns): Promise<AddOnPlan> {
  const currentIds = current?.rows.map(r => r.groupId) ?? []
  const groups = await repo.groupsWithModifiers(db, input.map(g => g.groupId))
  const plan: AddOnPlan = { groups: [], prices: [], newGroupIds: [], newPricedIds: [] }
  input.forEach((entry, i) => {
    const group = groups.find(g => g.id === entry.groupId)
    const isNew = !currentIds.includes(entry.groupId)
    if (!group || (group.status !== 'active' && isNew)) throw modifierGroupNotAvailable(i)
    if (isNew) plan.newGroupIds.push(group.id)

    if (entry.rules) {
      const active = group.modifiers.filter(m => m.status === 'active')
      const problem = selectionProblem({ ...entry.rules, active: active.length, defaults: active.filter(m => m.isDefault).length })
      if (problem) {
        const field = problem.field === 'modifiers' ? `modifierGroups.${i}.rules` : `modifierGroups.${i}.rules.${problem.field}`
        throw itemSelectionRules(field, problem.message)
      }
    }
    plan.groups.push({ groupId: group.id, rules: entry.rules })

    entry.prices.forEach((price, j) => {
      const modifier = group.modifiers.find(m => m.id === price.modifierId)
      const pricedBefore = !isNew && current!.prices.has(price.modifierId)
      if (!modifier || (modifier.status !== 'active' && !pricedBefore)) throw modifierNotAvailable(`modifierGroups.${i}.prices.${j}.modifierId`)
      if (!pricedBefore) plan.newPricedIds.push(modifier.id)
      plan.prices.push(price)
    })
  })
  return plan
}

/** The guards for a planned add-on list: whatever it newly uses is still active. */
const addOnGuards = (db: Db, plan: AddOnPlan | undefined): Statement[] => [
  ...(plan?.newGroupIds.length ? [repo.requireActiveGroups(db, plan.newGroupIds)] : []),
  ...(plan?.newPricedIds.length ? [repo.requireActiveModifiers(db, plan.newPricedIds)] : []),
]

const audit = (db: Db, actor: Actor, action: string, itemId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.item.${action}`, targetType: 'menu_item', targetId: itemId, metadata })

/**
 * Runs an item write. When a guard stops it, finds out which: the item changed, its category (or
 * the target one) is no longer an active leaf, an option set or value was archived, or the image
 * expired.
 */
async function runItemBatch(db: Db, statements: Statement[], check: { itemId?: string, version?: number, categoryId?: string, setIds?: string[], valueIds?: string[], addOns?: { input: ItemModifierGroupsInput, plan: AddOnPlan }, imageId?: string | null }) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (!isStaleWrite(error)) throw error
    if (check.itemId !== undefined) {
      const item = await repo.findItem(db, check.itemId)
      if (!item) throw itemNotFound()
      if (item.version !== check.version) throw itemChanged()
    }
    if (check.categoryId) await ensureLeafCategory(db, check.categoryId)
    if (check.setIds?.length) {
      const sets = await repo.setsWithValues(db, check.setIds)
      const archivedSet = check.setIds.findIndex(id => sets.find(s => s.id === id)?.status !== 'active')
      if (archivedSet >= 0) throw optionSetNotAvailable(archivedSet)
      const activeValues = new Set(sets.flatMap(s => s.values.filter(v => v.status === 'active').map(v => v.id)))
      if (check.valueIds?.some(id => !activeValues.has(id))) throw priceGrid({ field: 'variations', message: 'An option value was archived while saving. Reload the item and try again.' })
    }
    if (check.addOns) {
      const { input, plan } = check.addOns
      const groups = await repo.groupsWithModifiers(db, input.map(g => g.groupId))
      const isActive = (groupId: string) => groups.find(g => g.id === groupId)?.status === 'active'
      const archivedGroup = input.findIndex(g => plan.newGroupIds.includes(g.groupId) && !isActive(g.groupId))
      if (archivedGroup >= 0) throw modifierGroupNotAvailable(archivedGroup)
      const activeModifiers = new Set(groups.flatMap(g => g.modifiers.filter(m => m.status === 'active').map(m => m.id)))
      for (const [i, group] of input.entries()) {
        const j = group.prices.findIndex(p => plan.newPricedIds.includes(p.modifierId) && !activeModifiers.has(p.modifierId))
        if (j >= 0) throw modifierNotAvailable(`modifierGroups.${i}.prices.${j}.modifierId`)
      }
    }
    if (check.imageId) throw mediaNotAvailable('imageId')
    throw itemChanged()
  }
}

// --- Writes ---

/** A new item, as a draft at the end of its category. */
export async function createItem(db: Db, actor: Actor, input: CreateItemInput): Promise<MenuItem> {
  await ensureLeafCategory(db, input.categoryId)
  const sets = await loadSets(db, input.optionSetIds)
  const grid = plan(sets, [], input.variations)
  const addOns = await planAddOns(db, input.modifierGroups)
  const imageStatements = input.imageId ? await attachStatements(db, input.imageId, 'imageId') : []

  const id = newId()
  const now = new Date()
  const valueIds = gridValueIds(grid)
  await runItemBatch(db, [
    repo.requireLeafCategory(db, input.categoryId),
    ...(input.optionSetIds.length ? [repo.requireActiveSets(db, input.optionSetIds)] : []),
    ...(valueIds.length ? [repo.requireActiveValues(db, valueIds)] : []),
    ...addOnGuards(db, addOns),
    repo.insertItemStatement(db, { id, categoryId: input.categoryId, name: input.name, description: input.description, imageAssetId: input.imageId, sortOrder: await repo.nextItemOrder(db, input.categoryId) }, now),
    ...repo.replaceOptionSetsStatements(db, id, input.optionSetIds),
    ...gridStatements(db, id, grid, now),
    ...repo.replaceModifierGroupsStatements(db, id, addOns.groups, addOns.prices),
    ...imageStatements,
    audit(db, actor, 'create', id, { categoryId: input.categoryId, optionSets: input.optionSetIds.length, versions: grid.cells.length, addOnGroups: addOns.groups.length }),
  ], { categoryId: input.categoryId, setIds: input.optionSetIds, valueIds, addOns: { input: input.modifierGroups, plan: addOns }, imageId: input.imageId })
  return loadItem(db, id)
}

/**
 * Changes an item. Moving it puts it at the end of its new category; a new image is attached and
 * the old one released; new option sets need the new grid, and a grid alone replaces the current
 * one's prices and switches. An active item must keep something to sell.
 */
export async function updateItem(db: Db, actor: Actor, id: string, input: UpdateItemInput): Promise<MenuItem> {
  const item = await repo.findItem(db, id)
  if (!item) throw itemNotFound()
  if (item.version !== input.version) throw itemChanged()
  if (item.status === 'archived') throw itemInWrongState('This menu item is archived. Restore it first.')

  const moving = input.categoryId !== undefined && input.categoryId !== item.categoryId
  if (moving) await ensureLeafCategory(db, input.categoryId!)

  const currentSetIds = await repo.itemSetIds(db, id)
  const setIds = input.optionSetIds ?? currentSetIds
  const setsChanged = input.optionSetIds !== undefined && input.optionSetIds.join() !== currentSetIds.join()
  const newSetIds = setIds.filter(setId => !currentSetIds.includes(setId))
  let grid: GridPlan | undefined
  if (input.variations) {
    const sets = await loadSets(db, setIds, currentSetIds)
    grid = plan(sets, await repo.variationsOf(db, id), input.variations)
  }
  const addOns = input.modifierGroups ? await planAddOns(db, input.modifierGroups, await loadAddOns(db, id)) : undefined

  const imageChanging = input.imageId !== undefined && input.imageId !== item.imageAssetId
  const imageStatements = imageChanging
    ? [...(item.imageAssetId ? [releaseStatement(db, item.imageAssetId)] : []), ...(input.imageId ? await attachStatements(db, input.imageId, 'imageId') : [])]
    : []

  const now = new Date()
  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(moving && { categoryId: input.categoryId, sortOrder: await repo.nextItemOrder(db, input.categoryId!) }),
    ...(imageChanging && { imageAssetId: input.imageId }),
  }
  const valueIds = grid ? gridValueIds(grid) : []
  await runItemBatch(db, [
    repo.touchItemStatement(db, id, input.version, now, changes, ['draft', 'active']),
    requireOneChange(db),
    ...(moving ? [repo.requireLeafCategory(db, input.categoryId!)] : []),
    ...(newSetIds.length ? [repo.requireActiveSets(db, newSetIds)] : []),
    ...(valueIds.length ? [repo.requireActiveValues(db, valueIds)] : []),
    ...addOnGuards(db, addOns),
    ...(setsChanged ? repo.replaceOptionSetsStatements(db, id, setIds) : []),
    ...(grid ? gridStatements(db, id, grid, now) : []),
    ...(addOns ? repo.replaceModifierGroupsStatements(db, id, addOns.groups, addOns.prices) : []),
    ...imageStatements,
    ...(item.status === 'active' ? [repo.requireSellable(db, id)] : []),
    audit(db, actor, moving ? 'move' : 'update', id, {
      fields: [...Object.keys(changes).filter(k => k !== 'sortOrder'), ...(setsChanged ? ['optionSetIds'] : []), ...(grid ? ['variations'] : []), ...(addOns ? ['modifierGroups'] : [])],
      ...(moving && { from: item.categoryId, to: input.categoryId }),
    }),
  ], { itemId: id, version: input.version, categoryId: moving ? input.categoryId : undefined, setIds: newSetIds, valueIds, addOns: addOns && { input: input.modifierGroups!, plan: addOns }, imageId: imageChanging ? input.imageId : undefined })
  return loadItem(db, id)
}

/** draft → active: customers see it (when its category is active). Needs something to sell. */
export async function publishItem(db: Db, actor: Actor, id: string, input: ItemVersionInput): Promise<MenuItem> {
  const item = await openForAction(db, id, input.version, ['draft'], 'Only a draft can be published.')
  await ensureLeafCategory(db, item.categoryId)
  if (await repo.countSellable(db, id) === 0) throw nothingToSell()
  await runItemBatch(db, [
    repo.touchItemStatement(db, id, input.version, new Date(), { status: 'active' }, ['draft']),
    requireOneChange(db),
    repo.requireLeafCategory(db, item.categoryId),
    repo.requireSellable(db, id),
    audit(db, actor, 'publish', id, {}),
  ], { itemId: id, version: input.version, categoryId: item.categoryId })
  return loadItem(db, id)
}

/** active → draft: hidden from customers, still editable. */
export async function unpublishItem(db: Db, actor: Actor, id: string, input: ItemVersionInput): Promise<MenuItem> {
  await openForAction(db, id, input.version, ['active'], 'Only a published item can be unpublished.')
  await runItemBatch(db, [
    repo.touchItemStatement(db, id, input.version, new Date(), { status: 'draft' }, ['active']),
    requireOneChange(db),
    audit(db, actor, 'unpublish', id, {}),
  ], { itemId: id, version: input.version })
  return loadItem(db, id)
}

/** Archives a draft or active item. It keeps its image, versions and ids (orders refer to them). */
export async function archiveItem(db: Db, actor: Actor, id: string, input: ItemVersionInput): Promise<MenuItem> {
  await openForAction(db, id, input.version, ['draft', 'active'], 'This menu item is already archived.')
  await runItemBatch(db, [
    repo.touchItemStatement(db, id, input.version, new Date(), { status: 'archived' }, ['draft', 'active']),
    requireOneChange(db),
    audit(db, actor, 'archive', id, {}),
  ], { itemId: id, version: input.version })
  return loadItem(db, id)
}

/** archived → draft, at the end of its category (which must still be an active leaf). */
export async function restoreItem(db: Db, actor: Actor, id: string, input: ItemVersionInput): Promise<MenuItem> {
  const item = await openForAction(db, id, input.version, ['archived'], 'This menu item isn\'t archived.')
  await ensureLeafCategory(db, item.categoryId)
  await runItemBatch(db, [
    repo.touchItemStatement(db, id, input.version, new Date(), { status: 'draft', sortOrder: await repo.nextItemOrder(db, item.categoryId) }, ['archived']),
    requireOneChange(db),
    repo.requireLeafCategory(db, item.categoryId),
    audit(db, actor, 'restore', id, {}),
  ], { itemId: id, version: input.version, categoryId: item.categoryId })
  return loadItem(db, id)
}

async function openForAction(db: Db, id: string, version: number, from: ItemRow['status'][], wrongState: string): Promise<ItemRow> {
  const item = await repo.findItem(db, id)
  if (!item) throw itemNotFound()
  if (item.version !== version) throw itemChanged()
  if (!from.includes(item.status)) throw itemInWrongState(wrongState)
  return item
}

/** Puts a category's drafts and active items in the given order; the list must be exactly them. */
export async function reorderItems(db: Db, actor: Actor, input: ReorderItemsInput): Promise<void> {
  const listed = await repo.listedItems(db, input.categoryId)
  const known = new Map(listed.map(i => [i.id, i.version]))
  if (listed.length !== input.items.length || input.items.some(i => known.get(i.id) !== i.version)) throw itemsChanged()
  const now = new Date()
  try {
    await db.batch([
      repo.requireListedCount(db, input.categoryId, input.items.length),
      ...input.items.flatMap((item, i) => [repo.positionItemStatement(db, input.categoryId, item.id, item.version, i + 1, now), requireOneChange(db)]),
      audit(db, actor, 'reorder', input.categoryId, { categoryId: input.categoryId, order: input.items.map(i => i.id) }),
    ] as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isStaleWrite(error)) throw itemsChanged()
    throw error
  }
}
