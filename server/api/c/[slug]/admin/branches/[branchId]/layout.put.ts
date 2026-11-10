import { LAYOUT_MAX_BODY_BYTES, saveLayoutSchema } from '#shared/contracts/shop-layout'
import { saveLayout } from '#server/features/branches'

/** Saves the whole shop layout from the version read (D273); answers the layout as saved. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  return saveLayout(useDb(), actor, branchId, await readValidBody(event, saveLayoutSchema, LAYOUT_MAX_BODY_BYTES))
})
