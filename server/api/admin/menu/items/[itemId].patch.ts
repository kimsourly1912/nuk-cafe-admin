import { updateItemSchema } from '#shared/contracts/menu-items'
import { updateItem } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'itemId', 'This menu item')
  return updateItem(useDb(), actor, id, await readValidBody(event, updateItemSchema))
})
