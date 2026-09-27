import { updateStaffAccessSchema } from '#shared/contracts/staff'
import { updateStaffAccess } from '~~/server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['update'] })
  const userId = readIdParam(event, 'userId', 'This staff member')
  const input = await readValidBody(event, updateStaffAccessSchema)
  return updateStaffAccess(useDb(), actor, userId, input)
})
