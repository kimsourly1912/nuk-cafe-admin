import { turnOffTwoFactorSchema } from '#shared/contracts/accounts'
import { turnOffTwoFactor } from '#server/features/identity'

/**
 * `{ version, reason }`: turns off two-step sign-in for someone who lost the authenticator and the
 * backup codes (QA1, D247), signing them out everywhere. It removes a protection, so the super admin
 * confirms their own password first (D246).
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { account: ['two-factor-off'] })
  await requireConfirmation(event)
  const userId = readIdParam(event, 'userId', 'The account')
  const input = await readValidBody(event, turnOffTwoFactorSchema)
  return turnOffTwoFactor(useDb(), actor, userId, input)
})
