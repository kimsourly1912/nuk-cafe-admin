import { createLayoutGroupSchema } from '#shared/contracts/shop-layout'
import { createGroup } from '#server/features/branches'

/** Saves pieces and walls as a group for the cafe (plan Phase 5, D284). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return createGroup(useDb(), actor, await readValidBody(event, createLayoutGroupSchema))
})
