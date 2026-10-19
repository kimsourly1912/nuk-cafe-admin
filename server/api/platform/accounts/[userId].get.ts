import { getOwnerAccount } from '#server/features/tenants'

/** One account a new cafe can be given to, for a page that opens with it chosen; 404 when it can't be (D185). */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['create'] })
  const userId = readIdParam(event, 'userId', 'The account')
  return getOwnerAccount(useDb(), userId)
})
