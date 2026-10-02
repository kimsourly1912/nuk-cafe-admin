import type { BakongConnectionTest, KhqrCheck, KhqrReceived } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import type { BranchActor } from '#server/features/identity'
import type { BakongClient, BakongTransaction } from './bakong'
import { getCounterOrder, recordCheckedKhqrPayment } from './counter.service'
import type { ChargeRow } from './khqr.repository'
import { requireOrderCharge } from './khqr.service'
import { OrderErrorCodes } from './orders.errors'
import * as repo from './orders.repository'

/**
 * Checking a counter KHQR with Bakong (step 10.15b, D131). The counter asks every few seconds while
 * the QR is on screen; the server asks Bakong by the QR's MD5. Paid to the account the QR was made
 * for, in its currency and amount, the payment is recorded as the cashier who asked, exactly as if
 * they had pressed Confirm. Anything else records nothing and says why; Confirm stays as the
 * fallback (Bakong down, its token expired, or Bakong refusing a server outside Cambodia).
 */

const toReceived = (transaction: BakongTransaction): KhqrReceived => ({
  currency: transaction.currency,
  amount: transaction.amount,
  toAccountId: transaction.toAccountId,
})

const isOrderChanged = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === OrderErrorCodes.ORDER_CHANGED

/** Whether Bakong's transaction is this QR's: our account, its currency, its amount (cents or riel). */
export function matchesCharge(charge: Pick<ChargeRow, 'accountId' | 'currency' | 'amount'>, transaction: BakongTransaction): boolean {
  const amount = charge.currency === 'USD' ? Math.round(transaction.amount * 100) : Math.round(transaction.amount)
  return transaction.toAccountId.trim().toLowerCase() === charge.accountId.toLowerCase()
    && transaction.currency.trim().toUpperCase() === charge.currency
    && amount === charge.amount
}

/**
 * Asks Bakong about one of this order's QRs (`payment: ['collect']`); `bakong` is null without a
 * token. A QR of another order or branch is refused like `pay` refuses it (`KHQR_CHARGE_INVALID`).
 */
export async function checkKhqrCharge(db: Db, actor: BranchActor, orderId: string, chargeId: string, bakong: BakongClient | null, now = new Date()): Promise<KhqrCheck> {
  const charge = await requireOrderCharge(db, actor, orderId, chargeId)
  const [payment] = await repo.paymentsOf(db, [orderId])
  // Recorded already (by an earlier check, or the cashier's Confirm naming this QR): nothing to ask.
  if (payment?.khqrChargeId === charge.id) return { status: 'paid', order: await getCounterOrder(db, actor, orderId) }
  if (!bakong) return { status: 'unavailable', problem: 'not_set_up' }

  const answer = await bakong.checkByMd5(charge.md5)
  if (answer.kind === 'not_found') return { status: 'waiting' }
  if (answer.kind === 'unavailable') return { status: 'unavailable', problem: answer.problem }

  const received = toReceived(answer.transaction)
  if (!matchesCharge(charge, answer.transaction)) return { status: 'mismatch', received }

  const order = await repo.findOrder(db, orderId)
  if (order?.status === 'awaiting_payment') {
    try {
      return { status: 'paid', order: await recordCheckedKhqrPayment(db, actor, order, charge, answer.transaction.externalRef ?? answer.transaction.hash, now) }
    }
    catch (error) {
      // Another cashier's Confirm or check, or the expiry, got there first: say what it is now.
      if (!isOrderChanged(error)) throw error
    }
  }
  const [after] = await repo.paymentsOf(db, [orderId])
  const current = await getCounterOrder(db, actor, orderId)
  if (after?.khqrChargeId === charge.id) return { status: 'paid', order: current }
  // Paid on Bakong, but the order was paid another way, or cancelled: the customer gets it back.
  return { status: 'refund_needed', received, order: current }
}

/** A made-up MD5 Bakong can't know: "not found" means the token and this server are accepted. */
const PROBE_MD5 = '0'.repeat(32)

/** Payments → Test connection (`settings: ['manage']`): whether this server can ask Bakong. */
export async function testBakongConnection(bakong: BakongClient | null): Promise<BakongConnectionTest> {
  if (!bakong) return { status: 'unavailable', problem: 'not_set_up', detail: null }
  const answer = await bakong.checkByMd5(PROBE_MD5)
  if (answer.kind === 'unavailable') return { status: 'unavailable', problem: answer.problem, detail: answer.detail }
  return { status: 'connected' }
}
