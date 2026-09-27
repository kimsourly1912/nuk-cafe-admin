import type { CategoryListQuery, CategoryStatusChangeInput, CreateCategoryInput, MenuCategory, ReorderCategoriesInput, UpdateCategoryInput } from '#shared/contracts/menu-categories'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import type { Actor } from '../identity'
import { auditStatement } from '../platform'
import { categoryArchived, categoryChanged, categoryNameTaken, categoryNotArchived, categoryNotFound, parentArchived, parentNotAvailable, siblingsChanged, tooDeep } from './categories.errors'
import * as repo from './categories.repository'
import type { CategoryRow } from './categories.repository'

/**
 * Menu categories (docs/server/data-model.md → Menu, D44, D55). Every write is one batch with its
 * guards and an audit row; a guard failure means someone else changed something in between.
 */

function toCategory(row: CategoryRow, childCounts: Map<string, number>): MenuCategory {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    status: row.status,
    childCount: childCounts.get(row.id) ?? 0,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadCategory(db: Db, id: string): Promise<MenuCategory> {
  const row = await repo.findCategory(db, id)
  if (!row) throw categoryNotFound()
  return toCategory(row, new Map([[id, await repo.countChildren(db, id, 'active')]]))
}

const audit = (db: Db, actor: Actor, action: string, categoryId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.category.${action}`, targetType: 'menu_category', targetId: categoryId, metadata })

/**
 * Runs a category write. A name used by an active sibling (the unique indexes) is 409
 * `CATEGORY_NAME_TAKEN`; a failed guard is `onStale()`.
 */
async function runCategoryBatch(db: Db, statements: Statement[], name: string, onStale: () => Error) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw categoryNameTaken(name)
    if (isStaleWrite(error)) throw onStale()
    throw error
  }
}

/** Checks a future parent: active and top-level. */
async function ensureParent(db: Db, parentId: string) {
  const parent = await repo.findCategory(db, parentId)
  if (!parent || parent.status !== 'active') throw parentNotAvailable()
  if (parent.parentId !== null) throw tooDeep('parent-is-sub')
}

/**
 * The tree, in order: each top-level category followed by its sub-categories. `status` filters
 * (default `active`); with `all`, archived sub-categories stay under their parent.
 */
export async function listCategories(db: Db, query: CategoryListQuery): Promise<MenuCategory[]> {
  const [rows, childCounts] = await Promise.all([repo.listCategories(db, query.status), repo.activeChildCounts(db)])
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
  return ordered.map(row => toCategory(row, childCounts))
}

export async function getCategory(db: Db, id: string): Promise<MenuCategory> {
  return loadCategory(db, id)
}

/** A new category at the end of its parent's (or the top level's) list. */
export async function createCategory(db: Db, actor: Actor, input: CreateCategoryInput): Promise<MenuCategory> {
  if (input.parentId) await ensureParent(db, input.parentId)
  const id = newId()
  const now = new Date()
  const statements: Statement[] = [
    ...(input.parentId ? [repo.requireActiveTopLevel(db, input.parentId)] : []),
    repo.insertCategoryStatement(db, { id, parentId: input.parentId, name: input.name, description: input.description, sortOrder: await repo.nextSortOrder(db, input.parentId), now }),
    audit(db, actor, 'create', id, { parentId: input.parentId }),
  ]
  // The parent was archived or became a sub-category between the check and the write.
  await runCategoryBatch(db, statements, input.name, () => parentNotAvailable())
  return loadCategory(db, id)
}

/**
 * Renames, re-describes or moves a category. Moving puts it at the end of its new siblings; a
 * category with sub-categories can't move under another one (two levels).
 */
export async function updateCategory(db: Db, actor: Actor, id: string, input: UpdateCategoryInput): Promise<MenuCategory> {
  const current = await repo.findCategory(db, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status === 'archived') throw categoryArchived()

  const moving = input.parentId !== undefined && input.parentId !== current.parentId
  const guards: Statement[] = []
  let sortOrder: number | undefined
  if (moving) {
    if (input.parentId === id) throw tooDeep('parent-is-sub')
    if (input.parentId) {
      await ensureParent(db, input.parentId)
      if (await repo.countChildren(db, id) > 0) throw tooDeep('has-children')
      guards.push(repo.requireActiveTopLevel(db, input.parentId), repo.requireNoChildren(db, id))
    }
    sortOrder = await repo.nextSortOrder(db, input.parentId ?? null)
  }

  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(moving && { parentId: input.parentId ?? null, sortOrder }),
  }
  const statements: Statement[] = [
    ...guards,
    repo.updateCategoryStatement(db, id, input.version, changes, new Date()),
    requireOneChange(db),
    audit(db, actor, moving ? 'move' : 'update', id, { fields: Object.keys(changes).filter(k => k !== 'sortOrder'), ...(moving && { from: current.parentId, to: input.parentId ?? null }) }),
  ]
  await runCategoryBatch(db, statements, input.name ?? current.name, () => categoryChanged())
  return loadCategory(db, id)
}

/** Archives a category and its active sub-categories, together. */
export async function archiveCategory(db: Db, actor: Actor, id: string, input: CategoryStatusChangeInput): Promise<MenuCategory> {
  const current = await repo.findCategory(db, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status === 'archived') throw categoryArchived()

  const now = new Date()
  const children = await repo.countChildren(db, id, 'active')
  const statements: Statement[] = [
    repo.updateCategoryStatement(db, id, input.version, { status: 'archived' }, now),
    requireOneChange(db),
    ...(current.parentId === null ? [repo.archiveChildrenStatement(db, id, now)] : []),
    audit(db, actor, 'archive', id, { subCategories: children }),
  ]
  await runCategoryBatch(db, statements, current.name, () => categoryChanged())
  return loadCategory(db, id)
}

/**
 * Restores one archived category, at the end of its siblings. Its sub-categories stay archived
 * (restore the ones still wanted); a sub-category's parent must be active first.
 */
export async function restoreCategory(db: Db, actor: Actor, id: string, input: CategoryStatusChangeInput): Promise<MenuCategory> {
  const current = await repo.findCategory(db, id)
  if (!current) throw categoryNotFound()
  if (current.version !== input.version) throw categoryChanged()
  if (current.status !== 'archived') throw categoryNotArchived()
  if (current.parentId) {
    const parent = await repo.findCategory(db, current.parentId)
    if (parent?.status !== 'active') throw parentArchived()
  }

  const statements: Statement[] = [
    ...(current.parentId ? [repo.requireActiveTopLevel(db, current.parentId)] : []),
    repo.updateCategoryStatement(db, id, input.version, { status: 'active', sortOrder: await repo.nextSortOrder(db, current.parentId) }, new Date()),
    requireOneChange(db),
    audit(db, actor, 'restore', id, {}),
  ]
  await runCategoryBatch(db, statements, current.name, () => current.parentId ? parentArchived() : categoryChanged())
  return loadCategory(db, id)
}

/**
 * Puts one parent's active children in the given order. The list must name every one of them with
 * the version read: a sibling added, moved or edited meanwhile makes it 409, and nothing changes.
 */
export async function reorderCategories(db: Db, actor: Actor, input: ReorderCategoriesInput): Promise<MenuCategory[]> {
  const siblings = await repo.activeSiblings(db, input.parentId)
  const known = new Map(siblings.map(s => [s.id, s.version]))
  if (siblings.length !== input.items.length || input.items.some(item => known.get(item.id) !== item.version)) throw siblingsChanged()

  const now = new Date()
  const statements: Statement[] = [
    repo.requireActiveSiblingCount(db, input.parentId, input.items.length),
    ...input.items.flatMap((item, index) => [repo.positionStatement(db, input.parentId, item.id, item.version, index + 1, now), requireOneChange(db)]),
    audit(db, actor, 'reorder', input.parentId ?? 'top-level', { parentId: input.parentId, order: input.items.map(i => i.id) }),
  ]
  await runCategoryBatch(db, statements, '', () => siblingsChanged())
  const rows = await repo.findCategoriesByIds(db, input.items.map(i => i.id))
  const childCounts = await repo.activeChildCounts(db)
  return rows.sort((a, b) => a.sortOrder - b.sortOrder).map(row => toCategory(row, childCounts))
}
