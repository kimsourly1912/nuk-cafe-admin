import type { OrderHistoryDetail } from '#shared/contracts/reports'
import type { RefundOrderInput } from '#shared/contracts/orders'
import { REFUND_DAYS } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { requireOneChange } from '#server/utils/batch'
import type { BranchActor } from '#server/features/identity'
import { runOrderCommand } from './commands'
import { orderChanged, orderNotRefundable, refundTooLate } from './orders.errors'
import * as repo from './orders.repository'
import { orderHistoryDetail } from './reports.service'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * An owner records that a ready or completed order's money went back (`payment: ['refund']`,
 * D233): the full amount, within REFUND_DAYS of its payment. Before ready the counter's cancel does
 * this (Q36, D101). A ready order is cancelled (it leaves the queue); a completed one stays
 * completed, keeping its completion time. The payment's return, the status change at the version
 * read, its event and the audit entry are one batch; the payment's own guard refuses a second
 * refund even past the version check. Reports count it on the day the money went back (D110).
 */
export async function refundOrder(db: Db, actor: BranchActor, orderId: string, input: RefundOrderInput, key: string, now = new Date()): Promise<OrderHistoryDetail> {
  await runOrderCommand(db, {
    actor,
    orderId,
    key,
    operation: 'refund',
    version: input.version,
    request: input,
    now,
    owns: order => order.branchId === actor.branchId,
    changed: order => orderChanged(order.pickupNumber, order.status),
  }, async (order) => {
    const [payment] = await repo.paymentsOf(db, actor.tenantId, [orderId])
    const refundable = (order.status === 'ready' || order.status === 'completed') && payment && !payment.returnedAt
    if (!refundable) throw orderNotRefundable(order.status, Boolean(payment?.returnedAt), order.pickupNumber)
    if (!order.paidAt || now.getTime() - order.paidAt.getTime() > REFUND_DAYS * DAY_MS) throw refundTooLate(REFUND_DAYS)
    return {
      to: order.status === 'ready' ? 'cancelled' : 'completed',
      reason: { reason: 'other', note: input.note },
      statements: [
        repo.refundPaymentStatement(db, actor.tenantId, orderId, { returnMethod: input.returnMethod, returnedBy: actor.userId, returnedAt: now }),
        requireOneChange(db),
      ],
      metadata: { returnMethod: input.returnMethod, amountMinor: payment.amountMinor },
    }
  })
  return orderHistoryDetail(db, actor.tenantId, orderId)
}
