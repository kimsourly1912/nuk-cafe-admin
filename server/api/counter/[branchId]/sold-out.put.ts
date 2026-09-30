import { setSoldOutSchema } from '#shared/contracts/menu-sold-out'
import { setSoldOut } from '#server/features/menu'

/** `{ variationIds, soldOut }`: switches versions off or back on at this branch. */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { menu: ['setSoldOut'] })
  return setSoldOut(useDb(), actor, await readValidBody(event, setSoldOutSchema))
})
