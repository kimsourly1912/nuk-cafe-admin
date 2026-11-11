import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deleteItemLook } from '#server/features/branches'

/** `?version=`: deletes a chair or fixture look no placed piece uses (D273, step 3d); 409 `LOOK_IN_USE` otherwise. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  const lookId = readIdParam(event, 'lookId', 'This look')
  await deleteItemLook(useDb(), actor, lookId, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
