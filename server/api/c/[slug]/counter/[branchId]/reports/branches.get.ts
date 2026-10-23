import { reportBranches } from '#server/features/orders'

/** A manager's reports (D198): this branch only, its zone and today's business date. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { report: ['read'] })
  return (await reportBranches(useDb(), actor.tenantId)).filter(branch => branch.id === branchId)
})
