import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { InferSelectModel, SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Page, Status } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { CreateProductBody, Product, UpdateProductBody, VariantGroup, VariantGroupInput } from '#shared/contracts/menu'
import { CURRENCY, MAX_MENU_ITEMS } from '#shared/contracts/menu'
import {
  auditEvents,
  mediaAssets,
  menuCategories,
  menuProducts,
  menuSchedules,
  productSchedules,
  productVariantGroups,
  productVariantOptions,
} from '../../db/tables'
import type { Db } from '../../utils/batch'
import { isStaleWrite, requireOneChange } from '../../utils/batch'
import { toIso } from '../../utils/time'
import { apiError, notFound, versionConflict } from '../../utils/errors'
import type { Actor } from '../identity/service'
import { mediaUrl } from './media'

type ProductRow = InferSelectModel<typeof menuProducts>
type Statement = BatchItem<'sqlite'>

const audit = (db: Db, actor: Actor, action: string, targetId: string, metadata?: Record<string, unknown>) =>
  db.insert(auditEvents).values({ actorId: actor.userId, action, targetType: 'menu_product', targetId, metadata })

const invalid = (field: string, message: string, code: 'VALIDATION_FAILED' | 'REFERENCE_NOT_FOUND' = 'REFERENCE_NOT_FOUND') =>
  apiError(400, code, message, { fieldErrors: { [field]: [message] } })

// --- Reading ---

/** Full menu items (category, image, schedules, variants) for product rows, in the same order. */
async function assemble(db: Db, rows: ProductRow[]): Promise<Product[]> {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const categoryIds = [...new Set(rows.map(r => r.categoryId))]
  const assetIds = [...new Set(rows.flatMap(r => (r.imageAssetId ? [r.imageAssetId] : [])))]

  const [categories, assets, links, groups] = await Promise.all([
    db.select({ id: menuCategories.id, name: menuCategories.name, parentId: menuCategories.parentId, status: menuCategories.status })
      .from(menuCategories).where(inArray(menuCategories.id, categoryIds)),
    assetIds.length ? db.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : Promise.resolve([]),
    db.select().from(productSchedules).where(inArray(productSchedules.productId, ids)),
    db.select().from(productVariantGroups).where(inArray(productVariantGroups.productId, ids))
      .orderBy(asc(productVariantGroups.sortOrder)),
  ])
  const options = groups.length
    ? await db.select().from(productVariantOptions)
        .where(inArray(productVariantOptions.groupId, groups.map(g => g.id)))
        .orderBy(asc(productVariantOptions.sortOrder))
    : []

  const categoryById = new Map(categories.map(c => [c.id, c]))
  const assetById = new Map(assets.map(a => [a.id, a]))
  return rows.map((row) => {
    const asset = row.imageAssetId ? assetById.get(row.imageAssetId) : undefined
    const variantGroups: VariantGroup[] = groups.filter(g => g.productId === row.id).map(g => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: options.filter(o => o.groupId === g.id).map(o => ({ id: o.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor })),
    }))
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: categoryById.get(row.categoryId)!,
      priceMinor: row.priceMinor,
      currency: CURRENCY,
      image: asset ? { id: asset.id, url: mediaUrl(asset.objectKey) } : null,
      status: row.status,
      sortOrder: row.sortOrder,
      scheduleIds: links.filter(l => l.productId === row.id).map(l => l.scheduleId),
      variantGroups,
      version: row.version,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    }
  })
}

export interface ProductFilters {
  search?: string
  categoryId?: string
  status?: Status
}

function whereOf(filters: ProductFilters) {
  const conditions: SQL[] = []
  if (filters.search) conditions.push(sql`instr(lower(${menuProducts.name}), ${filters.search.toLowerCase()}) > 0`)
  if (filters.categoryId) conditions.push(eq(menuProducts.categoryId, filters.categoryId))
  if (filters.status) conditions.push(eq(menuProducts.status, filters.status))
  return conditions.length ? and(...conditions) : undefined
}

/** Flat lists sort by name; `sortOrder` is a position within a category (the grouped view uses it). */
const ORDER = [asc(sql`lower(${menuProducts.name})`), asc(menuProducts.id)]

export async function listProducts(db: Db, query: ProductFilters & { page: number, pageSize: number }): Promise<Page<Product>> {
  const where = whereOf(query)
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(menuProducts).where(where),
    db.select().from(menuProducts).where(where).orderBy(...ORDER).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
  ])
  return { items: await assemble(db, rows), page: query.page, pageSize: query.pageSize, total: total!.n, totalPages: totalPages(total!.n, query.pageSize) }
}

