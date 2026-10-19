import { ownerSearchQuerySchema } from '#shared/contracts/tenants'
import { searchOwnerAccounts } from '#server/features/tenants'

/** A bounded search of the accounts a new cafe can be given to: New cafe's "Use existing account" (D185). */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['create'] })
  const query = readValidQuery(event, ownerSearchQuerySchema)
  return searchOwnerAccounts(useDb(), query)
})
