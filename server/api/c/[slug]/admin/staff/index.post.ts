import { createStaffSchema } from '#shared/contracts/staff'
import { createStaff } from '#server/features/identity'

/** 201 with the temporary password, shown to the admin once (null for an existing account). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['create'] })
  const input = await readValidBody(event, createStaffSchema)
  // Giving someone admin access (D246).
  if (input.admin) await requireConfirmation(event)
  const created = await createStaff(useDb(), actor, input)
  setResponseStatus(event, 201)
  return created
})
