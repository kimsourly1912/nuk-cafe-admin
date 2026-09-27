import { counterMenuQuerySchema } from '#shared/contracts/menu-sold-out'
import { listCounterMenu } from '~~/server/features/menu'

/** The counter's menu: what customers can order, with this branch's sold-out switches. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  await requireBranchPermission(event, branchId, { menu: ['read'] })
  return listCounterMenu(useDb(), branchId, readValidQuery(event, counterMenuQuerySchema))
})
