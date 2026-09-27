import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import type { Category, CategoryListQuery, CreateCategoryBody, ReorderCategoriesBody, UpdateCategoryBody } from '#shared/contracts/menu'
import { auditEvents, menuCategories, menuProducts } from '../../db/tables'
import type { Db } from '../../utils/batch'
import { isForeignKeyError, isStaleWrite, requireCount, requireOneChange } from '../../utils/batch'
import { toIso } from '../../utils/time'
import { apiError, notFound, versionConflict } from '../../utils/errors'
import type { Actor } from '../identity/service'

type CategoryRow = InferSelectModel<typeof menuCategories>

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    status: row.status,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

const parentIs = (parentId: string | null) => (parentId === null ? isNull(menuCategories.parentId) : eq(menuCategories.parentId, parentId))

const audit = (db: Db, actor: Actor, action: string, targetId: string | null, metadata?: Record<string, unknown>) =>
  db.insert(auditEvents).values({ actorId: actor.userId, action, targetType: 'menu_category', targetId, metadata })

/** Every category (the list is small), mains and subs, in their sort order. */
export async function listCategories(db: Db, query: { level?: 'main' | 'sub' } = {}): Promise<Category[]> {
  const rows = await db.select().from(menuCategories)
    .where(query.level === 'main' ? isNull(menuCategories.parentId) : query.level === 'sub' ? sql`${menuCategories.parentId} is not null` : undefined)
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
  return rows.map(toCategory)
}
export type { CategoryListQuery }

async function findRow(db: Db, id: string) {
  const [row] = await db.select().from(menuCategories).where(eq(menuCategories.id, id))
  return row
}

export async function getCategory(db: Db, id: string): Promise<Category> {
  const row = await findRow(db, id)
  if (!row) throw notFound('The category')
  return toCategory(row)
}

/**
 * A parent must exist and be a main category: two levels only (D37). `self` is the category
 * being edited, which can't become its own parent.
 */
async function checkParent(db: Db, parentId: string, self?: string) {
  if (parentId === self) throw apiError(400, 'CATEGORY_DEPTH', 'A category can\'t be its own parent.', { fieldErrors: { parentId: ['A category can\'t be its own parent'] } })
  const parent = await findRow(db, parentId)
  if (!parent) throw apiError(400, 'REFERENCE_NOT_FOUND', 'The parent category no longer exists.', { fieldErrors: { parentId: ['Not found'] } })
  if (parent.parentId !== null) {
    throw apiError(400, 'CATEGORY_DEPTH', 'A sub-category can\'t have sub-categories.', { fieldErrors: { parentId: ['Choose a main category'] } })
  }
}

/** Next position among the siblings: new categories go last. */
async function nextSortOrder(db: Db, parentId: string | null) {
  const [row] = await db.select({ max: sql<number | null>`max(${menuCategories.sortOrder})` }).from(menuCategories).where(parentIs(parentId))
  return (row?.max ?? 0) + 1
}

export async function createCategory(db: Db, actor: Actor, input: Required<CreateCategoryBody>): Promise<Category> {
  if (input.parentId) await checkParent(db, input.parentId)
  const id = crypto.randomUUID()
  const sortOrder = await nextSortOrder(db, input.parentId)
  const [[row]] = await db.batch([
    db.insert(menuCategories).values({ id, name: input.name, parentId: input.parentId, status: input.status, sortOrder }).returning(),
    audit(db, actor, 'menu_category.create', id, { name: input.name }),
  ])
  return toCategory(row!)
}

/**
 * Partial update, only if `version` is still the stored one (409 otherwise). Moving a category
 * under another one is allowed only while it has no sub-categories (two levels). A moved
 * category goes last among its new siblings.
 */
export async function updateCategory(db: Db, actor: Actor, id: string, input: UpdateCategoryBody): Promise<Category> {
  const current = await findRow(db, id)
  if (!current) throw notFound('The category')
  if (current.version !== input.version) throw versionConflict('This category')

  const moving = input.parentId !== undefined && input.parentId !== current.parentId
  if (moving && input.parentId) {
    await checkParent(db, input.parentId, id)
    const [children] = await db.select({ n: count() }).from(menuCategories).where(eq(menuCategories.parentId, id))
    if (children!.n > 0) {
      throw apiError(409, 'CATEGORY_DEPTH', 'A category with sub-categories can\'t become a sub-category.', { fieldErrors: { parentId: ['Move its sub-categories first'] } })
    }
  }

  const changes = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(moving ? { parentId: input.parentId ?? null, sortOrder: await nextSortOrder(db, input.parentId ?? null) } : {}),
  }
  try {
    await db.batch([
      db.update(menuCategories)
        .set({ ...changes, version: sql`${menuCategories.version} + 1` })
        .where(and(eq(menuCategories.id, id), eq(menuCategories.version, input.version))),
      // Changed by someone else since the read: nothing is written, not even the audit event.
      requireOneChange(db),
      audit(db, actor, 'menu_category.update', id, { fields: Object.keys(changes) }),
    ])
  }
  catch (error) {
    if (isStaleWrite(error)) throw versionConflict('This category')
    throw error
  }
  return getCategory(db, id)
}

