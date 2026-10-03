import type { SetSoldOutInput, SoldOutList } from '#shared/contracts/menu-sold-out'
import type { Db } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import type { BranchActor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { variationNotAvailable } from './soldout.errors'
import * as repo from './soldout.repository'

/**
 * Sold out per branch (docs/server/data-model.md → Menu, D64). The branch is the actor's, which
 * `requireBranchPermission` took from the path and checked against the caller's membership.
 */

export async function listSoldOut(db: Db, actor: BranchActor): Promise<SoldOutList> {
  const rows = await repo.listSoldOut(db, actor.branchId)
  const labels = await repo.labels(db, rows.map(r => r.variationId))
  return {
    branchId: actor.branchId,
    variations: rows.map(row => ({
      variationId: row.variationId,
      itemId: row.itemId,
      itemName: row.itemName,
      label: labels.get(row.variationId) ?? '',
      updatedAt: toIso(row.updatedAt),
      updatedBy: row.updatedBy,
      updatedByName: row.updatedByName,
    })),
  }
}

/**
 * Switches versions off (`soldOut: true`) or back on at the actor's branch, and returns what's sold
 * out now. It sets a state rather than toggling, so it needs no version check: two people at once,
 * or a retry, end in the state asked for. Versions already in that state are left as they are.
 *
 * Drafts and switched-off versions are accepted (the switch applies once they're sold); versions
 * removed from the grid and archived items are refused. That check isn't repeated in the batch: a
 * switch on an item archived meanwhile is harmless, it's never sold and is listed again if the item
 * returns.
 */
export async function setSoldOut(db: Db, actor: BranchActor, input: SetSoldOutInput): Promise<SoldOutList> {
  const found = new Map((await repo.findVariations(db, actor.tenantId, input.variationIds)).map(v => [v.id, v]))
  input.variationIds.forEach((id, i) => {
    const variation = found.get(id)
    if (!variation || variation.variationStatus === 'retired' || variation.itemStatus === 'archived') throw variationNotAvailable(i)
  })

  const now = new Date()
  const change = input.soldOut
    ? repo.markSoldOutStatements(db, actor.tenantId, actor.branchId, input.variationIds, actor.userId, now)
    : repo.markOnSaleStatements(db, actor.branchId, input.variationIds, actor.userId, now)
  const audit = auditStatement(db, actor, {
    action: 'menu.sold_out.set',
    targetType: 'branch',
    targetId: actor.branchId,
    branchId: actor.branchId,
    metadata: { soldOut: input.soldOut, variationIds: input.variationIds },
  })
  await db.batch([audit, ...change])
  return listSoldOut(db, actor)
}
