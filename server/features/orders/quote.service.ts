import type { CheckoutQuote, CheckoutQuoteInput } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { getPublicMenu } from '#server/features/menu'
import { quoteOrder } from './quote.rules'

/**
 * The checkout quote (step 6.1, D98): the branch's menu at `now`, then each line priced against
 * it. Reads only, so it's public: prices are public already, and placing the order (step 6.2)
 * prices it again for the signed-in customer. An unknown or archived branch is 404.
 */
export async function getCheckoutQuote(db: Db, tenantId: string, input: CheckoutQuoteInput, now = new Date()): Promise<CheckoutQuote> {
  const menu = await getPublicMenu(db, tenantId, { branchId: input.branchId }, now)
  return quoteOrder(menu, input.lines)
}
