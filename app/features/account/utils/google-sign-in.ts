export const googlePopupChannel = (attempt: string) => `account:google-popup:${attempt}`

/** Only known codes cross the popup channel; Better Auth forwards APIError codes verbatim. */
export function googleSignInErrorCode(error: unknown) {
  if (error === 'account_not_linked') return 'account_not_linked'
  if (error === 'google_password_required' || error === 'GOOGLE_PASSWORD_REQUIRED') return 'google_password_required'
  return undefined
}

/** Never render upstream OAuth error descriptions or arbitrary query values. */
export function googleSignInError(error: unknown): string {
  const code = googleSignInErrorCode(error)
  if (code === 'account_not_linked') return 'Sign in with your email and password and verify your account email before using Google.'
  if (code === 'google_password_required') return 'Use your email and password for this account. Complete two-step verification if it is enabled.'
  return 'Google sign-in did not finish. Try again, or use your email and password.'
}
