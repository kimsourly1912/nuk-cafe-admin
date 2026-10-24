import { deleteVersionQuerySchema } from '#shared/contracts/common'
import { deleteTable } from '#server/features/branches'

/** `?version=`: deletes an archived table no order was placed at (D200); owners only, not on the counter. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  const tableId = readIdParam(event, 'tableId', 'This table')
  await deleteTable(useDb(), actor, branchId, tableId, readValidQuery(event, deleteVersionQuerySchema))
  setResponseStatus(event, 204)
  return null
})
