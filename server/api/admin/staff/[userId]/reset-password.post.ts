import { resetStaffPasswordSchema } from '#shared/contracts/staff'
import { resetStaffPassword } from '~~/server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['reset-password'] })
  const userId = readIdParam(event, 'userId', 'This staff member')
  const input = await readValidBody(event, resetStaffPasswordSchema)
  return resetStaffPassword(useDb(), actor, userId, input)
})
