import type { AccountListQuery, AccountPasswordInput, AccountTemporaryPassword, BanAccountInput, PlatformAccountDetail, PlatformAccountSummary, TurnOffTwoFactorInput } from '#shared/contracts/accounts'
import type { Page } from '#shared/contracts/common'

/** The console's Accounts (step P1, D187). */
export const ACCOUNTS_PATH = '/platform/accounts'
export const accountPath = (id: string) => `${ACCOUNTS_PATH}/${id}`

/** Banning, unbanning, signing out, a temporary password and two-step sign-in for one account never overlap. */
const lockOf = (id: string) => `account:${id}`

/** Every registered account, a page at a time. Refetches whenever `query` changes. */
export function useAccountList(query: MaybeRefOrGetter<Partial<AccountListQuery>>) {
  return useApiQuery('platform:accounts', () => apiFetch<Page<PlatformAccountSummary>>('/platform/accounts', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** One account: its cafes, sessions and ban. */
export function useAccount(id: MaybeRefOrGetter<string>) {
  return useApiQuery(`platform:account:${toValue(id)}`, () => apiFetch<PlatformAccountDetail>(`/platform/accounts/${toValue(id)}`))
}

/** The console's changes to accounts; state is shared app-wide by mutation id. */
export function useAccountMutations() {
  const ban = useMutation(
    ({ account, body }: { account: PlatformAccountDetail, body: BanAccountInput }) =>
      apiFetch<PlatformAccountDetail>(`/platform/accounts/${account.id}/ban`, { method: 'POST', body }),
    {
      id: 'platform:ban-account',
      key: ({ account }) => account.id,
      lock: ({ account }) => lockOf(account.id),
      successMessage: (_, { account }) => `${account.name} is banned`,
      errorMessage: ({ account }) => `Could not ban ${account.name}`,
      invalidate: ['platform'],
    },
  )

  const unban = useMutation(
    (account: PlatformAccountDetail) => apiFetch<PlatformAccountDetail>(`/platform/accounts/${account.id}/unban`, { method: 'POST', body: { version: account.version } }),
    {
      id: 'platform:unban-account',
      key: account => account.id,
      lock: account => lockOf(account.id),
      confirm: account => ({
        title: `Unban ${account.name}?`,
        description: 'They can sign in again with their current password.',
        confirmLabel: 'Unban',
      }),
      successMessage: (_, account) => `${account.name} can sign in again`,
      errorMessage: account => `Could not unban ${account.name}`,
      invalidate: ['platform'],
    },
  )

  const signOut = useMutation(
    (account: PlatformAccountDetail) => apiFetch<PlatformAccountDetail>(`/platform/accounts/${account.id}/sign-out`, { method: 'POST' }),
    {
      id: 'platform:sign-out-account',
      key: account => account.id,
      lock: account => lockOf(account.id),
      confirm: account => ({
        title: `Sign ${account.name} out everywhere?`,
        description: 'Every device they use is signed out. They can sign in again with their password.',
        confirmLabel: 'Sign out everywhere',
      }),
      successMessage: (_, account) => `${account.name} is signed out everywhere`,
      errorMessage: account => `Could not sign ${account.name} out`,
      invalidate: ['platform'],
    },
  )

  const temporaryPassword = useMutation(
    ({ account, body }: { account: PlatformAccountDetail, body: AccountPasswordInput }) =>
      apiFetch<AccountTemporaryPassword>(`/platform/accounts/${account.id}/temporary-password`, { method: 'POST', body }),
    {
      id: 'platform:account-temporary-password',
      key: ({ account }) => account.id,
      lock: ({ account }) => lockOf(account.id),
      // The dialog shows the password: a toast would only repeat it.
      successMessage: false,
      errorMessage: ({ account }) => `Could not set a temporary password for ${account.name}`,
      invalidate: ['platform'],
    },
  )

  // A lost authenticator and backup codes (QA1, D247). The server asks the super admin to confirm
  // their own password first (D246): `apiFetch` shows "Confirm it's you" and sends it again.
  const turnOffTwoFactor = useMutation(
    ({ account, body }: { account: PlatformAccountDetail, body: TurnOffTwoFactorInput }) =>
      apiFetch<PlatformAccountDetail>(`/platform/accounts/${account.id}/two-factor-off`, { method: 'POST', body }),
    {
      id: 'platform:account-two-factor-off',
      key: ({ account }) => account.id,
      lock: ({ account }) => lockOf(account.id),
      successMessage: (_, { account }) => `Two-step sign-in is off for ${account.name}`,
      errorMessage: ({ account }) => `Could not turn off two-step sign-in for ${account.name}`,
      invalidate: ['platform'],
    },
  )

  return {
    ban,
    unban,
    signOut,
    temporaryPassword,
    turnOffTwoFactor,
    /** Any change in flight for this account: its actions wait. */
    isBusy: (id: string) => ban.isPending(id) || unban.isPending(id) || signOut.isPending(id) || temporaryPassword.isPending(id) || turnOffTwoFactor.isPending(id),
  }
}
