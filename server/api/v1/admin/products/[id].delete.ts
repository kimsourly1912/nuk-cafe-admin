import { versionQuery } from '#shared/contracts/menu'
import { deleteProduct } from '../../../../features/menu/products'

/** `?version=` names the version the client read: a stale delete gets 409. */
export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The menu item')
  const { version } = readQueryAs(event, versionQuery)
  await deleteProduct(useDb(), staff, id, version)
  setResponseStatus(event, 204)
  return null
})
