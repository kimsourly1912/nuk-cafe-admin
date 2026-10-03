import type { AvailabilityRuleRef } from '#shared/contracts/menu-availability'
import type { CategoryListQuery, CategoryStatusChangeInput, CreateCategoryInput, MenuCategory, ReorderCategoriesInput, RestoreCategoryInput, UpdateCategoryInput } from '#shared/contracts/menu-categories'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import * as availabilityRepo from './availability.repository'
import { planRuleLinks, ruleLinksFailure } from './availability.service'
import { categoryArchived, categoryChanged, categoryNameTaken, categoryNotArchived, categoryNotFound, parentArchived, parentHasItems, parentNotAvailable, siblingsChanged, tooDeep } from './categories.errors'
import * as repo from './categories.repository'
import type { CategoryRow } from './categories.repository'

/**
 * Menu categories (docs/server/data-model.md → Menu, D44, D55). Every write is one batch with its
 * guards and an audit row; a guard failure means someone else changed something in between.
 */

interface Counts {
  children: Map<string, number>
  items: Map<string, number>
}

function toCategory(row: CategoryRow, counts: Counts, rules: Map<string, AvailabilityRuleRef[]>): MenuCategory {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    status: row.status,
    childCount: counts.children.get(row.id) ?? 0,
    itemCount: counts.items.get(row.id) ?? 0,
    availabilityRules: rules.get(row.id) ?? [],
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadCategory(db: Db, tenantId: string, id: string): Promise<MenuCategory> {
  const row = await repo.findCategory(db, tenantId, id)
  if (!row) throw categoryNotFound()
  const [children, items, rules] = await Promise.all([repo.countChildren(db, id, 'active'), repo.countListedItems(db, id), availabilityRepo.categoryRules(db, [id])])
  return toCategory(row, { children: new Map([[id, children]]), items: new Map([[id, items]]) }, rules)
}

const audit = (db: Db, actor: Actor, action: string, categoryId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.category.${action}`, targetType: 'menu_category', targetId: categoryId, metadata })

/**
 * Runs a category write. A name used by an active sibling (the unique indexes) is 409
 * `CATEGORY_NAME_TAKEN`; a failed guard is `onStale()`.
 */
async function runCategoryBatch(db: Db, statements: Statement[], name: string, onStale: () => Error | Promise<Error>) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw categoryNameTaken(name)
    if (isStaleWrite(error)) throw await onStale()
    throw error
  }
}

/** Checks a future parent: active and top-level. */
async function ensureParent(db: Db, tenantId: string, parentId: string) {
  const parent = await repo.findCategory(db, tenantId, parentId)
  if (!parent || parent.status !== 'active') throw parentNotAvailable()
  if (parent.parentId !== null) throw tooDeep('parent-is-sub')
  if (await repo.countListedItems(db, parentId) > 0) throw parentHasItems()
}

/**
 * The tree, in order: each top-level category followed by its sub-categories. `status` filters
 * (default `active`); with `all`, archived sub-categories stay under their parent.
 */
export async function listCategories(db: Db, tenantId: string, query: CategoryListQuery): Promise<MenuCategory[]> {
  const [rows, children, items] = await Promise.all([repo.listCategories(db, tenantId, query.status), repo.activeChildCounts(db, tenantId), repo.listedItemCounts(db, tenantId)])
  const byParent = new Map<string | null, CategoryRow[]>()
  for (const row of rows) byParent.set(row.parentId, [...(byParent.get(row.parentId) ?? []), row])
  const ids = new Set(rows.map(r => r.id))
  // Children whose parent isn't in the list (an archived sub-category of an active parent, when
  // listing archived ones) are listed at the end rather than hidden.
  const orphans = rows.filter(r => r.parentId !== null && !ids.has(r.parentId))
  const ordered = [
    ...(byParent.get(null) ?? []).flatMap(top => [top, ...(byParent.get(top.id) ?? [])]),
    ...orphans,
  ]
  const rules = await availabilityRepo.categoryRules(db, ordered.map(row => row.id))
  return ordered.map(row => toCategory(row, { children, items }, rules))
}

export async function getCategory(db: Db, tenantId: string, id: string): Promise<MenuCategory> {
  return loadCategory(db, tenantId, id)
}

/** A new category at the end of its parent's (or the top level's) list. */
export async function createCategory(db: Db, actor: Actor, input: CreateCategoryInput): Promise<MenuCategory> {
  const { tenantId } = actor
  if (input.parentId) await ensureParent(db, tenantId, input.parentId)
  const addedRules = await planRuleLinks(db, tenantId, input.availabilityRuleIds)
  const id = newId()
  const now = new Date()
  const statements: Statement[] = [
    ...(input.parentId ? [repo.requireActiveTopLevel(db, tenantId, input.parentId), repo.requireNoItems(db, input.parentId)] : []),
    ...availabilityRepo.requireActiveRules(db, tenantId, addedRules),
    repo.insertCategoryStatement(db, { id, tenantId, parentId: input.parentId, name: input.name, description: input.description, sortOrder: await repo.nextSortOrder(db, tenantId, input.parentId), now }),
    ...availabilityRepo.replaceCategoryRulesStatements(db, tenantId, id, input.availabilityRuleIds),
    audit(db, actor, 'create', id, { parentId: input.parentId, availabilityRules: input.availabilityRuleIds }),
  ]
  // The parent was archived, became a sub-category or got items, or a chosen rule was archived,
  // between the check and the write.
  await runCategoryBatch(db, statements, input.name, async () => {
    if (input.parentId) await ensureParent(db, tenantId, input.parentId)
    return await ruleLinksFailure(db, tenantId, input.availabilityRuleIds, addedRules) ?? parentNotAvailable()
  })
  return loadCategory(db, tenantId, id)
}

/**
 * Renames, re-describes or moves a category. Moving puts it at the end of its new siblings; a
 * category with sub-categories can't move under another one (two levels).
 */
export async function updateCategory(db: Db, actor: Actor, id: string, input: UpdateCategoryInput): Promise<MenuCategory> {
  const { tenantId } = actor
  const current = await repo.findCategory(db, tenantId, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status === 'archived') throw categoryArchived()

  const moving = input.parentId !== undefined && input.parentId !== current.parentId
  const guards: Statement[] = []
  let sortOrder: number | undefined
  if (moving) {
    if (input.parentId === id) throw tooDeep('parent-is-sub')
    if (input.parentId) {
      await ensureParent(db, tenantId, input.parentId)
      if (await repo.countChildren(db, id) > 0) throw tooDeep('has-children')
      guards.push(repo.requireActiveTopLevel(db, tenantId, input.parentId), repo.requireNoItems(db, input.parentId), repo.requireNoChildren(db, id))
    }
    sortOrder = await repo.nextSortOrder(db, tenantId, input.parentId ?? null)
  }
  const ruleIds = input.availabilityRuleIds
  const addedRules = ruleIds ? await planRuleLinks(db, tenantId, ruleIds, ((await availabilityRepo.categoryRules(db, [id])).get(id) ?? []).map(r => r.id)) : []

  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(moving && { parentId: input.parentId ?? null, sortOrder }),
  }
  const statements: Statement[] = [
    ...guards,
    ...availabilityRepo.requireActiveRules(db, tenantId, addedRules),
    repo.updateCategoryStatement(db, tenantId, id, input.version, changes, new Date()),
    requireOneChange(db),
    ...(ruleIds ? availabilityRepo.replaceCategoryRulesStatements(db, tenantId, id, ruleIds) : []),
    audit(db, actor, moving ? 'move' : 'update', id, { fields: [...Object.keys(changes).filter(k => k !== 'sortOrder'), ...(ruleIds ? ['availabilityRuleIds'] : [])], ...(moving && { from: current.parentId, to: input.parentId ?? null }) }),
  ]
  await runCategoryBatch(db, statements, input.name ?? current.name, async () => {
    if (moving && input.parentId) {
      await ensureParent(db, tenantId, input.parentId)
      if (await repo.countChildren(db, id) > 0) return tooDeep('has-children')
    }
    return (ruleIds && await ruleLinksFailure(db, tenantId, ruleIds, addedRules)) || categoryChanged()
  })
  return loadCategory(db, tenantId, id)
}

/** Archives a category and its active sub-categories, together. */
export async function archiveCategory(db: Db, actor: Actor, id: string, input: CategoryStatusChangeInput): Promise<MenuCategory> {
  const { tenantId } = actor
  const current = await repo.findCategory(db, tenantId, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status === 'archived') throw categoryArchived()

  const now = new Date()
  const children = await repo.countChildren(db, id, 'active')
  const statements: Statement[] = [
    repo.updateCategoryStatement(db, tenantId, id, input.version, { status: 'archived' }, now),
    requireOneChange(db),
    ...(current.parentId === null ? [repo.archiveChildrenStatement(db, id, now)] : []),
    audit(db, actor, 'archive', id, { subCategories: children }),
  ]
  await runCategoryBatch(db, statements, current.name, () => categoryChanged())
  return loadCategory(db, tenantId, id)
}

/**
 * Restores one archived category, at the end of its siblings. Its sub-categories stay archived
 * unless `withSubcategories` (a top-level category's archived sub-categories come back in the same
 * write, keeping their order); a sub-category's parent must be active first.
 */
export async function restoreCategory(db: Db, actor: Actor, id: string, input: RestoreCategoryInput): Promise<MenuCategory> {
  const { tenantId } = actor
  const current = await repo.findCategory(db, tenantId, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status !== 'archived') throw categoryNotArchived()
  if (current.parentId) {
    const parent = await repo.findCategory(db, tenantId, current.parentId)
    if (parent?.status !== 'active') throw parentArchived()
  }

  const now = new Date()
  const withSubs = input.withSubcategories && current.parentId === null
  const subs = withSubs ? await repo.countChildren(db, id, 'archived') : 0
  const statements: Statement[] = [
    ...(current.parentId ? [repo.requireActiveTopLevel(db, tenantId, current.parentId)] : []),
    repo.updateCategoryStatement(db, tenantId, id, input.version, { status: 'active', sortOrder: await repo.nextSortOrder(db, tenantId, current.parentId) }, now),
    requireOneChange(db),
    ...(withSubs ? [repo.restoreChildrenStatement(db, id, now)] : []),
    audit(db, actor, 'restore', id, withSubs ? { subCategories: subs } : {}),
  ]
  await runCategoryBatch(db, statements, current.name, () => current.parentId ? parentArchived() : categoryChanged())
  return loadCategory(db, tenantId, id)
}

/**
 * Puts one parent's active children in the given order. The list must name every one of them with
 * the version read: a sibling added, moved or edited meanwhile makes it 409, and nothing changes.
 */
export async function reorderCategories(db: Db, actor: Actor, input: ReorderCategoriesInput): Promise<MenuCategory[]> {
  const { tenantId } = actor
  const siblings = await repo.activeSiblings(db, tenantId, input.parentId)
  const known = new Map(siblings.map(s => [s.id, s.version]))
  if (siblings.length !== input.items.length || input.items.some(item => known.get(item.id) !== item.version)) throw siblingsChanged()

  const now = new Date()
  const statements: Statement[] = [
    repo.requireActiveSiblingCount(db, tenantId, input.parentId, input.items.length),
    ...input.items.flatMap((item, index) => [repo.positionStatement(db, tenantId, input.parentId, item.id, item.version, index + 1, now), requireOneChange(db)]),
    audit(db, actor, 'reorder', input.parentId ?? 'top-level', { parentId: input.parentId, order: input.items.map(i => i.id) }),
  ]
  await runCategoryBatch(db, statements, '', () => siblingsChanged())
  const rows = await repo.findCategoriesByIds(db, tenantId, input.items.map(i => i.id))
  const [children, items, rules] = await Promise.all([repo.activeChildCounts(db, tenantId), repo.listedItemCounts(db, tenantId), availabilityRepo.categoryRules(db, rows.map(row => row.id))])
  return rows.sort((a, b) => a.sortOrder - b.sortOrder).map(row => toCategory(row, { children, items }, rules))
}
