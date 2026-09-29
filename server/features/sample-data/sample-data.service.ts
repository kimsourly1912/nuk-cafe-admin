import type { MenuCategory } from '#shared/contracts/menu-categories'
import type { MenuItem, MenuItemSummary } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import type { LoadSampleBranchInput, LoadSampleMenuInput, SampleBranchResult, SampleDataState, SampleMenuSize, SampleMenuStage } from '#shared/contracts/sample-data'
import type { Db, Statement } from '../../utils/batch'
import { activeTableLabels, createTable, getBranchSettings, listBranchOptions, updateBranchSettings } from '../branches'
import type { QrConfig } from '../branches'
import type { Actor } from '../identity'
import { countUploads, deleteUploads } from '../media'
import type { ObjectStore } from '../media'
import {
  archiveItem,
  countMenuData,
  createAvailabilityRule,
  createCategory,
  createItem,
  createModifierGroup,
  createOptionSet,
  deleteAllMenuStatements,
  getItem,
  listAvailabilityRules,
  listCategories,
  listItems,
  listModifierGroups,
  listOptionSets,
  publishItem,
  setSoldOut,
} from '../menu'
import type { MenuDataCounts } from '../menu'
import { auditStatement } from '../platform'
import type { CategoryKey, SampleItem } from './sample-data.catalog'
import {
  combinations,
  GRID_SETS,
  itemsForSize,
  SAMPLE_CATEGORIES,
  SAMPLE_HOURS,
  SAMPLE_MODIFIER_GROUPS,
  SAMPLE_OPTION_SETS,
  SAMPLE_RULES,
  SAMPLE_TABLES,
  versionPrice,
} from './sample-data.catalog'
import { menuAlreadyLoaded, menuNotEmpty, otherSizeRunning, sampleDataBusy } from './sample-data.errors'
import * as repo from './sample-data.repository'

/**
 * Sample data (D94): realistic test data, loaded through the menu's and branches' own services, so
 * it obeys every rule a hand-made record does. Everything happens in small steps the page repeats:
 * a Worker request may run only so many queries (50 on Cloudflare's free plan), so a step creates at
 * most `RECORDS_PER_STEP` records. Records are found again by name, so a step that failed halfway
 * is simply run again ("Try again" continues where it stopped).
 *
 * Only reachable where the environment turns it on (routes check `sampleData.enabled`, D94).
 */

/** Records created per menu step: each create runs several queries of its own. */
const RECORDS_PER_STEP = 2
const TABLES_PER_STEP = 4
const PHOTOS_PER_STEP = 20
/** A step's hold on the load; a step that died (a crashed request) frees it when this passes. */
const LOCK_MS = 60_000

const lower = (text: string) => text.toLowerCase()

// --- What exists ---

interface MenuSnapshot {
  /** Active categories by "<parent name>/<name>" (lower case; "" parent for top level). */
  categories: Map<string, MenuCategory>
  optionSets: Map<string, OptionSet>
  modifierGroups: Map<string, ModifierGroup>
  rules: Map<string, AvailabilityRule>
  /** Every item by name, archived ones too. */
  items: Map<string, MenuItemSummary>
}

async function allItems(db: Db): Promise<MenuItemSummary[]> {
  const items: MenuItemSummary[] = []
  for (let page = 1; ; page++) {
    const result = await listItems(db, { page, pageSize: 100, status: 'all' })
    items.push(...result.items)
    if (page >= result.totalPages) return items
  }
}

async function snapshot(db: Db): Promise<MenuSnapshot> {
  const [categories, optionSets, modifierGroups, rules, items] = await Promise.all([
    listCategories(db, { status: 'active' }),
    listOptionSets(db, { status: 'active' }),
    listModifierGroups(db, { status: 'active' }),
    listAvailabilityRules(db, { status: 'active' }),
    allItems(db),
  ])
  const names = new Map(categories.map(c => [c.id, c.name]))
  return {
    categories: new Map(categories.map(c => [`${lower(c.parentId ? names.get(c.parentId) ?? '' : '')}/${lower(c.name)}`, c])),
    optionSets: new Map(optionSets.map(s => [lower(s.name), s])),
    modifierGroups: new Map(modifierGroups.map(g => [lower(g.name), g])),
    rules: new Map(rules.map(r => [lower(r.name), r])),
    items: new Map(items.map(i => [lower(i.name), i])),
  }
}

const categoryName = (key: CategoryKey) => SAMPLE_CATEGORIES.find(c => c.key === key)!.name
function findCategory(menu: MenuSnapshot, key: CategoryKey): MenuCategory | undefined {
  const entry = SAMPLE_CATEGORIES.find(c => c.key === key)!
  return menu.categories.get(`${lower(entry.parent ? categoryName(entry.parent) : '')}/${lower(entry.name)}`)
}

