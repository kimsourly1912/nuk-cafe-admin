import type { CheckoutQuote, OrderLineInput, QuoteLine } from '#shared/contracts/orders'
import { ApiError } from '~/utils/api-error'
import type { CartLine } from './cart'
import { lineKey } from './cart'

/**
 * Review order's pure rules (step 6.2b, D100): what the page sends, how a new quote differs from
 * the one the customer saw, and what a refused order means for the page.
 */

/**
 * The lines as the server takes them. Notes are left out of a quote (they never change a price, so
 * typing one doesn't ask again) and sent when placing.
 */
export function orderLines(lines: CartLine[], options: { withNotes: boolean }): OrderLineInput[] {
  return lines.map(line => ({
    itemId: line.itemId,
    variationId: line.variationId,
    modifierIds: line.modifierIds,
    quantity: line.quantity,
    note: options.withNotes ? line.note?.trim() || null : null,
  }))
}

const keyOf = (line: Pick<QuoteLine, 'variationId' | 'modifierIds'>) => lineKey(line.variationId, line.modifierIds)

export interface PriceChange {
  /** The unit price the customer saw, by line key, for the lines whose price changed. */
  previousUnitPrices: Map<string, number>
  /** The total the customer saw, when it changed for another reason than their own edits. */
  previousTotalMinor: number | null
}

/**
 * How `next` differs from the quote the customer saw (`seen`): lines whose unit price changed.
 * A quantity the customer changed isn't a price change; neither is a line added or removed.
 */
export function priceChange(seen: CheckoutQuote | null | undefined, next: CheckoutQuote): PriceChange | null {
  if (!seen) return null
  const before = new Map(seen.lines.flatMap(line => (line.unitPriceMinor === null ? [] : [[keyOf(line), line.unitPriceMinor] as const])))
  const previousUnitPrices = new Map<string, number>()
  let previousTotalMinor = next.totalMinor
  for (const line of next.lines) {
    const old = before.get(keyOf(line))
    if (old === undefined || line.unitPriceMinor === null || old === line.unitPriceMinor) continue
    previousUnitPrices.set(keyOf(line), old)
    previousTotalMinor -= (line.unitPriceMinor - old) * line.quantity
  }
  return previousUnitPrices.size ? { previousUnitPrices, previousTotalMinor } : null
}

/**
 * What a refused order means for the page:
 * - `requote`: prices, items or the branch changed; the page asks for a new quote and shows it;
 * - `table`: the table QR stopped working; offer pickup;
 * - `signIn` / `verify`: the gates;
 * - `stop`: nothing to do here but read the message (too many unpaid orders);
 * - `retry`: no answer, or the server failed: try again with the same key (never a second order).
 */
export type PlaceFailure = 'requote' | 'table' | 'signIn' | 'verify' | 'stop' | 'retry'

export function placeFailure(error: unknown): { kind: PlaceFailure, message: string } {
  const apiError = ApiError.from(error)
  switch (apiError.code) {
    case 'PRICES_CHANGED':
    case 'ORDER_NOT_ORDERABLE':
    case 'ORDERING_CLOSED':
      return { kind: 'requote', message: apiError.message }
    case 'TABLE_UNAVAILABLE':
      return { kind: 'table', message: apiError.message }
    case 'TOO_MANY_UNPAID_ORDERS':
      return { kind: 'stop', message: apiError.message }
    case 'EMAIL_NOT_VERIFIED':
      return { kind: 'verify', message: 'Verify your email to place orders.' }
  }
  if (apiError.kind === 'unauthorized') return { kind: 'signIn', message: 'Sign in again to place your order.' }
  return { kind: 'retry', message: 'We couldn\'t confirm your order. Try again: you won\'t get a second order.' }
}
