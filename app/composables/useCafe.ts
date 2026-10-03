import type { CafeProfile } from '#shared/contracts/cafe'

/**
 * A cafe's name and logo (D143), for its menu, admin, counter and the account pages: by default the
 * cafe of the page's address (`useTenantSlug`), or another one by its address (the account pages
 * name the cafe they came from). Read from `GET /api/cafes/{slug}`, on the server for the
 * server-rendered menu. `name` is '' until it's loaded; `logoUrl` is `null` without a logo.
 *
 * @example
 * const { name, logoUrl } = useCafe()
 */
export function useCafe(slug?: MaybeRefOrGetter<string>) {
  const tenant = useTenantSlug()
  const address = computed(() => (slug === undefined ? tenant.value : toValue(slug)))
  const query = useApiQuery(() => `cafe:profile:${address.value}`, () => apiFetch<CafeProfile>(`/cafes/${encodeURIComponent(address.value)}`))
  return {
    ...query,
    name: computed(() => query.data.value?.name ?? ''),
    logoUrl: computed(() => query.data.value?.logoUrl ?? null),
  }
}