/**
 * Deletes a category that nothing depends on: no sub-categories and no menu items (409 with the
 * reason otherwise; the foreign keys enforce the same on a race).
 */
export async function deleteCategory(db: Db, actor: Actor, id: string, version: number) {
  const current = await findRow(db, id)
  if (!current) throw notFound('The category')
  if (current.version !== version) throw versionConflict('This category')

  const [[children], [products]] = await Promise.all([
    db.select({ n: count() }).from(menuCategories).where(eq(menuCategories.parentId, id)),
    db.select({ n: count() }).from(menuProducts).where(eq(menuProducts.categoryId, id)),
  ])
  if (children!.n > 0) {
    throw apiError(409, 'CATEGORY_HAS_CHILDREN', `"${current.name}" has sub-categories. Delete or move them first.`)
  }
  if (products!.n > 0) {
    const items = products!.n === 1 ? '1 menu item' : `${products!.n} menu items`
    throw apiError(409, 'CATEGORY_IN_USE', `"${current.name}" is used by ${items}. Move them to another category first.`)
  }

  try {
    await db.batch([
      db.delete(menuCategories).where(and(eq(menuCategories.id, id), eq(menuCategories.version, version))),
      requireOneChange(db),
      audit(db, actor, 'menu_category.delete', id, { name: current.name }),
    ])
  }
  catch (error) {
    if (isStaleWrite(error)) throw versionConflict('This category')
    if (isForeignKeyError(error)) {
      throw apiError(409, 'CATEGORY_IN_USE', `"${current.name}" is now in use. Reload and try again.`)
    }
    throw error
  }
}

/**
 * Sets the order of whole sibling lists (the mains, or the subs of one main), numbered from 1.
 * Each list must name exactly the current children of its parent, checked again inside the write
 * so a category added or moved meanwhile fails the whole save with ORDER_STALE (nothing applied).
 * Reordering doesn't change `version`: an open edit form stays valid.
 */
export async function reorderCategories(db: Db, actor: Actor, input: ReorderCategoriesBody) {
  const parents = input.lists.map(list => list.parentId)
  if (new Set(parents).size !== parents.length) {
    throw apiError(400, 'VALIDATION_FAILED', 'Each parent may appear once.', { fieldErrors: { lists: ['Each parent may appear once'] } })
  }

  const statements = []
  for (const list of input.lists) {
    if (new Set(list.ids).size !== list.ids.length) throw apiError(400, 'VALIDATION_FAILED', 'A list repeats a category.', { fieldErrors: { lists: ['A list repeats a category'] } })
    const children = await db.select({ id: menuCategories.id }).from(menuCategories).where(parentIs(list.parentId))
    const current = new Set(children.map(c => c.id))
    if (current.size !== list.ids.length || list.ids.some(id => !current.has(id))) {
      throw apiError(409, 'ORDER_STALE', 'Categories were added, moved or deleted meanwhile. Reload and arrange them again.')
    }
    statements.push(requireCount(
      db,
      sql`select count(*) from ${menuCategories} where ${list.parentId === null ? sql`${menuCategories.parentId} is null` : sql`${menuCategories.parentId} = ${list.parentId}`} and ${inArray(menuCategories.id, list.ids.length ? list.ids : [''])}`,
      list.ids.length,
    ))
    statements.push(requireCount(db, sql`select count(*) from ${menuCategories} where ${parentIs(list.parentId)}`, list.ids.length))
    list.ids.forEach((id, index) => statements.push(
      db.update(menuCategories).set({ sortOrder: index + 1 }).where(eq(menuCategories.id, id)),
    ))
  }
  statements.push(audit(db, actor, 'menu_category.reorder', null, { lists: input.lists.length }))

  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements])
  }
  catch (error) {
    if (isStaleWrite(error)) {
      throw apiError(409, 'ORDER_STALE', 'Categories were added, moved or deleted meanwhile. Reload and arrange them again.')
    }
    throw error
  }
  return listCategories(db)
}
