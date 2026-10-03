import { restoreCategorySchema } from '#shared/contracts/menu-categories'
import { restoreCategory } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'categoryId', 'This category')
  const input = await readValidBody(event, restoreCategorySchema)
  return restoreCategory(useDb(), actor, id, input)
})
