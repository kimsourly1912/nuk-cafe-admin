import { listBranchOptions } from '#server/features/branches'

/** Active branches for pickers: `[{ id, name }]`, by name. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['read'] })
  return listBranchOptions(useDb(), actor.tenantId)
})
