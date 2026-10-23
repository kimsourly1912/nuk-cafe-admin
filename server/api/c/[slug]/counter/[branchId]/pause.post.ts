import { pauseBranchSchema } from '#shared/contracts/branches'
import { pauseBranch } from '#server/features/branches'

/** `{ for: '15m' | '30m' | '1h' | 'closing', reason? }`: pauses online orders (managers, owners; D199). */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { branch: ['pause'] })
  return pauseBranch(useDb(), actor, branchId, await readValidBody(event, pauseBranchSchema))
})
