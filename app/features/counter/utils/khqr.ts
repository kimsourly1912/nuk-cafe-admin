import type { KhqrCharge, KhqrCheckProblem, KhqrReceived } from '#shared/contracts/orders'
import { formatMinor } from '~/utils/money'
import { formatRiel } from './counter'

/** "$8.75" or "៛35,900": what the QR asks for. */
export const khqrAmountText = (charge: Pick<KhqrCharge, 'currency' | 'amount'>) =>
  (charge.currency === 'KHR' ? formatRiel(charge.amount) : formatMinor(charge.amount))

/**
 * How long the QR still works, by the server's clock: `serverOffsetMs` is the server's time minus
 * this device's (from when the QR arrived), so a tablet whose clock is off still counts right.
 * "14:05" while it works; expired once it reaches 0.
 */
export function khqrTimeLeft(expiresAt: string, nowMs: number, serverOffsetMs = 0): { expired: boolean, label: string } {
  const left = Math.max(0, Date.parse(expiresAt) - (nowMs + serverOffsetMs))
  const seconds = Math.ceil(left / 1000)
  return { expired: seconds === 0, label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
}

/** How often the counter asks the server to check the QR with Bakong (step 10.15b, D131). */
export const KHQR_CHECK_INTERVAL_MS = 5_000
/** A payment can land after the QR expired (the customer scanned it in time): keep checking this long after. */
export const KHQR_CHECK_AFTER_EXPIRY_MS = 5 * 60_000

/** Whether to keep asking: until a while after the QR expired, by the server's clock. */
export const khqrKeepChecking = (expiresAt: string, nowMs: number, serverOffsetMs = 0) =>
  nowMs + serverOffsetMs < Date.parse(expiresAt) + KHQR_CHECK_AFTER_EXPIRY_MS

/** "$8.00 to someone@aclb": what Bakong says arrived (dollars or riel, in the currency's units). */
export function khqrReceivedText(received: KhqrReceived): string {
  const amount = received.currency === 'USD'
    ? formatMinor(Math.round(received.amount * 100))
    : received.currency === 'KHR' ? formatRiel(Math.round(received.amount)) : `${received.amount} ${received.currency}`
  return `${amount} to ${received.toAccountId}`
}

/** Why the counter can't check by itself: the cashier confirms by hand meanwhile. */
export function khqrCheckProblemText(problem: KhqrCheckProblem): string {
  if (problem === 'token') return 'Bakong didn\'t accept the cafe\'s token (it may have expired): ask an admin.'
  if (problem === 'refused') return 'Bakong doesn\'t answer this server.'
  if (problem === 'not_set_up') return 'Automatic check is off.'
  return 'Bakong didn\'t answer just now.'
}
