import type { Db, Statement } from '#server/utils/batch'
import { captureSnapshotGuard } from '#server/utils/query'
import { checkoutSnapshot } from './checkout.repository'

/** Captured before pricing; guards every menu input until the order's atomic commit. */
export function captureCheckoutMenuGuard(db: Db, tenantId: string, branchId: string, itemIds: readonly string[]): Promise<{ guard: Statement }> {
  return captureSnapshotGuard(db, checkoutSnapshot(db, tenantId, branchId, itemIds))
}
