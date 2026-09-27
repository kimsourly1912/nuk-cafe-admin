import { listSoldOut } from '~~/server/features/menu'

/** What's sold out at this branch now. */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { menu: ['read'] })
  return listSoldOut(useDb(), actor)
})
