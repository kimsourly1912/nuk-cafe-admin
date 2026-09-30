import { disableStaffSchema } from '#shared/contracts/staff'
import { disableStaff } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['disable'] })
  const userId = readIdParam(event, 'userId', 'This staff member')
  const input = await readValidBody(event, disableStaffSchema)
  await disableStaff(useDb(), actor, userId, input)
  setResponseStatus(event, 204)
  return null
})
