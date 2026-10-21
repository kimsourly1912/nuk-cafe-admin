import { and, asc, desc, eq, exists, gte, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { PromotionScope, PromotionStatus, PromotionTargetRef } from '#shared/contracts/menu-promotions'
import { branches } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, readInChunks, replaceAll, updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, firstRow, inTenant } from '#server/utils/query'
import { groupBy } from '#shared/utils/collections'
import { activeCategory } from './categories.repository'
import { listedItem } from './items.repository'
import { menuCategories, menuItems, menuPromotionBranches, menuPromotionCategories, menuPromotionItems, menuPromotions } from './menu.schema'

/** Promotions' reads and the statements of their writes (M1, D163). */

export interface PromotionRow {
  id: string
  name: string
  description: string
  status: PromotionStatus
  discountKind: 'percent' | 'amount'
  percent: number | null
  amountMinor: number | null
  scope: PromotionScope
  startsOn: string
  endsOn: string | null
  posterAssetId: string | null
  endedAt: Date | null
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface PromotionLinks {
  items: Map<string, PromotionTargetRef[]>
  categories: Map<string, PromotionTargetRef[]>
  branches: Map<string, { id: string, name: string }[]>
}

export type PromotionValues = Pick<PromotionRow, 'name' | 'description' | 'discountKind' | 'percent' | 'amountMinor' | 'scope' | 'startsOn' | 'endsOn' | 'posterAssetId'>

const columns = {
  id: menuPromotions.id,
  name: menuPromotions.name,
  description: menuPromotions.description,
  status: menuPromotions.status,
  discountKind: menuPromotions.discountKind,
  percent: menuPromotions.percent,
  amountMinor: menuPromotions.amountMinor,
  scope: menuPromotions.scope,
  startsOn: menuPromotions.startsOn,
  endsOn: menuPromotions.endsOn,
  posterAssetId: menuPromotions.posterAssetId,
  endedAt: menuPromotions.endedAt,
  version: menuPromotions.version,
  createdAt: menuPromotions.createdAt,
  updatedAt: menuPromotions.updatedAt,
}

/** Rows grouped by promotion id, without it, each list by name (ignoring case). */
function byPromotion<T extends { promotionId: string, name: string }>(rows: T[]): Map<string, Omit<T, 'promotionId'>[]> {
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return new Map([...groupBy(rows, r => r.promotionId)].map(([id, list]) => [id, list.map(({ promotionId: _, ...rest }) => rest)]))
}

/** The ids per promotion id. */
const idsByPromotion = (rows: { promotionId: string, id: string }[]): Map<string, string[]> =>
  new Map([...groupBy(rows, r => r.promotionId)].map(([id, list]) => [id, list.map(r => r.id)]))

// --- Reads ---

export function findPromotion(db: Db, tenantId: string, id: string): Promise<PromotionRow | undefined> {
  return firstRow(db.select(columns).from(menuPromotions).where(byId(menuPromotions, tenantId, id)))
}

/** Every promotion of the cafe, newest first (the library is small). */
export function listPromotions(db: Db, tenantId: string): Promise<PromotionRow[]> {
  return db.select(columns).from(menuPromotions).where(inTenant(menuPromotions, tenantId)).orderBy(desc(menuPromotions.startsOn), desc(menuPromotions.id))
}

/** What these promotions name, by promotion id, each list by name: one batch per piece of the list. */
export async function linksOf(db: Db, tenantId: string, ids: string[]): Promise<PromotionLinks> {
  const pieces = await Promise.all(chunk(ids).map(piece => db.batch([
    db.select({ promotionId: menuPromotionItems.promotionId, id: menuItems.id, name: menuItems.name, status: menuItems.status })
      .from(menuPromotionItems)
      .innerJoin(menuItems, and(eq(menuItems.tenantId, menuPromotionItems.tenantId), eq(menuItems.id, menuPromotionItems.itemId)))
      .where(inTenant(menuPromotionItems, tenantId, inArray(menuPromotionItems.promotionId, piece))),
    db.select({ promotionId: menuPromotionCategories.promotionId, id: menuCategories.id, name: menuCategories.name, status: menuCategories.status })
      .from(menuPromotionCategories)
      .innerJoin(menuCategories, and(eq(menuCategories.tenantId, menuPromotionCategories.tenantId), eq(menuCategories.id, menuPromotionCategories.categoryId)))
      .where(inTenant(menuPromotionCategories, tenantId, inArray(menuPromotionCategories.promotionId, piece))),
    db.select({ promotionId: menuPromotionBranches.promotionId, id: branches.id, name: branches.name })
      .from(menuPromotionBranches)
      .innerJoin(branches, and(eq(branches.tenantId, menuPromotionBranches.tenantId), eq(branches.id, menuPromotionBranches.branchId)))
      .where(inTenant(menuPromotionBranches, tenantId, inArray(menuPromotionBranches.promotionId, piece))),
  ])))
  return {
    items: byPromotion(pieces.flatMap(([items]) => items)),
    categories: byPromotion(pieces.flatMap(([, categories]) => categories)),
    branches: byPromotion(pieces.flatMap(([, , branchRows]) => branchRows)),
  }
}

/**
 * The cafe's promotions running at `branchId` on `today` (`YYYY-MM-DD` on that branch's clock):
 * published, started, not past their last day, and for every branch or this one. Oldest first, so
 * a tie between two discounts goes to the older promotion.
 */
export function runningPromotions(db: Db, tenantId: string, branchId: string, today: string): Promise<PromotionRow[]> {
  const branchesOf = (...conditions: SQL[]) => db
    .select({ one: sql`1` })
    .from(menuPromotionBranches)
    .where(and(eq(menuPromotionBranches.tenantId, menuPromotions.tenantId), eq(menuPromotionBranches.promotionId, menuPromotions.id), ...conditions))
  return db
    .select(columns)
    .from(menuPromotions)
    .where(inTenant(menuPromotions, tenantId,
      eq(menuPromotions.status, 'published'),
      lte(menuPromotions.startsOn, today),
      or(isNull(menuPromotions.endsOn), gte(menuPromotions.endsOn, today)),
      or(notExists(branchesOf()), exists(branchesOf(eq(menuPromotionBranches.branchId, branchId)))),
    ))
    .orderBy(asc(menuPromotions.createdAt), asc(menuPromotions.id))
}

/** The item and category ids these promotions name, by promotion id: one batch per piece of the list. */
export async function targetIdsOf(db: Db, tenantId: string, ids: string[]): Promise<{ items: Map<string, string[]>, categories: Map<string, string[]> }> {
  const pieces = await Promise.all(chunk(ids).map(piece => db.batch([
    db.select({ promotionId: menuPromotionItems.promotionId, id: menuPromotionItems.itemId })
      .from(menuPromotionItems)
      .where(inTenant(menuPromotionItems, tenantId, inArray(menuPromotionItems.promotionId, piece))),
    db.select({ promotionId: menuPromotionCategories.promotionId, id: menuPromotionCategories.categoryId })
      .from(menuPromotionCategories)
      .where(inTenant(menuPromotionCategories, tenantId, inArray(menuPromotionCategories.promotionId, piece))),
  ])))
  return { items: idsByPromotion(pieces.flatMap(([items]) => items)), categories: idsByPromotion(pieces.flatMap(([, categories]) => categories)) }
}

/** Which of `ids` are the cafe's items that aren't archived. */
export async function liveItemIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  const rows = await readInChunks(ids, piece => db.select({ id: menuItems.id }).from(menuItems).where(inTenant(menuItems, tenantId, inArray(menuItems.id, piece), listedItem)))
  return new Set(rows.map(row => row.id))
}

