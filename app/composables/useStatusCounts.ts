import type { WatchSource } from 'vue'

export type StatusCounts = Record<Status, number> & { all: number }

/**
 * How many records each status has, for `<StatusTabs>` ("All 24 · Active 20 · Inactive 4").
 *
 * The APIs have no count endpoint, so this asks the list endpoint twice with `size: 1` and reads
 * `totalElements`. "All" is the sum (every record is ACTIVE or INACTIVE). Pass the other filters
 * (not status, not page) as `filters`, so the counts match what the tabs would show. Refreshed by
 * `invalidate(feature)` like any query of the feature.
 *
 * Lists loaded whole (e.g. categories) count on the client instead.
 *
 * @example
 * const counts = useStatusCounts('schedules', () => ({ search: filters.search }),
 *   (query, status) => unwrap(getPage({ query: { ...query, status, size: 1 } })).then(p => p.totalElements ?? 0))
 */
export function useStatusCounts<Q extends Record<string, unknown>>(
  feature: string,
  filters: () => Q,
  total: (filters: Q, status: Status) => Promise<number>,
) {
  const { data } = useApiQuery<StatusCounts>(
    `${feature}:status-counts`,
    async () => {
      const current = filters()
      const [active, inactive] = await Promise.all([total(current, 'ACTIVE'), total(current, 'INACTIVE')])
      return { ACTIVE: active, INACTIVE: inactive, all: active + inactive }
    },
    { watch: [() => JSON.stringify(filters())] as WatchSource[] },
  )
  return data
}
