import { createPromotionSchema } from '#shared/contracts/menu-promotions'
import { createPromotion } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const promotion = await createPromotion(useDb(), actor, await readValidBody(event, createPromotionSchema))
  setResponseStatus(event, 201)
  return promotion
})
