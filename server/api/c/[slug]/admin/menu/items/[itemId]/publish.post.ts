import { itemVersionSchema } from '#shared/contracts/menu-items'
import { publishItem } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['publish'] })
  const id = readIdParam(event, 'itemId', 'This menu item')
  return publishItem(useDb(), actor, id, await readValidBody(event, itemVersionSchema))
})