function stagesOf(menu: MenuSnapshot, size: SampleMenuSize): SampleMenuStage[] {
  const count = <T>(list: T[], has: (entry: T) => boolean) => list.filter(has).length
  const items = itemsForSize(size)
  return [
    { key: 'categories', label: 'Categories', done: count(SAMPLE_CATEGORIES, c => !!findCategory(menu, c.key)), total: SAMPLE_CATEGORIES.length },
    { key: 'optionSets', label: 'Option sets', done: count(SAMPLE_OPTION_SETS, s => menu.optionSets.has(lower(s.name))), total: SAMPLE_OPTION_SETS.length },
    { key: 'modifierGroups', label: 'Add-on groups', done: count(SAMPLE_MODIFIER_GROUPS, g => menu.modifierGroups.has(lower(g.name))), total: SAMPLE_MODIFIER_GROUPS.length },
    { key: 'availabilityRules', label: 'Availability rules', done: count(SAMPLE_RULES, r => menu.rules.has(lower(r.name))), total: SAMPLE_RULES.length },
    { key: 'items', label: 'Menu items', done: count(items, i => menu.items.has(lower(i.name))), total: items.length },
  ]
}

const isEmpty = (counts: MenuDataCounts) =>
  !counts.categories && !counts.optionSets && !counts.modifierGroups && !counts.availabilityRules
  && !counts.items.draft && !counts.items.active && !counts.items.archived

// --- State ---

export async function getSampleDataState(db: Db, environment: string): Promise<SampleDataState> {
  const [counts, photos, run, branches] = await Promise.all([countMenuData(db), countUploads(db), repo.findRun(db), listBranchOptions(db)])
  const summaries = await Promise.all(branches.map(async (branch) => {
    const [settings, labels] = await Promise.all([getBranchSettings(db, branch.id), activeTableLabels(db, branch.id)])
    return { id: branch.id, name: branch.name, hoursSet: settings.hours.length > 0, tables: labels.length }
  }))
  return {
    environment,
    menu: {
      counts: { ...counts, photos },
      run: run ? { size: run.size, finished: !!run.finishedAt, stages: stagesOf(await snapshot(db), run.size) } : null,
    },
    branches: summaries,
  }
}

// --- The sample menu, a step at a time ---

/**
 * One step of the sample menu: starts the load on an empty menu, or continues an unfinished one of
 * the same size, and creates the next few records in order (categories, option sets, add-on groups,
 * availability rules, then items). Two steps never run at once (a lock on the load). Returns the
 * state; `run.finished` says when to stop.
 */
export async function loadSampleMenuStep(db: Db, actor: Actor, input: LoadSampleMenuInput, environment: string, now = new Date()): Promise<SampleDataState> {
  let run = await repo.findRun(db)
  if (!run) {
    if (!isEmpty(await countMenuData(db))) throw menuNotEmpty()
    await repo.insertRun(db, { size: input.size, startedBy: actor.userId, now })
    run = await repo.findRun(db)
    if (!run) throw sampleDataBusy()
  }
  if (run.finishedAt) throw menuAlreadyLoaded()
  if (run.size !== input.size) throw otherSizeRunning(run.size)
  if (!await repo.claimRun(db, now, new Date(now.getTime() + LOCK_MS))) throw sampleDataBusy()

  let finished = false
  try {
    finished = await nextMenuStep(db, actor, run.size)
  }
  finally {
    await repo.releaseRun(db, finished ? new Date() : undefined)
  }
  return getSampleDataState(db, environment)
}

/** Creates the next records; `true` once nothing is left to create. */
async function nextMenuStep(db: Db, actor: Actor, size: SampleMenuSize): Promise<boolean> {
  const menu = await snapshot(db)
  let budget = RECORDS_PER_STEP

  for (const entry of SAMPLE_CATEGORIES) {
    if (findCategory(menu, entry.key)) continue
    if (!budget--) return false
    const parent = entry.parent ? findCategory(menu, entry.parent) : undefined
    const created = await createCategory(db, actor, { name: entry.name, description: entry.description, parentId: parent?.id ?? null, availabilityRuleIds: [] })
    menu.categories.set(`${lower(parent?.name ?? '')}/${lower(entry.name)}`, created)
  }
  for (const entry of SAMPLE_OPTION_SETS) {
    if (menu.optionSets.has(lower(entry.name))) continue
    if (!budget--) return false
    menu.optionSets.set(lower(entry.name), await createOptionSet(db, actor, { name: entry.name, values: entry.values }))
  }
  for (const entry of SAMPLE_MODIFIER_GROUPS) {
    if (menu.modifierGroups.has(lower(entry.name))) continue
    if (!budget--) return false
    const modifiers = entry.modifiers.map(m => ({ ...m, isDefault: false }))
    menu.modifierGroups.set(lower(entry.name), await createModifierGroup(db, actor, { name: entry.name, minSelect: entry.minSelect, maxSelect: entry.maxSelect, modifiers }))
  }
  for (const entry of SAMPLE_RULES) {
    if (menu.rules.has(lower(entry.name))) continue
    if (!budget--) return false
    menu.rules.set(lower(entry.name), await createAvailabilityRule(db, actor, { name: entry.name, windows: entry.windows }))
  }
  for (const item of itemsForSize(size)) {
    const existing = menu.items.get(lower(item.name))
    // An item created by a step that failed before it was published or archived is finished here.
    if (existing && !needsSettling(existing, item)) continue
    if (!budget--) return false
    const created = existing ? await getItem(db, existing.id) : await createSampleItem(db, actor, menu, item)
    await settleItem(db, actor, created, item)
  }
  return true
}

