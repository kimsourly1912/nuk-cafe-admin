import { listFinishedToday } from '#server/features/orders'

/** Today's orders that left the queue, completed or cancelled (step 10.2, D117). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['read'] })
  return listFinishedToday(useDb(), actor)
})
