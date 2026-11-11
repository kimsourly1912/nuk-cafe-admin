import { listItemLooks } from '#server/features/branches'

/** The cafe's chair and fixture looks by name (D273, step 3d), each with how many placed pieces use it. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return listItemLooks(useDb(), actor.tenantId)
})
