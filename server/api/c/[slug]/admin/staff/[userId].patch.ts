import { updateStaffAccessSchema } from '#shared/contracts/staff'
import { updateStaffAccess } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['update'] })
  const userId = readIdParam(event, 'userId', 'This staff member')
  const input = await readValidBody(event, updateStaffAccessSchema)
  // Giving admin access asks for the password (D246); the service knows who is one already.
  return updateStaffAccess(useDb(), actor, userId, input, { confirmAdminGrant: () => requireConfirmation(event) })
})