const needsSettling = (existing: MenuItemSummary, item: SampleItem) => existing.status === 'draft' && item.state !== 'draft'

async function createSampleItem(db: Db, actor: Actor, menu: MenuSnapshot, item: SampleItem): Promise<MenuItem> {
  const sets = GRID_SETS[item.grid].map(key => menu.optionSets.get(lower(SAMPLE_OPTION_SETS.find(s => s.key === key)!.name))!)
  const grid = combinations(sets.map(set => set.values.filter(value => value.status === 'active')))
  return createItem(db, actor, {
    categoryId: findCategory(menu, item.category)!.id,
    name: item.name,
    description: item.description,
    imageId: null,
    optionSetIds: sets.map(set => set.id),
    variations: grid.map(values => ({ valueIds: values.map(v => v.id), priceMinor: versionPrice(item.priceMinor, values.map(v => v.name)), status: 'active' as const })),
    modifierGroups: item.groups.map(key => ({ groupId: menu.modifierGroups.get(lower(SAMPLE_MODIFIER_GROUPS.find(g => g.key === key)!.name))!.id, rules: null, prices: [] })),
    availabilityRuleIds: item.rules.map(key => menu.rules.get(lower(SAMPLE_RULES.find(r => r.key === key)!.name))!.id),
  })
}

/** A new (draft) item to its sample state: published, archived, or published and sold out at every branch. */
async function settleItem(db: Db, actor: Actor, created: MenuItem, item: SampleItem): Promise<void> {
  if (created.status !== 'draft' || item.state === 'draft') return
  if (item.state === 'archived') {
    await archiveItem(db, actor, created.id, { version: created.version })
    return
  }
  const published = await publishItem(db, actor, created.id, { version: created.version })
  if (item.state !== 'soldOut') return
  const variationIds = published.variations.map(v => v.id)
  for (const branch of await listBranchOptions(db)) {
    await setSoldOut(db, { ...actor, branchId: branch.id }, { variationIds, soldOut: true })
  }
}

// --- Hours and tables ---

/**
 * Sample hours (replacing the branch's) on the first call, then up to `TABLES_PER_STEP` of the sample
 * tables whose label isn't already an active table's. Repeat with `tablesOnly` until
 * `remainingTables` is 0.
 */
export async function loadSampleBranch(db: Db, actor: Actor, input: LoadSampleBranchInput, qr: QrConfig, environment: string): Promise<SampleBranchResult> {
  if (!input.tablesOnly) {
    const settings = await getBranchSettings(db, input.branchId)
    await updateBranchSettings(db, actor, input.branchId, { version: settings.version, hours: SAMPLE_HOURS })
  }
  const taken = new Set((await activeTableLabels(db, input.branchId)).map(lower))
  const missing = SAMPLE_TABLES.filter(table => !taken.has(lower(table.label)))
  for (const table of missing.slice(0, TABLES_PER_STEP)) {
    await createTable(db, actor, input.branchId, table, qr)
  }
  return { state: await getSampleDataState(db, environment), remainingTables: Math.max(0, missing.length - TABLES_PER_STEP) }
}

// --- Reset ---

/**
 * Deletes every menu record (archived ones too) and the load's memory in one batch, audited, then up
 * to `PHOTOS_PER_STEP` uploads. Call again while `menu.counts.photos` isn't 0. Refused while a step
 * is loading.
 */
export async function resetSampleMenu(db: Db, actor: Actor, store: ObjectStore, environment: string, now = new Date()): Promise<SampleDataState> {
  const run = await repo.findRun(db)
  if (run?.lockedUntil && run.lockedUntil > now) throw sampleDataBusy()
  const counts = await countMenuData(db)
  if (!isEmpty(counts) || run) {
    const statements: Statement[] = [
      ...deleteAllMenuStatements(db),
      repo.deleteRunStatement(db),
      auditStatement(db, actor, { action: 'sample-data.reset', targetType: 'menu', targetId: 'menu', metadata: { ...counts } }),
    ]
    await db.batch(statements as [Statement, ...Statement[]])
  }
  await deleteUploads(db, store, PHOTOS_PER_STEP)
  return getSampleDataState(db, environment)
}
