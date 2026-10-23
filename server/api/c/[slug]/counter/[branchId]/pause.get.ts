import { getBranchPause } from '#server/features/branches'

/** The branch's pause (D199): until when, why and by whom; `null` fields when it isn't paused. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { order: ['read'] })
  return getBranchPause(useDb(), actor.tenantId, branchId)
})
