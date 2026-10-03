import { PAYMENT_WINDOW_MINUTES } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { auditStatement } from '#server/features/platform'
import * as repo from './orders.repository'

/**
 * The unpaid-order expiry (step 6.6, D104; D45: an order still unpaid after 30 minutes is
 * cancelled). Run every minute by the `orders:expire-unpaid` task. Each order is its own batch,
 * guarded like a counter command (D101): the same status and version as read, so an order a
 * cashier pays at that very moment is left to the payment, never cancelled under it. The change
 * is written by the system: an `order_events` row with no actor, and an audit entry.
 */

/** Orders per run: a busy backlog clears over the next minutes instead of in one long run. */
const PER_RUN = 100

export const EXPIRY_NOTE = `Not paid within ${PAYMENT_WINDOW_MINUTES} minutes`

export interface ExpiryReport {
  /** Cancelled by this run. */
  expired: number
  /** Changed meanwhile (paid or cancelled at the counter): left as they are. */
  skipped: number
}

export async function expireUnpaidOrders(db: Db, now = new Date()): Promise<ExpiryReport> {
  const report: ExpiryReport = { expired: 0, skipped: 0 }
  for (const order of await repo.findExpiredUnpaid(db, now, PER_RUN)) {
    try {
      await db.batch([
        repo.transitionStatement(db, { orderId: order.id, fromStatus: 'awaiting_payment', toStatus: 'cancelled', version: order.version, at: now }),
        requireOneChange(db),
        repo.eventStatement(db, { tenantId: order.tenantId, orderId: order.id, toVersion: order.version + 1, actorId: null, fromStatus: 'awaiting_payment', toStatus: 'cancelled', note: EXPIRY_NOTE, at: now }),
        auditStatement(db, { userId: null, tenantId: order.tenantId }, { action: 'orders.order.expire', targetType: 'order', targetId: order.id, branchId: order.branchId, metadata: { from: 'awaiting_payment', to: 'cancelled' } }),
      ])
      report.expired++
    }
    catch (error) {
      // The guard, or the event's unique version: someone else changed the order first.
      if (!isStaleWrite(error) && !isUniqueViolation(error)) throw error
      report.skipped++
    }
  }
  return report
}
