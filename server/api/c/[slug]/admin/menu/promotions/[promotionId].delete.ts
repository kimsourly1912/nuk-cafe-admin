import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deletePromotion } from '#server/features/menu'

/** `?version=`: deletes a draft (a published promotion is ended instead). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'promotionId', 'This promotion')
  await deletePromotion(useDb(), actor, id, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
