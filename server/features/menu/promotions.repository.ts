import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PromotionScope, PromotionStatus, PromotionTargetRef } from '#shared/contracts/menu-promotions'
import type { Db, Statement } from '#server/utils/batch'
import { insertPieces, readInChunks } from '#server/utils/batch'
import { branches } from '#server/db/tables'
import { menuCategories, menuItems, menuPromotionBranches, menuPromotionCategories, menuPromotionItems, menuPromotions } from './menu.schema'

/** Promotions' reads and the statements of their writes (M1, D163). Every read names the tenant. */

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

export async function findPromotion(db: Db, tenantId: string, id: string): Promise<PromotionRow | undefined> {
  const rows: PromotionRow[] = await db.select(columns).from(menuPromotions).where(and(eq(menuPromotions.tenantId, tenantId), eq(menuPromotions.id, id))).limit(1)
  return rows[0]
}

/** Every promotion of the tenant, newest first (the library is small). */
export function listPromotions(db: Db, tenantId: string): Promise<PromotionRow[]> {
  return db.select(columns).from(menuPromotions).where(eq(menuPromotions.tenantId, tenantId)).orderBy(desc(menuPromotions.startsOn), desc(menuPromotions.id))
}

export interface PromotionLinks {
  items: Map<string, PromotionTargetRef[]>
  categories: Map<string, PromotionTargetRef[]>
  branches: Map<string, { id: string, name: string }[]>
}

const group = <T extends { promotionId: string }>(rows: T[]) => {
  const map = new Map<string, Omit<T, 'promotionId'>[]>()
  for (const { promotionId, ...rest } of rows) map.set(promotionId, [...(map.get(promotionId) ?? []), rest])
  return map
}

/** What these promotions name, by promotion id, each list by name. */
export async function linksOf(db: Db, tenantId: string, ids: string[]): Promise<PromotionLinks> {
  if (!ids.length) return { items: new Map(), categories: new Map(), branches: new Map() }
  const byName = <T extends { name: string }>(rows: T[]) => rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const [items, categories, branchRows] = await Promise.all([
    readInChunks(ids, piece => db.select({ promotionId: menuPromotionItems.promotionId, id: menuItems.id, name: menuItems.name, status: menuItems.status })
      .from(menuPromotionItems).innerJoin(menuItems, eq(menuItems.id, menuPromotionItems.itemId))
      .where(and(eq(menuPromotionItems.tenantId, tenantId), inArray(menuPromotionItems.promotionId, piece)))),
    readInChunks(ids, piece => db.select({ promotionId: menuPromotionCategories.promotionId, id: menuCategories.id, name: menuCategories.name, status: menuCategories.status })
      .from(menuPromotionCategories).innerJoin(menuCategories, eq(menuCategories.id, menuPromotionCategories.categoryId))
      .where(and(eq(menuPromotionCategories.tenantId, tenantId), inArray(menuPromotionCategories.promotionId, piece)))),
    readInChunks(ids, piece => db.select({ promotionId: menuPromotionBranches.promotionId, id: branches.id, name: branches.name })
      .from(menuPromotionBranches).innerJoin(branches, eq(branches.id, menuPromotionBranches.branchId))
      .where(and(eq(menuPromotionBranches.tenantId, tenantId), inArray(menuPromotionBranches.promotionId, piece)))),
  ])
  return { items: group(byName(items)), categories: group(byName(categories)), branches: group(byName(branchRows)) }
}

/**
 * The tenant's promotions running at `branchId` on `today` (`YYYY-MM-DD` on that branch's clock):
 * published, started, not past their last day, and for every branch or this one. Oldest first, so
 * a tie between two discounts goes to the older promotion.
 */
export function runningPromotions(db: Db, tenantId: string, branchId: string, today: string): Promise<PromotionRow[]> {
  return db.select(columns).from(menuPromotions).where(and(
    eq(menuPromotions.tenantId, tenantId),
    eq(menuPromotions.status, 'published'),
    sql`${menuPromotions.startsOn} <= ${today}`,
    sql`(${menuPromotions.endsOn} is null or ${menuPromotions.endsOn} >= ${today})`,
    sql`(not exists (select 1 from ${menuPromotionBranches} where ${menuPromotionBranches.promotionId} = ${menuPromotions.id})
      or exists (select 1 from ${menuPromotionBranches} where ${menuPromotionBranches.promotionId} = ${menuPromotions.id} and ${menuPromotionBranches.branchId} = ${branchId}))`,
  )).orderBy(asc(menuPromotions.createdAt), asc(menuPromotions.id))
}

