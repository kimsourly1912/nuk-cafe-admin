import { describe, expect, it } from 'vitest'
import { googleSignInError, googleSignInErrorCode } from '~/utils/google-sign-in'

describe('Google callback error boundary', () => {
  it.each(['google_password_required', 'GOOGLE_PASSWORD_REQUIRED'])('explains protected accounts for %s', (code) => {
    expect(googleSignInErrorCode(code)).toBe('google_password_required')
    expect(googleSignInError(code)).toBe('Use your email and password for this account. Complete two-step verification if it is enabled.')
  })

  it('keeps the verified-email conflict instruction', () => {
    expect(googleSignInErrorCode('account_not_linked')).toBe('account_not_linked')
    expect(googleSignInError('account_not_linked')).toContain('verify your account email')
  })

  it.each([undefined, null, ['GOOGLE_PASSWORD_REQUIRED'], {}, 'DO_NOT_RENDER_PROVIDER_TEXT', 'access_denied'])('discards unknown or malformed callback values: %j', (code) => {
    expect(googleSignInErrorCode(code)).toBeUndefined()
    expect(googleSignInError(code)).toBe('Google sign-in did not finish. Try again, or use your email and password.')
  })
})
