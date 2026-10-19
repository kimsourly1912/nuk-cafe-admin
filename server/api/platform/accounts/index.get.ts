import { accountListQuerySchema } from '#shared/contracts/accounts'
import { listPlatformAccounts } from '#server/features/identity'

/** Every registered account, newest first: the console's Accounts (step P1, D187). */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { account: ['read'] })
  const query = readValidQuery(event, accountListQuerySchema)
  return listPlatformAccounts(useDb(), query)
})
