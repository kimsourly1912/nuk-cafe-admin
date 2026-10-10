import { checkKhqrCharge } from '#server/features/orders'

/**
 * Asks Bakong whether this QR was paid (step 10.15b, D131); paid as it should be, the payment is
 * recorded as the cashier asking, as if they had pressed Confirm. Polled by the counter while the
 * QR is on screen. Without a Bakong token: `unavailable`, and the cashier confirms by hand. A
 * payment recorded here sends the cafe's Telegram alert right after the answer (D150).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { payment: ['collect'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const chargeId = readIdParam(event, 'chargeId', 'This QR')
  const check = await checkKhqrCharge(useDb(), actor, orderId, chargeId, await useBakong(event, actor.tenantId))
  if (check.status === 'paid') sendOrderEventsNow(event)
  return check
})
