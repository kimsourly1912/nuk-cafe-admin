import { updateCategorySchema } from '#shared/contracts/menu-categories'
import { updateCategory } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'categoryId', 'This category')
  const input = await readValidBody(event, updateCategorySchema)
  return updateCategory(useDb(), actor, id, input)
})
