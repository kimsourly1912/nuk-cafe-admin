import { createBranchSchema } from '#shared/contracts/branches'
import { createBranch } from '#server/features/branches'

/** Adds a branch to the cafe (owners, D197): 201 with its settings; at most `MAX_BRANCHES`. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['create'] })
  const branch = await createBranch(useDb(), actor, await readValidBody(event, createBranchSchema))
  setResponseStatus(event, 201)
  return branch
})
