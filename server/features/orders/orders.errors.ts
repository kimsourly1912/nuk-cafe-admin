import { MAX_UNPAID_ORDERS } from '#shared/contracts/orders'
import { apiError, notFound } from '../../utils/errors'

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
