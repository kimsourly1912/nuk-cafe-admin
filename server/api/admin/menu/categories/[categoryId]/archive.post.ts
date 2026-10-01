import { categoryStatusChangeSchema } from '#shared/contracts/menu-categories'
import { archiveCategory } from '#server/features/menu'

/** Archives the category and its sub-categories. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'categoryId', 'This category')
  const input = await readValidBody(event, categoryStatusChangeSchema)
  return archiveCategory(useDb(), actor, id, input)
})
