import { createItemLookSchema } from '#shared/contracts/shop-layout'
import { createItemLook } from '#server/features/branches'

/** A new chair or fixture look for the cafe (D273, step 3d). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return createItemLook(useDb(), actor, await readValidBody(event, createItemLookSchema))
})
