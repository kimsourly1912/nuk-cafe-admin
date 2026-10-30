import { verifyTwoFactorCode } from '~/utils/two-factor'

/** What the setup shows once the password is right: the QR code's URI and the backup codes, once. */
export interface TwoFactorSetup {
  totpURI: string
  backupCodes: string[]
}

/** Better Auth's "wrong password" as the person reads it. */
function passwordError(error: unknown): ApiError {
  const apiError = ApiError.from(error)
  if (apiError.code !== 'INVALID_PASSWORD') return apiError
  const message = 'Your password is incorrect.'
  return new ApiError(message, { kind: 'business', status: apiError.status, code: apiError.code, fieldErrors: { password: [message] }, cause: error })
}

/**
 * Turning two-step sign-in on and off for the signed-in account (D188, D242), on Better Auth's
 * `twoFactor` endpoints: the console's setup and the account security page of a cafe's admin and
 * counter. The caller updates its own session afterwards (each surface keeps its own).
 */
export function useTwoFactorSettings() {
  const authFetch = useAuthRequest()

  /**
   * The password step of setup: a new secret and backup codes. Not on until `confirm` gets a right
   * code. Throws `ApiError` ("Your password is incorrect." on the `password` field).
   */
  async function start(password: string): Promise<TwoFactorSetup> {
    try {
      return await authFetch<TwoFactorSetup>('/two-factor/enable', { password, method: 'totp' })
    }
    catch (error) {
      throw passwordError(error)
    }
  }

  /**
   * A code from the app turns it on. The server signs the account out on its other devices and
   * gives this browser a new session. Throws `ApiError`.
   */
  async function confirm(code: string) {
    await verifyTwoFactorCode('app', code)
  }

  /**
   * Turns it off with the password; this browser gets a new session, the others keep theirs. A super
   * admin is refused (`TWO_FACTOR_REQUIRED`: the console requires it). Throws `ApiError`.
   */
  async function turnOff(password: string) {
    try {
      await authFetch('/two-factor/disable', { password })
    }
    catch (error) {
      throw passwordError(error)
    }
  }

  return { start, confirm, turnOff }
}
