import type { CafeProfile } from '#shared/contracts/cafe'

/**
 * A cafe's name and logo (D143), for its menu, admin, counter and the account pages: by default the
 * cafe of the page's address (`useOptionalTenantSlug`), or another one by its address (the account pages
 * name the cafe they came from). Read from `GET /api/cafes/{slug}`, on the server for the
 * server-rendered menu. `name` is '' until it's loaded; `logoUrl` is `null` without a logo. No
 * cafe (the platform's pages, D221): nothing is read, `name` stays '' and `logoUrl` `null`.
 *
 * @example
 * const { name, logoUrl } = useCafe()
 */
export function useCafe(slug?: MaybeRefOrGetter<string | null | undefined>) {
  const tenant = useOptionalTenantSlug()
  const address = computed(() => (slug === undefined ? tenant.value : toValue(slug)) || null)
  // Kept between pages (D173): the app shell's query names no cafe on the platform's pages, so it no
  // longer holds the cafe's profile open while an account page hands over to the cafe's menu.
  // A rename refreshes it (`invalidate('cafe')`).
  const query = useApiQuery(
    () => `cafe:profile:${address.value ?? ''}`,
    async () => (address.value ? apiFetch<CafeProfile>(`/cafes/${encodeURIComponent(address.value)}`) : null),
    { staleTime: REFERENCE_STALE_TIME },
  )
  return {
    ...query,
    name: computed(() => query.data.value?.name ?? ''),
    logoUrl: computed(() => query.data.value?.logoUrl ?? null),
  }
}
