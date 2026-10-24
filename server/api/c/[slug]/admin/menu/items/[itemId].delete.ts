import { itemVersionSchema } from '#shared/contracts/menu-items'
import { deleteItem } from '#server/features/menu'

/** `{ version }`: deletes a draft or archived item that was never ordered (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'itemId', 'This menu item')
  await deleteItem(useDb(), actor, id, await readValidBody(event, itemVersionSchema))
  setResponseStatus(event, 204)
  return null
})
