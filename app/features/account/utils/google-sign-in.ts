export const googlePopupChannel = (attempt: string) => `account:google-popup:${attempt}`

/** Never render upstream OAuth error descriptions or arbitrary query values. */
export function googleSignInError(error: unknown): string {
  if (error === 'account_not_linked') return 'Sign in with your email and password and verify your account email before using Google.'
  if (error === 'google_password_required') return 'Use your email and password for this account. Complete two-step verification if it is enabled.'
  return 'Google sign-in did not finish. Try again, or use your email and password.'
}
