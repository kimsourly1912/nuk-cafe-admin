import { createTenantSchema } from '#shared/contracts/tenants'
import { createTenant } from '#server/features/tenants'

/** 201 with the first owner's temporary password, shown once (null for an existing account). */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { tenant: ['create'] })
  const input = await readValidBody(event, createTenantSchema)
  const created = await createTenant(useDb(), actor, input)
  setResponseStatus(event, 201)
  return created
})
