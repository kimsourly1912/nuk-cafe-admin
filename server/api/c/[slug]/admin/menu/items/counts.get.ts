import { itemCountsQuerySchema } from '#shared/contracts/menu-items'
import { countItems } from '#server/features/menu'

/** Per status, the items the list's filters match and those without a photo (`?search&categoryId`). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return countItems(useDb(), actor.tenantId, readValidQuery(event, itemCountsQuerySchema))
})
