import type { AccountSession } from '#shared/contracts/account'

/**
 * Where the signed-in account is signed in (Your devices, D243): `GET /api/me/sessions`, newest
 * first, this browser marked. Identity-bound like every query: cleared on a session change.
 */
export function useAccountSessions() {
  return useApiQuery('account-sessions:list', () => apiFetch<AccountSession[]>('/me/sessions'))
}

/**
 * **Sign out other devices** (D243): Better Auth's `/revoke-other-sessions` ends every session of
 * the account but this browser's. Asks first.
 */
export function useSignOutOtherDevices() {
  const authFetch = useAuthRequest()
  return useMutation(() => authFetch('/revoke-other-sessions'), {
    id: 'account-sessions:sign-out-others',
    confirm: {
      title: 'Sign out your other devices?',
      description: 'Every other phone, tablet and computer signed in to this account must sign in again. This one stays signed in.',
      confirmLabel: 'Sign out other devices',
    },
    successMessage: 'Signed out on your other devices',
    errorMessage: 'Your other devices are still signed in',
    invalidate: ['account-sessions'],
  })
}
