import { listPublicBranches } from '~~/server/features/branches'

/**
 * `GET /api/public/branches`: every active branch with whether it's open now, for anyone (D93).
 * The customer site starts here to know which branch's menu to show (launch has one).
 */
export default defineEventHandler(async () => {
  return listPublicBranches(useDb())
})
