import { createLookSchema } from '#shared/contracts/shop-layout'
import { createLook } from '#server/features/branches'

/** A new custom table look for the cafe (D273). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  return createLook(useDb(), actor, await readValidBody(event, createLookSchema))
})
