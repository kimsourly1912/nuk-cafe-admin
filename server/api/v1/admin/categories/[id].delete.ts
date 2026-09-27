import { versionQuery } from '#shared/contracts/menu'
import { deleteCategory } from '../../../../legacy/menu/categories'

/** `?version=` names the version the client read: a stale delete gets 409. */
export default defineEventHandler(async (event) => {
  const staff = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'id', 'The category')
  const { version } = readValidQuery(event, versionQuery)
  await deleteCategory(useDb(), staff, id, version)
  setResponseStatus(event, 204)
  return null
})
