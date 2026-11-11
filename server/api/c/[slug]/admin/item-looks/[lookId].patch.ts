import { updateItemLookSchema } from '#shared/contracts/shop-layout'
import { updateItemLook } from '#server/features/branches'

/** Replaces a chair or fixture look at the version read (D273, step 3d): every piece placed with it changes. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  const lookId = readIdParam(event, 'lookId', 'This look')
  return updateItemLook(useDb(), actor, lookId, await readValidBody(event, updateItemLookSchema))
})
