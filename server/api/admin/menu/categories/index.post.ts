import { createCategorySchema } from '#shared/contracts/menu-categories'
import { createCategory } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const input = await readValidBody(event, createCategorySchema)
  const category = await createCategory(useDb(), actor, input)
  setResponseStatus(event, 201)
  return category
})
