import { createStaffSchema } from '#shared/contracts/staff'
import { createStaff } from '#server/features/identity'

/** 201 with the temporary password, shown to the admin once (null for an existing account). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { staff: ['create'] })
  const input = await readValidBody(event, createStaffSchema)
  const created = await createStaff(useDb(), actor, input)
  setResponseStatus(event, 201)
  return created
})
