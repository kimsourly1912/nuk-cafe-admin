import type { AccountProviders } from '#shared/contracts/account'

/** Availability is public, but must be fresh on every entry, including client navigation. */
export function useAccountProviders() {
  const query = useApiQuery('account:providers', () => apiFetch<AccountProviders>('/account/providers'), {
    server: false,
    immediate: false,
    default: () => null,
  })
  const ready = ref(false)
  onMounted(async () => {
    query.clear()
    await query.refresh()
    ready.value = true
  })
  return {
    googleEnabled: computed(() => ready.value && query.data.value?.google === true),
    // Once discovery settles, retries must keep the password form mounted and usable.
    known: computed(() => ready.value),
    error: computed(() => ready.value ? query.error.value : undefined),
    refresh: query.refresh,
  }
}
