import { categoryListQuerySchema } from '#shared/contracts/menu-categories'
import { listCategories } from '#server/features/menu'

/** The category tree, in order (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  const query = readValidQuery(event, categoryListQuerySchema)
  return listCategories(useDb(), query)
})
