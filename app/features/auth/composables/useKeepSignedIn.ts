import type { SessionKept } from '#shared/contracts/account'

/**
 * **Keep me signed in on this device** (D286): asked right after a sign-in to the admin succeeded
 * (password, two-step code or Google). The server decides: an owner's session then lasts 30 days
 * from sign-in instead of one; anyone else, or a request more than 5 minutes after sign-in, is
 * refused with a reason, and the sign-in itself still stands (for a day). No success toast: the
 * person is on their way into the admin.
 */
export function useKeepSignedIn() {
  return useMutation(() => apiFetch<SessionKept>('/me/keep-signed-in', { method: 'POST' }), {
    id: 'auth:keep-signed-in',
    successMessage: false,
    errorMessage: 'You\'re signed in for today only',
  })
}
