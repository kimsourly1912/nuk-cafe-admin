import { banAccountSchema } from '#shared/contracts/accounts'
import { banAccount } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { account: ['ban'] })
  const userId = readIdParam(event, 'userId', 'The account')
  const input = await readValidBody(event, banAccountSchema)
  return banAccount(useDb(), actor, userId, input)
})
