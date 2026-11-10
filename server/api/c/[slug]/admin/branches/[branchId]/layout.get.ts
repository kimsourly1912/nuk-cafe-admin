import { getLayout } from '#server/features/branches'

/** The branch's shop layout and its active tables (D273); an empty layout at version 0 before the first save. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  return getLayout(useDb(), actor.tenantId, branchId)
})
