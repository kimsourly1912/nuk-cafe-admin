/** The popup owns OAuth; each initiating workspace owns its safe return destination. */
export function useGoogleAuthRequest() {
  const authFetch = useAuthRequest()
  return async (_from?: unknown, popupId?: string) => {
    const success = new URL('/google-callback', window.location.origin)
    if (popupId) success.searchParams.set('googlePopup', popupId)
    const failure = new URL(success)
    success.searchParams.set('google', '1')
    const result = await authFetch<{ url?: string }>('/sign-in/social', {
      provider: 'google', disableRedirect: true,
      callbackURL: success.toString(), errorCallbackURL: failure.toString(),
    })
    const destination = result.url ? new URL(result.url) : null
    if (destination?.origin !== 'https://accounts.google.com') {
      throw new ApiError('Google sign-in is unavailable. Try again shortly.', { kind: 'business', status: 0 })
    }
    return destination.toString()
  }
}
