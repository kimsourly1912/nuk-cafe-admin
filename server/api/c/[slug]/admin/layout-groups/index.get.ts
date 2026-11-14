import { listGroups } from '#server/features/branches'

/** The cafe's saved groups by name (plan Phase 5, D284): pieces and walls to place again. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return listGroups(useDb(), actor.tenantId)
})
