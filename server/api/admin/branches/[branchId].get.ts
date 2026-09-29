import { getBranchSettings } from '~~/server/features/branches'

/** A branch's settings and weekly hours, and whether it's open now (D91). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { branch: ['read'] })
  return getBranchSettings(useDb(), readIdParam(event, 'branchId', 'This branch'))
})
