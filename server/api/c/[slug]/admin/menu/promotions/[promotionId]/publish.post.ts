import { promotionVersionSchema } from '#shared/contracts/menu-promotions'
import { publishPromotion } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'promotionId', 'This promotion')
  return publishPromotion(useDb(), actor, id, await readValidBody(event, promotionVersionSchema))
})
