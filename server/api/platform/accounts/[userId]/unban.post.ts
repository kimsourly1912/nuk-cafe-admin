import { unbanAccountSchema } from '#shared/contracts/accounts'
import { unbanAccount } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { account: ['ban'] })
  const userId = readIdParam(event, 'userId', 'The account')
  const input = await readValidBody(event, unbanAccountSchema)
  return unbanAccount(useDb(), actor, userId, input)
})
