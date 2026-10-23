import { createTableSchema } from '#shared/contracts/branches'
import { createTable } from '#server/features/branches'

export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { table: ['manage'] })
  return createTable(useDb(), actor, branchId, await readValidBody(event, createTableSchema), useTableQr(event))
})
