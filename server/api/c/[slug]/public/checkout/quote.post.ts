import { checkoutQuoteSchema } from '#shared/contracts/orders'
import { getCheckoutQuote } from '#server/features/orders'

/**
 * `POST /api/public/checkout/quote` `{ branchId, lines }`: the lines priced as the branch sells them
 * now, with what's wrong per line (D98). Public and read-only: a POST only because the lines don't
 * fit a query string. Placing the order (step 6.2) prices it again.
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  return getCheckoutQuote(useDb(), tenant.id, await readValidBody(event, checkoutQuoteSchema))
})
