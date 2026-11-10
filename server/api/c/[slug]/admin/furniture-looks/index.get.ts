import { listLooks } from '#server/features/branches'

/** The cafe's custom table looks by name (D273), each with how many placed tables use it. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return listLooks(useDb(), actor.tenantId)
})
