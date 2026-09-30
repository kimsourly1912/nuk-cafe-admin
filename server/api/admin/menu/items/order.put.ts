import { reorderItemsSchema } from '#shared/contracts/menu-items'
import { reorderItems } from '#server/features/menu'

/** The new order of a category's items. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  await reorderItems(useDb(), actor, await readValidBody(event, reorderItemsSchema))
  setResponseStatus(event, 204)
  return null
})
