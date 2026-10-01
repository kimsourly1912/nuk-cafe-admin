import { itemVersionSchema } from '#shared/contracts/menu-items'
import { archiveItem } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'itemId', 'This menu item')
  return archiveItem(useDb(), actor, id, await readValidBody(event, itemVersionSchema))
})
