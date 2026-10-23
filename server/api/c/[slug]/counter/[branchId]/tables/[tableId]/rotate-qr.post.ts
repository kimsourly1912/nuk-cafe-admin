import { tableVersionSchema } from '#shared/contracts/branches'
import { rotateTableQr } from '#server/features/branches'

/** A new QR for the table: the printed one stops working. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { table: ['rotateQr'] })
  const tableId = readIdParam(event, 'tableId', 'This table')
  return rotateTableQr(useDb(), actor, branchId, tableId, await readValidBody(event, tableVersionSchema), useTableQr(event))
})
