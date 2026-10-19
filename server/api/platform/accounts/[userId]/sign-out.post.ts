import { signOutAccount } from '#server/features/identity'

/** Ends every session the account has. No body: nothing about the account changes. */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { account: ['sign-out'] })
  const userId = readIdParam(event, 'userId', 'The account')
  return signOutAccount(useDb(), actor, userId)
})
