import { getPlatformAccount } from '#server/features/identity'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { account: ['read'] })
  const userId = readIdParam(event, 'userId', 'The account')
  return getPlatformAccount(useDb(), userId)
})
