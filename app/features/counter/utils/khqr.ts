import type { KhqrCharge } from '#shared/contracts/orders'
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
