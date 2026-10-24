import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deleteCategory } from '#server/features/menu'

/** `?version=`: deletes an empty archived category that has no history (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'categoryId', 'This category')
  await deleteCategory(useDb(), actor, id, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
