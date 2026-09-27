import { versionQuery } from '#shared/contracts/menu'
import { deleteProduct } from '../../../../legacy/menu/products'

/** `?version=` names the version the client read: a stale delete gets 409. */
export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = readIdParam(event, 'id', 'The menu item')
  const { version } = readValidQuery(event, versionQuery)
  await deleteProduct(useDb(), staff, id, version)
  setResponseStatus(event, 204)
  return null
})
