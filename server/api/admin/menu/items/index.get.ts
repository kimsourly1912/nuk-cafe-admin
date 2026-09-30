import { itemListQuerySchema } from '#shared/contracts/menu-items'
import { listItems } from '#server/features/menu'

/** Menu items, paginated, by category then position (`?search&categoryId&status&page&pageSize`). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return listItems(useDb(), readValidQuery(event, itemListQuerySchema))
})