/** The item and category ids these promotions name, by promotion id. */
export async function targetIdsOf(db: Db, tenantId: string, ids: string[]): Promise<{ items: Map<string, string[]>, categories: Map<string, string[]> }> {
  if (!ids.length) return { items: new Map(), categories: new Map() }
  const [items, categories] = await Promise.all([
    readInChunks(ids, piece => db.select({ promotionId: menuPromotionItems.promotionId, id: menuPromotionItems.itemId }).from(menuPromotionItems)
      .where(and(eq(menuPromotionItems.tenantId, tenantId), inArray(menuPromotionItems.promotionId, piece)))),
    readInChunks(ids, piece => db.select({ promotionId: menuPromotionCategories.promotionId, id: menuPromotionCategories.categoryId }).from(menuPromotionCategories)
      .where(and(eq(menuPromotionCategories.tenantId, tenantId), inArray(menuPromotionCategories.promotionId, piece)))),
  ])
  const byPromotion = (rows: { promotionId: string, id: string }[]) => {
    const map = new Map<string, string[]>()
    for (const row of rows) map.set(row.promotionId, [...(map.get(row.promotionId) ?? []), row.id])
    return map
  }
  return { items: byPromotion(items), categories: byPromotion(categories) }
}

/** Which of `ids` are the tenant's items that aren't archived. */
export async function liveItemIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  const rows = await readInChunks(ids, piece => db.select({ id: menuItems.id }).from(menuItems)
    .where(and(eq(menuItems.tenantId, tenantId), inArray(menuItems.id, piece), sql`${menuItems.status} <> 'archived'`)))
  return new Set(rows.map(row => row.id))
}

/** Which of `ids` are the tenant's active categories. */
export async function activeCategoryIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  const rows = await readInChunks(ids, piece => db.select({ id: menuCategories.id }).from(menuCategories)
    .where(and(eq(menuCategories.tenantId, tenantId), inArray(menuCategories.id, piece), eq(menuCategories.status, 'active'))))
  return new Set(rows.map(row => row.id))
}

// --- Writes: statements for the service's batch ---

export type PromotionValues = Pick<PromotionRow, 'name' | 'description' | 'discountKind' | 'percent' | 'amountMinor' | 'scope' | 'startsOn' | 'endsOn' | 'posterAssetId'>

export function insertPromotionStatement(db: Db, row: PromotionValues & { id: string, tenantId: string, status: PromotionStatus, now: Date }): Statement {
  const { now, ...values } = row
  return db.insert(menuPromotions).values({ ...values, createdAt: now, updatedAt: now })
}

/**
 * Moves the promotion to the next version if it's still at `version` and in one of `statuses`,
 * applying `changes`. Follow it with `requireOneChange`.
 */
export function touchPromotionStatement(db: Db, tenantId: string, id: string, version: number, statuses: PromotionStatus[], now: Date, changes: Partial<PromotionValues & Pick<PromotionRow, 'status' | 'endedAt'>> = {}): Statement {
  return db.update(menuPromotions)
    .set({ ...changes, version: sql`${menuPromotions.version} + 1`, updatedAt: now })
    .where(and(eq(menuPromotions.tenantId, tenantId), eq(menuPromotions.id, id), eq(menuPromotions.version, version), inArray(menuPromotions.status, statuses)))
}

/** Replaces the promotion's items, categories and branches. */
export function replaceLinksStatements(db: Db, tenantId: string, promotionId: string, links: { itemIds: string[], categoryIds: string[], branchIds: string[] }): Statement[] {
  return [
    db.delete(menuPromotionItems).where(and(eq(menuPromotionItems.tenantId, tenantId), eq(menuPromotionItems.promotionId, promotionId))),
    db.delete(menuPromotionCategories).where(and(eq(menuPromotionCategories.tenantId, tenantId), eq(menuPromotionCategories.promotionId, promotionId))),
    db.delete(menuPromotionBranches).where(and(eq(menuPromotionBranches.tenantId, tenantId), eq(menuPromotionBranches.promotionId, promotionId))),
    ...insertPieces(menuPromotionItems, links.itemIds.map(itemId => ({ tenantId, promotionId, itemId }))).map(piece => db.insert(menuPromotionItems).values(piece)),
    ...insertPieces(menuPromotionCategories, links.categoryIds.map(categoryId => ({ tenantId, promotionId, categoryId }))).map(piece => db.insert(menuPromotionCategories).values(piece)),
    ...insertPieces(menuPromotionBranches, links.branchIds.map(branchId => ({ tenantId, promotionId, branchId }))).map(piece => db.insert(menuPromotionBranches).values(piece)),
  ]
}

/** Deletes a draft at `version` (its links go with it). Follow it with `requireOneChange`. */
export function deleteDraftStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(menuPromotions).where(and(eq(menuPromotions.tenantId, tenantId), eq(menuPromotions.id, id), eq(menuPromotions.version, version), eq(menuPromotions.status, 'draft')))
}

/** Every promotion of the tenant and its links (a sample-data reset, D94). */
export function deleteAllPromotionsStatements(db: Db, tenantId: string): Statement[] {
  return [
    db.delete(menuPromotionItems).where(eq(menuPromotionItems.tenantId, tenantId)),
    db.delete(menuPromotionCategories).where(eq(menuPromotionCategories.tenantId, tenantId)),
    db.delete(menuPromotionBranches).where(eq(menuPromotionBranches.tenantId, tenantId)),
    db.delete(menuPromotions).where(eq(menuPromotions.tenantId, tenantId)),
  ]
}
