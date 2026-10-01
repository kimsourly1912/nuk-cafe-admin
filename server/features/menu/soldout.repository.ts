import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertPieces, readInChunks } from '#server/utils/batch'
import { branchItemStates, menuItemOptionSets, menuItems, menuItemVariations, menuOptionValues, menuVariationOptionValues } from './menu.schema'

export interface SellableVersionRow {
  id: string
  itemStatus: 'draft' | 'active' | 'archived'
  variationStatus: 'active' | 'disabled' | 'retired'
}

export interface SoldOutRow {
  variationId: string
  itemId: string
  itemName: string
  updatedAt: Date
  updatedBy: string
  /** The name of who switched it off; `null` when that account is gone. */
  updatedByName: string | null
}

/** These variations with their own and their item's status (unknown ids are left out). */
export async function findVariations(db: Db, ids: string[]): Promise<SellableVersionRow[]> {
  return readInChunks(ids, piece => db.select({ id: menuItemVariations.id, itemStatus: menuItems.status, variationStatus: menuItemVariations.status })
    .from(menuItemVariations)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .where(inArray(menuItemVariations.id, piece)))
}

/**
 * What's sold out at the branch, by item name. Versions of archived items and retired versions are
 * left out: they aren't sold anyway, and their switch comes back if they return.
 */
export async function listSoldOut(db: Db, branchId: string): Promise<SoldOutRow[]> {
  return db.select({ variationId: branchItemStates.variationId, itemId: menuItems.id, itemName: menuItems.name, updatedAt: branchItemStates.updatedAt, updatedBy: branchItemStates.updatedBy, updatedByName: user.name })
    .from(branchItemStates)
    .leftJoin(user, eq(user.id, branchItemStates.updatedBy))
    .innerJoin(menuItemVariations, eq(menuItemVariations.id, branchItemStates.variationId))
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariations.itemId))
    .where(and(eq(branchItemStates.branchId, branchId), eq(branchItemStates.soldOut, true), ne(menuItems.status, 'archived'), ne(menuItemVariations.status, 'retired')))
    .orderBy(asc(sql`lower(${menuItems.name})`), asc(menuItemVariations.sortOrder))
}

/** Each variation's option value names, in its item's option-set order ("Large, Iced"). */
export async function labels(db: Db, variationIds: string[]): Promise<Map<string, string>> {
  const rows: { variationId: string, name: string, setOrder: number }[] = await readInChunks(variationIds, ids => db
    .select({ variationId: menuVariationOptionValues.variationId, name: menuOptionValues.name, setOrder: menuItemOptionSets.sortOrder })
    .from(menuVariationOptionValues)
    .innerJoin(menuOptionValues, eq(menuOptionValues.id, menuVariationOptionValues.valueId))
    .innerJoin(menuItemVariations, eq(menuItemVariations.id, menuVariationOptionValues.variationId))
    .innerJoin(menuItemOptionSets, and(eq(menuItemOptionSets.itemId, menuItemVariations.itemId), eq(menuItemOptionSets.setId, menuOptionValues.setId)))
    .where(inArray(menuVariationOptionValues.variationId, ids)))
  rows.sort((a, b) => a.setOrder - b.setOrder)
  const names = new Map<string, string[]>()
  for (const row of rows) names.set(row.variationId, [...(names.get(row.variationId) ?? []), row.name])
  return new Map([...names].map(([id, list]) => [id, list.join(', ')]))
}

// --- Writes: statements for the service's batch ---

/**
 * Marks these variations sold out at the branch. A row already sold out is left as it is (who
 * switched it off first stays on record); one switched back on before is switched off again.
 */
export function markSoldOutStatements(db: Db, branchId: string, variationIds: string[], userId: string, now: Date): Statement[] {
  const rows = variationIds.map(variationId => ({ branchId, variationId, soldOut: true, updatedBy: userId, updatedAt: now }))
  return insertPieces(branchItemStates, rows).map(piece => db.insert(branchItemStates).values(piece)
    .onConflictDoUpdate({
      target: [branchItemStates.branchId, branchItemStates.variationId],
      // No bound parameters here: `insertPieces` already fills D1's 100 with the rows.
      set: { soldOut: sql`excluded.sold_out`, updatedBy: sql`excluded.updated_by`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`${branchItemStates.soldOut} = 0`,
    }))
}

/** Puts these variations back on sale at the branch (those that were sold out). */
export function markOnSaleStatements(db: Db, branchId: string, variationIds: string[], userId: string, now: Date): Statement[] {
  return chunk(variationIds).map(ids => db.update(branchItemStates)
    .set({ soldOut: false, updatedBy: userId, updatedAt: now })
    .where(and(eq(branchItemStates.branchId, branchId), inArray(branchItemStates.variationId, ids), eq(branchItemStates.soldOut, true))))
}

/** The variations sold out at the branch (for the customer menu). */
export async function soldOutIds(db: Db, branchId: string): Promise<Set<string>> {
  const rows: { variationId: string }[] = await db.select({ variationId: branchItemStates.variationId }).from(branchItemStates)
    .where(and(eq(branchItemStates.branchId, branchId), eq(branchItemStates.soldOut, true)))
  return new Set(rows.map(r => r.variationId))
}
