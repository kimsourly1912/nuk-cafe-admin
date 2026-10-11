import { updatePromotionSchema } from '#shared/contracts/menu-promotions'
import { updatePromotion } from '#server/features/menu'

/** Replaces the whole promotion, its items, categories and branches (the form saves them together). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'promotionId', 'This promotion')
  return updatePromotion(useDb(), actor, id, await readValidBody(event, updatePromotionSchema))
})
