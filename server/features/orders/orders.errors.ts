import type { OrderStatus } from '#shared/contracts/orders'
import { MAX_UNPAID_ORDERS } from '#shared/contracts/orders'
import { apiError, ErrorCodes, notFound } from '#server/utils/errors'

/** Error codes of placing and reading orders (step 6.2, D99). */
export const OrderErrorCodes = {
  /** The branch is closed, or it's past last orders: the message says which. */
  ORDERING_CLOSED: 'ORDERING_CLOSED',
  /** A line can't be ordered now (sold out, gone, a rule unmet): ask for a new quote. */
  ORDER_NOT_ORDERABLE: 'ORDER_NOT_ORDERABLE',
  /** The total differs from the one the page showed. */
  PRICES_CHANGED: 'PRICES_CHANGED',
  TOO_MANY_UNPAID_ORDERS: 'TOO_MANY_UNPAID_ORDERS',
  TABLE_UNAVAILABLE: 'TABLE_UNAVAILABLE',
  /** The counter (6.3, D101): the order moved on (or was cancelled) since the screen read it. */
  ORDER_CHANGED: 'ORDER_CHANGED',
  /** Its 30 minutes to pay are over: the expiry task cancels it (6.6). */
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  /** Ready or completed: only an admin refund undoes it (Q36). */
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  /** Cash in riel with no rate set by an admin. */
  NO_EXCHANGE_RATE: 'NO_EXCHANGE_RATE',
  /** The riel rate changed since the screen showed the amount. */
  EXCHANGE_RATE_CHANGED: 'EXCHANGE_RATE_CHANGED',
} as const

export const orderingClosed = (message: string) => apiError(409, OrderErrorCodes.ORDERING_CLOSED, message)

export const orderNotOrderable = () =>
  apiError(409, OrderErrorCodes.ORDER_NOT_ORDERABLE, 'Something in your order can\'t be ordered right now. Check your order and try again.')

export const pricesChanged = () =>
  apiError(409, OrderErrorCodes.PRICES_CHANGED, 'Prices have changed since you checked. Check the new total and place your order again.')

export const tooManyUnpaidOrders = () =>
  apiError(409, OrderErrorCodes.TOO_MANY_UNPAID_ORDERS, `Pay for your waiting order first: you can have ${MAX_UNPAID_ORDERS} unpaid orders at a time.`)

export const tableUnavailable = () =>
  apiError(409, OrderErrorCodes.TABLE_UNAVAILABLE, 'This table\'s QR code doesn\'t work anymore. Switch to pickup to order.')

/** Unknown, or someone else's: the same answer, so ids reveal nothing. */
export const orderNotFound = () => notFound('This order')

const statusWords: Record<OrderStatus, string> = {
  awaiting_payment: 'waiting for payment',
  preparing: 'paid and being prepared',
  ready: 'ready',
  completed: 'completed',
  cancelled: 'cancelled',
}

/** "Order 042 changed meanwhile: it's paid and being prepared now." The screen reloads it. */
export const orderChanged = (pickupNumber: number, status: OrderStatus) =>
  apiError(409, OrderErrorCodes.ORDER_CHANGED, `Order ${String(pickupNumber).padStart(3, '0')} changed meanwhile: it's ${statusWords[status]} now.`)

export const paymentExpired = () =>
  apiError(409, OrderErrorCodes.PAYMENT_EXPIRED, 'The 30 minutes to pay are over, so this order is cancelled. The customer can place a new one.')

export const orderNotCancellable = () =>
  apiError(409, OrderErrorCodes.ORDER_NOT_CANCELLABLE, 'A ready or completed order can\'t be cancelled at the counter. An admin can refund it.')

export const noExchangeRate = () =>
  apiError(409, OrderErrorCodes.NO_EXCHANGE_RATE, 'No riel rate is set yet. An admin sets it on the Payments page; take dollars or KHQR meanwhile.')

export const exchangeRateChanged = (khrPerUsd: number) =>
  apiError(409, OrderErrorCodes.EXCHANGE_RATE_CHANGED, `The riel rate changed to ៛${khrPerUsd.toLocaleString('en-US')} per dollar. Check the new amount and confirm again.`)

/** A paid order's cancellation must say how the money went back; an unpaid one has none. */
export const returnMethodInvalid = (paid: boolean) =>
  apiError(400, ErrorCodes.VALIDATION_FAILED, paid ? 'Say how the money went back to the customer.' : 'This order wasn\'t paid: there is no money to give back.', {
    fieldErrors: { returnMethod: [paid ? 'Say how the money went back' : 'Nothing was paid'] },
  })

const number = (pickupNumber: number) => String(pickupNumber).padStart(3, '0')

/**
 * The customer's cancel (step 6.5, D106) on an order that moved on: paid meanwhile ("ask at the
 * counter", where staff can still cancel it before it's ready, Q36), or already cancelled.
 */
export function cannotCancelNow(pickupNumber: number, status: OrderStatus) {
  if (status === 'cancelled') return apiError(409, OrderErrorCodes.ORDER_CHANGED, `Order ${number(pickupNumber)} is already cancelled.`)
  return apiError(409, OrderErrorCodes.ORDER_NOT_CANCELLABLE, `Order ${number(pickupNumber)} is paid now, so it can't be cancelled here. Ask at the counter.`)
}
