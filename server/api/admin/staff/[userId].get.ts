import { getStaffMember } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { staff: ['read'] })
  const userId = readIdParam(event, 'userId', 'This staff member')
  return getStaffMember(useDb(), userId)
})
