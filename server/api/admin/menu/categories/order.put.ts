import { reorderCategoriesSchema } from '#shared/contracts/menu-categories'
import { reorderCategories } from '~~/server/features/menu'

/** The new order of one parent's active children; returns them in that order. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const input = await readValidBody(event, reorderCategoriesSchema)
  return reorderCategories(useDb(), actor, input)
})
