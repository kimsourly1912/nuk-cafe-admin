import { itemVersionSchema } from '#shared/contracts/menu-items'
import { unpublishItem } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['publish'] })
  const id = readIdParam(event, 'itemId', 'This menu item')
  return unpublishItem(useDb(), actor, id, await readValidBody(event, itemVersionSchema))
})
