import { updateLookSchema } from '#shared/contracts/shop-layout'
import { updateLook } from '#server/features/branches'

/** Replaces a custom look at the version read (D273): every table placed with it changes. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { furniture: ['manage'] })
  const lookId = readIdParam(event, 'lookId', 'This look')
  return updateLook(useDb(), actor, lookId, await readValidBody(event, updateLookSchema))
})
