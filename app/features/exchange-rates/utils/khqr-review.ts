import type { KhqrCurrency, KhqrReview, KhqrReviewReason, ReturnMethod } from '#shared/contracts/orders'
import { formatMinor, formatRiel } from '~/utils/money'

/** KHQR review cases on Payments (D266): what the owner reads about each one. */

/** "#042", as Order history writes order numbers. */
export const reviewOrderNumber = (review: Pick<KhqrReview, 'order'>) => `#${String(review.order.pickupNumber).padStart(3, '0')}`

/** An amount in minor units: cents for USD, riel for KHR. */
export const khqrAmount = (money: { currency: KhqrCurrency, amount: number }) =>
  money.currency === 'USD' ? formatMinor(money.amount) : formatRiel(money.amount)

export const REVIEW_REASONS: Record<KhqrReviewReason, string> = {
  paid_otherwise: 'Paid twice: the order was already paid another way',
  order_cancelled: 'Paid after the order was cancelled',
  amount_mismatch: 'Paid a different amount than the QR asked',
}

export const RETURN_METHODS_SHOWN: Record<ReturnMethod, string> = {
  cash: 'Cash',
  khqr: 'KHQR',
}

/** Whole dollars and cents in the form, cents to the server; riel stays riel. */
export const toMinor = (currency: KhqrCurrency, shown: number) => (currency === 'USD' ? Math.round(shown * 100) : Math.round(shown))
export const fromMinor = (currency: KhqrCurrency, amount: number) => (currency === 'USD' ? amount / 100 : amount)
