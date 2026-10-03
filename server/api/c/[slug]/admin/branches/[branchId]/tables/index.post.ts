import { createTableSchema } from '#shared/contracts/branches'
import { createTable } from '#server/features/branches'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  return createTable(useDb(), actor, branchId, await readValidBody(event, createTableSchema), useTableQr(event))
})
