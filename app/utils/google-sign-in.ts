export const googlePopupChannel = (attempt: string) => `account:google-popup:${attempt}`

const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

/** Centered on the browser window, which also keeps it on that window's monitor. */
export function googlePopupFeatures(opener: Pick<Window, 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'>) {
  const left = Math.round(opener.screenX + (opener.outerWidth - POPUP_WIDTH) / 2)
  const top = Math.round(opener.screenY + (opener.outerHeight - POPUP_HEIGHT) / 2)
  return `popup,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`
}

/** Only known errors cross the channel; native hook codes may retain their uppercase spelling. */
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

/** What the sign-in page needs to carry on when the browser refuses to close the callback window. */
export function googleCallbackFallback(query: Record<string, unknown>): Record<string, string> {
  if (query.error) return { error: googleSignInErrorCode(query.error) ?? 'google_failed' }
  if (query.googleTwoFactor === '1') return { googleTwoFactor: '1' }
  if (query.google === '1') return { google: '1' }
  return {}
}
