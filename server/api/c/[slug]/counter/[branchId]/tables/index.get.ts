import { tableListQuerySchema } from '#shared/contracts/branches'
import { listTables } from '#server/features/branches'

/** A manager's tables (D198): the branch's dining tables with their QR links, like the admin's. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { table: ['manage'] })
  return listTables(useDb(), actor.tenantId, branchId, readValidQuery(event, tableListQuerySchema), useTableQr(event))
})