/** Which of `ids` are the cafe's active categories. */
export async function activeCategoryIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  const rows = await readInChunks(ids, piece => db.select({ id: menuCategories.id }).from(menuCategories).where(inTenant(menuCategories, tenantId, inArray(menuCategories.id, piece), activeCategory)))
  return new Set(rows.map(row => row.id))
}

// --- Writes: statements for the service's batch ---

export function insertPromotionStatement(db: Db, row: PromotionValues & { id: string, tenantId: string, status: PromotionStatus, now: Date }): Statement {
  const { now, ...values } = row
  return db.insert(menuPromotions).values({ ...values, createdAt: now, updatedAt: now })
}

/**
 * Moves the promotion to the next version if it's still at `version` and in one of `statuses`,
 * applying `changes`. Follow it with `requireOneChange`.
 */
export function touchPromotionStatement(db: Db, tenantId: string, id: string, version: number, statuses: PromotionStatus[], now: Date, changes: Partial<PromotionValues & Pick<PromotionRow, 'status' | 'endedAt'>> = {}): Statement {
  return updateAtVersion(db, menuPromotions, { tenantId, id, version }, { ...changes, updatedAt: now }, inArray(menuPromotions.status, statuses))
}

/** Replaces the promotion's items, categories and branches. */
export function replaceLinksStatements(db: Db, tenantId: string, promotionId: string, links: { itemIds: string[], categoryIds: string[], branchIds: string[] }): Statement[] {
  return [
    ...replaceAll(db, menuPromotionItems, inTenant(menuPromotionItems, tenantId, eq(menuPromotionItems.promotionId, promotionId)), links.itemIds.map(itemId => ({ tenantId, promotionId, itemId }))),
    ...replaceAll(db, menuPromotionCategories, inTenant(menuPromotionCategories, tenantId, eq(menuPromotionCategories.promotionId, promotionId)), links.categoryIds.map(categoryId => ({ tenantId, promotionId, categoryId }))),
    ...replaceAll(db, menuPromotionBranches, inTenant(menuPromotionBranches, tenantId, eq(menuPromotionBranches.promotionId, promotionId)), links.branchIds.map(branchId => ({ tenantId, promotionId, branchId }))),
  ]
}

/** Deletes a draft at `version` (its links go with it). Follow it with `requireOneChange`. */
export function deleteDraftStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(menuPromotions).where(and(atVersion(menuPromotions, tenantId, id, version), eq(menuPromotions.status, 'draft')))
}

/** Every promotion of the cafe and its links (a sample-data reset, D94). */
export function deleteAllPromotionsStatements(db: Db, tenantId: string): Statement[] {
  return [menuPromotionItems, menuPromotionCategories, menuPromotionBranches, menuPromotions].map(table => db.delete(table).where(inTenant(table, tenantId)))
}
