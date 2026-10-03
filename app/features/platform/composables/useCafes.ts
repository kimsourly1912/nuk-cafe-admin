import type { Page } from '#shared/contracts/common'
import type { ChangeTenantSlugInput, CreatedTenant, CreateTenantInput, SuspendTenantInput, TenantDetail, TenantListQuery, TenantSummary } from '#shared/contracts/tenants'

/** Pausing, resuming and moving one cafe must never overlap: all take this record lock. */
const lockOf = (id: string) => `cafe:${id}`

/** The cafes, a page at a time. Refetches whenever `query` changes. */
export function useCafeList(query: MaybeRefOrGetter<Partial<TenantListQuery>>) {
  return useApiQuery('platform:cafes', () => apiFetch<Page<TenantSummary>>('/platform/tenants', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** One cafe: its usage, owners and former addresses. */
export function useCafe(id: MaybeRefOrGetter<string>) {
  return useApiQuery(`platform:cafe:${toValue(id)}`, () => apiFetch<TenantDetail>(`/platform/tenants/${toValue(id)}`))
}

/**
 * The console's changes. State is shared app-wide by mutation id, so a page knows a cafe is being
 * changed even after the dialog that started it closed.
 */
export function useCafeMutations() {
  const create = useMutation(
    (body: CreateTenantInput) => apiFetch<CreatedTenant>('/platform/tenants', { method: 'POST', body }),
    {
      id: 'platform:create-cafe',
      // The address identifies the submission: a double submit is skipped.
      key: body => body.slug,
      successMessage: (_, body) => `${body.name} created`,
      errorMessage: body => `Could not create ${body.name}`,
      invalidate: ['platform'],
    },
  )

  const suspend = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: SuspendTenantInput }) =>
      apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/suspend`, { method: 'POST', body }),
    {
      id: 'platform:suspend-cafe',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (_, { cafe }) => `${cafe.name} is paused`,
      errorMessage: ({ cafe }) => `Could not pause ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  const resume = useMutation(
    (cafe: TenantDetail) => apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/resume`, { method: 'POST', body: { version: cafe.version } }),
    {
      id: 'platform:resume-cafe',
      key: cafe => cafe.id,
      lock: cafe => lockOf(cafe.id),
      confirm: cafe => ({
        title: `Resume ${cafe.name}?`,
        description: 'Customers can order again, and the cafe\'s staff can use the admin and the counter.',
        confirmLabel: 'Resume',
      }),
      successMessage: (_, cafe) => `${cafe.name} is open again`,
      errorMessage: cafe => `Could not resume ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  const changeSlug = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: ChangeTenantSlugInput }) =>
      apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/slug`, { method: 'POST', body }),
    {
      id: 'platform:change-cafe-address',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (updated, { cafe }) => `${cafe.name} moved to /c/${updated.slug}`,
      errorMessage: ({ cafe }) => `Could not change ${cafe.name}'s address`,
      invalidate: ['platform'],
    },
  )

  return {
    create,
    suspend,
    resume,
    changeSlug,
    /** Any change in flight for this cafe: its actions wait. */
    isBusy: (id: string) => suspend.isPending(id) || resume.isPending(id) || changeSlug.isPending(id),
  }
}

/** How many cafes each status tab holds: one count request per status (page size 1). */
export function useCafeCounts() {
  const count = (status?: string) => apiFetch<Page<TenantSummary>>('/platform/tenants', { query: { pageSize: 1, ...(status && { status }) } }).then(page => page.total)
  return useApiQuery('platform:cafe-counts', async () => {
    const [all, active, suspended] = await Promise.all([count(), count('active'), count('suspended')])
    return { all, active, suspended }
  })
}
