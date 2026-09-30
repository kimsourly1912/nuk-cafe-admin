import { tableListQuerySchema } from '#shared/contracts/branches'
import { listTables } from '#server/features/branches'

/** The branch's dining tables by label, with their QR links (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  return listTables(useDb(), branchId, readValidQuery(event, tableListQuerySchema), useTableQr(event))
})
