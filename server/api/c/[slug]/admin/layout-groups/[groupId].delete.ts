import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deleteGroup } from '#server/features/branches'

/** `?version=`: deletes a saved group (plan Phase 5, D284); layouts holding its copies keep them. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  const groupId = readIdParam(event, 'groupId', 'This group')
  await deleteGroup(useDb(), actor, groupId, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
