import { staffListQuerySchema } from '#shared/contracts/staff'
import { listStaff } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { staff: ['read'] })
  const query = readValidQuery(event, staffListQuerySchema)
  return listStaff(useDb(), query)
})
