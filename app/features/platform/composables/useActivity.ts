import type { ActivityEntry, ActivityQuery, PlatformOverview } from '#shared/contracts/platform-activity'
import type { PlatformHealth } from '#shared/contracts/platform-health'
import type { PlatformAccountSummary } from '#shared/contracts/accounts'
import type { Page } from '#shared/contracts/common'
import type { TenantDetail } from '#shared/contracts/tenants'
import { ACTIVITY_PATH } from './usePlatformSession'

/** The console's Overview and Activity (step P3, D191). */

/** Activity for one cafe: its page's "See all". */
export const cafeActivityPath = (cafeId: string) => `${ACTIVITY_PATH}?tenantId=${encodeURIComponent(cafeId)}`

/** The Overview's counts, in one read. */
export function usePlatformOverview() {
  return useApiQuery('platform:overview', () => apiFetch<PlatformOverview>('/platform/overview'))
}

/** The platform team's actions, a page at a time. Refetches whenever `query` changes. */
export function useActivityList(query: MaybeRefOrGetter<Partial<ActivityQuery>>) {
  return useApiQuery('platform:activity', () => apiFetch<Page<ActivityEntry>>('/platform/activity', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** The latest platform actions on one cafe, for its page. */
export function useCafeActivity(cafeId: MaybeRefOrGetter<string>, pageSize = 5) {
  return useApiQuery(`platform:cafe-activity:${toValue(cafeId)}`, () =>
    apiFetch<Page<ActivityEntry>>('/platform/activity', { query: { tenantId: toValue(cafeId), pageSize } }))
}

/** The super admins, for Activity's "Who" filter: a handful of accounts. */
export function useSuperadmins() {
  return useApiQuery('platform:superadmins', () =>
    apiFetch<Page<PlatformAccountSummary>>('/platform/accounts', { query: { kind: 'superadmin', pageSize: 100 } }))
}

/** The cafe Activity is filtered to, for its name; `null` without one. */
export function useActivityCafe(cafeId: () => string | undefined) {
  return useApiQuery('platform:activity-cafe', async () => {
    const id = cafeId()
    return id ? apiFetch<TenantDetail>(`/platform/tenants/${encodeURIComponent(id)}`) : null
  }, { watch: [cafeId] })
}

/** System health (P4, D192): counts and dates, one read. */
export function usePlatformHealth() {
  return useApiQuery('platform:health', () => apiFetch<PlatformHealth>('/platform/health'))
}