/** The whole filtered menu (up to `MAX_MENU_ITEMS`), for the grid grouped by category. */
export async function listMenu(db: Db, filters: ProductFilters): Promise<Product[]> {
  const rows = await db.select().from(menuProducts).where(whereOf(filters)).orderBy(...ORDER).limit(MAX_MENU_ITEMS)
  return assemble(db, rows)
}

export async function getProduct(db: Db, id: string): Promise<Product> {
  const [row] = await db.select().from(menuProducts).where(eq(menuProducts.id, id))
  if (!row) throw notFound('The menu item')
  return (await assemble(db, [row]))[0]!
}

// --- Checks shared by create and update ---

async function checkCategory(db: Db, categoryId: string) {
  const [category] = await db.select({ id: menuCategories.id }).from(menuCategories).where(eq(menuCategories.id, categoryId))
  if (!category) throw invalid('categoryId', 'The category no longer exists')
}

async function checkSchedules(db: Db, scheduleIds: string[]) {
  if (!scheduleIds.length) return
  const found = await db.select({ id: menuSchedules.id }).from(menuSchedules).where(inArray(menuSchedules.id, scheduleIds))
  if (found.length !== scheduleIds.length) throw invalid('scheduleIds', 'A schedule no longer exists')
}

/** An image may be a fresh upload, or the image the item already has. */
async function checkImage(db: Db, assetId: string, currentAssetId?: string | null) {
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
  if (!asset) throw invalid('imageAssetId', 'The image no longer exists. Upload it again')
  if (asset.state === 'attached' && asset.id !== currentAssetId) throw invalid('imageAssetId', 'This image belongs to another menu item')
}

// --- Writing variants ---

/**
 * Statements that make the item's variants exactly `groups` (full replacement with stable ids):
 * groups and options with an id are updated in place, new ones are inserted, and the ones left
 * out are deleted. Ids must belong to this item (and options to their group).
 */
async function variantStatements(db: Db, productId: string, groups: VariantGroupInput[], isNew: boolean): Promise<Statement[]> {
  const existingGroups = isNew ? [] : await db.select().from(productVariantGroups).where(eq(productVariantGroups.productId, productId))
  const existingOptions = existingGroups.length
    ? await db.select().from(productVariantOptions).where(inArray(productVariantOptions.groupId, existingGroups.map(g => g.id)))
    : []

  const statements: Statement[] = []
  const keptGroupIds = groups.flatMap(g => (g.id ? [g.id] : []))
  if (new Set(keptGroupIds).size !== keptGroupIds.length) throw invalid('variantGroups', 'A group appears twice', 'VALIDATION_FAILED')
  const allOptionIds = groups.flatMap(g => g.options.flatMap(o => (o.id ? [o.id] : [])))
  if (new Set(allOptionIds).size !== allOptionIds.length) throw invalid('variantGroups', 'An option appears twice', 'VALIDATION_FAILED')

  // Removed groups (their options go with them: cascade).
  if (existingGroups.length) {
    statements.push(db.delete(productVariantGroups).where(and(
      eq(productVariantGroups.productId, productId),
      keptGroupIds.length ? notInArray(productVariantGroups.id, keptGroupIds) : undefined,
    )))
  }

  groups.forEach((group, groupIndex) => {
    const path = `variantGroups.${groupIndex}`
    if (group.id && !existingGroups.some(g => g.id === group.id)) throw invalid(`${path}.id`, 'This group no longer exists. Reload the menu item')
    const groupId = group.id ?? crypto.randomUUID()
    const values = { name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect, sortOrder: groupIndex + 1 }
    statements.push(group.id
      ? db.update(productVariantGroups).set(values).where(eq(productVariantGroups.id, groupId))
      : db.insert(productVariantGroups).values({ id: groupId, productId, ...values }))

    const keptOptionIds = group.options.flatMap(o => (o.id ? [o.id] : []))
    if (group.id) {
      statements.push(db.delete(productVariantOptions).where(and(
        eq(productVariantOptions.groupId, groupId),
        keptOptionIds.length ? notInArray(productVariantOptions.id, keptOptionIds) : undefined,
      )))
    }
    group.options.forEach((option, optionIndex) => {
      if (option.id && !existingOptions.some(o => o.id === option.id && o.groupId === groupId)) {
        throw invalid(`${path}.options.${optionIndex}.id`, 'This option no longer exists. Reload the menu item')
      }
      const optionValues = { name: option.name, priceDeltaMinor: option.priceDeltaMinor ?? 0, sortOrder: optionIndex + 1 }
      statements.push(option.id
        ? db.update(productVariantOptions).set(optionValues).where(eq(productVariantOptions.id, option.id))
        : db.insert(productVariantOptions).values({ groupId, ...optionValues }))
    })
  })
  return statements
}

