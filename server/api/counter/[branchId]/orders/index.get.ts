import { listCounterQueue } from '~~/server/features/orders'

/** The branch's orders still in play (to pay, preparing, ready), the riel rate and the server's clock (D101). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['read'] })
  return listCounterQueue(useDb(), actor)
})
