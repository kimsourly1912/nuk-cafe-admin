import { ApiError } from './api-error'

/**
 * Two-step sign-in (P1b, D188), shared by every sign-in (the platform console, a cafe's admin and
 * counter, the customer account): an account that set it up gets no session from its password
 * alone. Better Auth answers the password step with `twoFactorRedirect` and a short-lived challenge
 * cookie (10 minutes, 5 tries); the code from the authenticator app, or a backup code, then makes
 * the session. Super admins must set it up (`authorizePlatform`); other accounts may in future.
 */

/** What a password step answered: signed in, or a code is needed first. */
export type PasswordStep = 'signed-in' | 'two-factor'

/** Better Auth's answer to `/sign-in/email` when the account has two-step sign-in. */
export function passwordStepOf(response: unknown): PasswordStep {
  return (response as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect ? 'two-factor' : 'signed-in'
}

export type TwoFactorMethod = 'app' | 'backup'

/** The challenge is over (expired, too many tries): start again from the password. */
export const TWO_FACTOR_RESTART = 'TWO_FACTOR_RESTART'

const RESTART_CODES = new Set(['INVALID_TWO_FACTOR_COOKIE', 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'])

/**
 * Sends the code for the challenge this browser holds; on success the session cookie is set. Throws
 * `ApiError` with a message for the person: a wrong code (try again), a locked account, or
 * `TWO_FACTOR_RESTART` when the challenge is gone.
 */
export async function verifyTwoFactorCode(method: TwoFactorMethod, code: string): Promise<void> {
  const path = method === 'app' ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code'
  try {
    await $fetch(`/api/auth${path}`, { method: 'POST', body: { code: code.replace(/\s+/g, '') }, retry: 0, timeout: 30_000 })
  }
  catch (error) {
    const apiError = ApiError.from(error)
    const fail = (message: string, code = apiError.code) => new ApiError(message, { kind: 'business', status: apiError.status, code, cause: error })
    if (apiError.code && RESTART_CODES.has(apiError.code)) throw fail('This sign-in timed out or had too many tries. Sign in again.', TWO_FACTOR_RESTART)
    if (apiError.code === 'ACCOUNT_TEMPORARILY_LOCKED') throw fail('Too many wrong codes. Wait 15 minutes, then sign in again.', TWO_FACTOR_RESTART)
    if (apiError.code === 'INVALID_CODE') throw fail('That code isn\'t right. Check the time on your phone, and try the newest code.')
    if (apiError.code === 'INVALID_BACKUP_CODE') throw fail('That backup code isn\'t right, or was already used.')
    throw apiError
  }
}
