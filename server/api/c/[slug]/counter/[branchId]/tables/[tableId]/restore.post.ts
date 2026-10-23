import { tableVersionSchema } from '#shared/contracts/branches'
import { restoreTable } from '#server/features/branches'

export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { table: ['manage'] })
  const tableId = readIdParam(event, 'tableId', 'This table')
  return restoreTable(useDb(), actor, branchId, tableId, await readValidBody(event, tableVersionSchema), useTableQr(event))
})