function scheduleStatements(db: Db, productId: string, scheduleIds: string[], isNew: boolean): Statement[] {
  return [
    ...(isNew ? [] : [db.delete(productSchedules).where(eq(productSchedules.productId, productId))]),
    ...(scheduleIds.length ? [db.insert(productSchedules).values(scheduleIds.map(scheduleId => ({ productId, scheduleId })))] : []),
  ]
}

const setAssetState = (db: Db, assetId: string, state: 'temporary' | 'attached') =>
  db.update(mediaAssets).set({ state }).where(eq(mediaAssets.id, assetId))

async function runBatch(db: Db, statements: Statement[], what: string) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isStaleWrite(error)) throw versionConflict(what)
    throw error
  }
}

// --- Commands ---

export async function createProduct(db: Db, actor: Actor, input: Required<CreateProductBody>): Promise<Product> {
  await checkCategory(db, input.categoryId)
  await checkSchedules(db, input.scheduleIds)
  if (input.imageAssetId) await checkImage(db, input.imageAssetId)

  const id = crypto.randomUUID()
  const [last] = await db.select({ max: sql<number | null>`max(${menuProducts.sortOrder})` }).from(menuProducts).where(eq(menuProducts.categoryId, input.categoryId))
  await runBatch(db, [
    db.insert(menuProducts).values({
      id,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      priceMinor: input.priceMinor,
      imageAssetId: input.imageAssetId,
      status: input.status,
      sortOrder: (last?.max ?? 0) + 1,
    }),
    ...(await variantStatements(db, id, input.variantGroups, true)),
    ...scheduleStatements(db, id, input.scheduleIds, true),
    ...(input.imageAssetId ? [setAssetState(db, input.imageAssetId, 'attached')] : []),
    audit(db, actor, 'menu_product.create', id, { name: input.name }),
  ], 'This menu item')
  return getProduct(db, id)
}

/**
 * Partial update from the current `version`. Everything (fields, variants, schedule links, image
 * state, audit) is one atomic batch that applies only if the version still matches.
 */
export async function updateProduct(db: Db, actor: Actor, id: string, input: UpdateProductBody): Promise<Product> {
  const [current] = await db.select().from(menuProducts).where(eq(menuProducts.id, id))
  if (!current) throw notFound('The menu item')
  if (current.version !== input.version) throw versionConflict('This menu item')

  if (input.categoryId !== undefined) await checkCategory(db, input.categoryId)
  if (input.scheduleIds !== undefined) await checkSchedules(db, input.scheduleIds)
  const imageChanged = input.imageAssetId !== undefined && input.imageAssetId !== current.imageAssetId
  if (imageChanged && input.imageAssetId) await checkImage(db, input.imageAssetId, current.imageAssetId)

  const fields = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(imageChanged ? { imageAssetId: input.imageAssetId ?? null } : {}),
  }
  await runBatch(db, [
    db.update(menuProducts)
      .set({ ...fields, version: sql`${menuProducts.version} + 1` })
      .where(and(eq(menuProducts.id, id), eq(menuProducts.version, input.version))),
    // Changed by someone else since the read: nothing below applies either.
    requireOneChange(db),
    ...(input.variantGroups === undefined ? [] : await variantStatements(db, id, input.variantGroups, false)),
    ...(input.scheduleIds === undefined ? [] : scheduleStatements(db, id, input.scheduleIds, false)),
    ...(imageChanged && input.imageAssetId ? [setAssetState(db, input.imageAssetId, 'attached')] : []),
    // The replaced image is no longer used: back to temporary, for the cleanup job.
    ...(imageChanged && current.imageAssetId ? [setAssetState(db, current.imageAssetId, 'temporary')] : []),
    audit(db, actor, 'menu_product.update', id, { fields: Object.keys(input).filter(k => k !== 'version') }),
  ], 'This menu item')
  return getProduct(db, id)
}

/** Deletes a menu item with its variants and schedule links. No orders exist yet to keep it for. */
export async function deleteProduct(db: Db, actor: Actor, id: string, version: number) {
  const [current] = await db.select().from(menuProducts).where(eq(menuProducts.id, id))
  if (!current) throw notFound('The menu item')
  if (current.version !== version) throw versionConflict('This menu item')
  await runBatch(db, [
    db.delete(menuProducts).where(and(eq(menuProducts.id, id), eq(menuProducts.version, version))),
    requireOneChange(db),
    ...(current.imageAssetId ? [setAssetState(db, current.imageAssetId, 'temporary')] : []),
    audit(db, actor, 'menu_product.delete', id, { name: current.name }),
  ], 'This menu item')
}
