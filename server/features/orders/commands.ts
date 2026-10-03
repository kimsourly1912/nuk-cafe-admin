import type { CancelReason, OrderStatus } from '#shared/contracts/orders'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import type { Actor } from '#server/features/identity'
import { auditStatement, withIdempotency } from '#server/features/platform'
import { orderNotFound } from './orders.errors'
import * as repo from './orders.repository'

/**
 * One command on an order (D101; the customer's cancel since step 6.5, D106): the change applies
 * only if the order still has the status and version the screen read (a guard in the batch), with
 * its event, the command's own statements and the audit entry in one atomic batch, stored under
 * the idempotency key so a retry returns the first answer and changes nothing.
 */

export interface OrderCommand {
  actor: Actor
  orderId: string
  /** The `Idempotency-Key` header. */
  key: string
  /** `pay`, `cancel`, `customer_cancel`…: the idempotency operation and the audit action. */
  operation: string
  /** The version the screen showed. */
  version: number
  /** The request, for the idempotency fingerprint. */
  request: Record<string, unknown>
  now: Date
  /** Whether this actor may act on the order; any other is 404, like an unknown id. */
  owns: (order: repo.OrderRow) => boolean
  /** The refusal for an order that changed since the screen read it (it's re-read first). */
  changed: (order: repo.OrderRow) => Error
}

export interface OrderStep {
  to: OrderStatus
  /** Statements beyond the status change, its event and the audit entry. */
  statements?: Statement[]
  reason?: { reason: CancelReason, note: string | null }
  metadata?: Record<string, unknown>
}

/** Thrown by a guard inside the batch; replaced by the order's state now, read afresh. */
class OrderMovedOn extends Error {}

/**
 * Finds the order, lets `plan` refuse it or say where it goes, then writes the change. Returns once
 * written (or replayed); the caller reads the order back the way its surface shows it.
 */
export async function runOrderCommand(db: Db, command: OrderCommand, plan: (order: repo.OrderRow) => OrderStep | Promise<OrderStep>): Promise<void> {
  const { actor, orderId, now } = command
  try {
    await withIdempotency(
      db,
      { actorId: actor.userId, operation: `orders.${command.operation}`, key: command.key },
      { orderId, ...command.request },
      async () => {
        const order = await repo.findOrder(db, actor.tenantId, orderId)
        if (!order || !command.owns(order)) throw orderNotFound()
        if (order.version !== command.version) throw command.changed(order)
        const step = await plan(order)
        const change: repo.OrderChange = { orderId, fromStatus: order.status, toStatus: step.to, version: order.version, at: now }
        return {
          statements: [
            repo.transitionStatement(db, change),
            requireOneChange(db),
            repo.eventStatement(db, {
              tenantId: order.tenantId,
              orderId,
              toVersion: order.version + 1,
              actorId: actor.userId,
              fromStatus: order.status,
              toStatus: step.to,
              reason: step.reason?.reason ?? null,
              note: step.reason?.note ?? null,
              at: now,
            }),
            ...(step.statements ?? []),
            auditStatement(db, actor, {
              action: `orders.order.${command.operation}`,
              targetType: 'order',
              targetId: orderId,
              branchId: order.branchId,
              metadata: { from: order.status, to: step.to, ...step.metadata },
            }),
          ],
          response: { orderId },
        }
      },
      { onStale: () => new OrderMovedOn(), now },
    )
  }
  catch (error) {
    // Another command changed the order between our read and our write (or paid it: the payment's
    // unique index, the last guard). Say what it is now.
    if (error instanceof OrderMovedOn || isStaleWrite(error) || isUniqueViolation(error)) {
      const current = await repo.findOrder(db, actor.tenantId, orderId)
      if (current) throw command.changed(current)
    }
    throw error
  }
}
