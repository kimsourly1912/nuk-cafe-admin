import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deleteLook } from '#server/features/branches'

/** `?version=`: deletes a custom look no placed table uses (D273); 409 `LOOK_IN_USE` otherwise. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  const lookId = readIdParam(event, 'lookId', 'This look')
  await deleteLook(useDb(), actor, lookId, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
