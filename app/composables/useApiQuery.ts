import type { AsyncDataOptions } from '#app'

/**
 * `useAsyncData` for API reads, with the same shape as `useMutation`:
 * `pending` is a boolean and `error` is already an `ApiError` (user-safe `message`, `kind`).
 *
 * Keys must be `<feature>:<name>` so `invalidate('<feature>')` can refresh them.
 * All `useAsyncData` options pass through.
 *
 * @example
 * const { data, pending, refreshing, error, refresh } = useApiQuery(
 *   'schedules:list',
 *   () => apiFetch<Page<Schedule>>('/admin/schedules', { query: toValue(query) }),
 *   { watch: [() => ({ ...toValue(query) })] },
 * )
 */
export function useApiQuery<T, DefaultT = undefined>(
  key: MaybeRefOrGetter<string>,
  handler: () => Promise<T>,
  options?: AsyncDataOptions<T, T, never[], DefaultT>,
) {
  if (import.meta.dev && !/^[\w-]+:/.test(toValue(key))) {
    console.warn(`[useApiQuery] key "${toValue(key)}" should be "<feature>:<name>" so invalidate() can find it.`)
  }

  // Load time per key, so returning to the tab only refetches data that's actually stale.
  const tracked = async () => {
    const result = await handler()
    markFetched(toValue(key))
    return result
  }
  // `watch` is handled here, not by useAsyncData: in Nuxt 4.5 its watch path (debounceTick) waits
  // for a running request and only then fetches again, so one slow response (e.g. an older
  // search) blocked the newer one and was shown first. `refresh()` cancels instead: the newer
  // request starts at once and the older response is ignored (docs/decisions.md D30).
  const { watch: watchSources, ...asyncOptions } = options ?? {}
  const asyncData = useAsyncData(key, tracked, asyncOptions)
  const { data, status, error: rawError, refresh, execute, clear } = asyncData
  if (watchSources) watch(watchSources, () => refresh({ dedupe: 'cancel' }))

  const pending = computed(() => status.value === 'pending')
  return {
    data,
    status,
    refresh,
    execute,
    clear,
    /** Any request in flight (first load or refresh). */
    pending,
    /** First load: nothing to show yet. */
    loading: computed(() => pending.value && data.value == null),
    /** Reloading while previous data is still shown. */
    refreshing: computed(() => pending.value && data.value != null),
    error: computed(() => (rawError.value ? ApiError.from(rawError.value) : undefined)),
  }
}
