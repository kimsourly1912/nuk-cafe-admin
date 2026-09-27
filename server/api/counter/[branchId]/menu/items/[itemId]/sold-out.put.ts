import { setSoldOutSchema } from '#shared/contracts/menu-sold-out'
import { setSoldOut } from '~~/server/features/menu'

/** Switches an item's variations sold out (or back) in this branch: `{ soldOut, variationIds? }`. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { menu: ['setSoldOut'] })
  const itemId = readIdParam(event, 'itemId', 'This menu item')
  return setSoldOut(useDb(), actor, itemId, await readValidBody(event, setSoldOutSchema))
})
