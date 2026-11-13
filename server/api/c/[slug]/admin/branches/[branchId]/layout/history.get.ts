import { listLayoutHistory } from '#server/features/branches'

/** The layout's version history (ISS-027): the versions with a snapshot, newest first. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  return listLayoutHistory(useDb(), actor.tenantId, branchId)
})
