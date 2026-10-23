import { resumeBranch } from '#server/features/branches'

/** Takes online orders again (managers, owners; D199). */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { branch: ['pause'] })
  return resumeBranch(useDb(), actor, branchId)
})
