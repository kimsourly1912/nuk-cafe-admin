import { resumeBranch } from '#server/features/branches'

/** An owner takes the branch's online orders again from its admin page (D199); pausing is the counter's. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  return resumeBranch(useDb(), actor, readIdParam(event, 'branchId', 'This branch'))
})
