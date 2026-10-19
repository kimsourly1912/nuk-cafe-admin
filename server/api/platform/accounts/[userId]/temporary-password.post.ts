import { accountPasswordSchema } from '#shared/contracts/accounts'
import { setTemporaryPassword } from '#server/features/identity'

/** A new temporary password, returned once. */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { account: ['reset-password'] })
  const userId = readIdParam(event, 'userId', 'The account')
  const input = await readValidBody(event, accountPasswordSchema)
  return setTemporaryPassword(useDb(), actor, userId, input)
})
