import { tableVersionSchema } from '#shared/contracts/branches'
import { rotateTableQr } from '~~/server/features/branches'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  const tableId = readIdParam(event, 'tableId', 'This table')
  return rotateTableQr(useDb(), actor, branchId, tableId, await readValidBody(event, tableVersionSchema), useTableQr(event))
})
