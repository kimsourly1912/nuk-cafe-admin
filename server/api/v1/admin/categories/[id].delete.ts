import { versionQuery } from '#shared/contracts/menu'
import { deleteCategory } from '../../../../features/menu/categories'

/** `?version=` names the version the client read: a stale delete gets 409. */
export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The category')
  const { version } = readQueryAs(event, versionQuery)
  await deleteCategory(useDb(), staff, id, version)
  setResponseStatus(event, 204)
  return null
})
