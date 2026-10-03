import { reportBranches } from '#server/features/orders'

/** `GET /api/admin/reports/branches` (8.1b, D111): active branches, their zone and today's business date. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { report: ['read'] })
  return reportBranches(useDb(), actor.tenantId)
})
