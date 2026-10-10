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

  // Keep what was shown when a refresh fails for the connection or the server (D150). Nuxt resets
  // `data` to its default on any error, which emptied the counter's board and the customer's order
  // page on a Wi-Fi drop (and stopped the order page's polling). Nuxt's failure path sets a new
  // error and then resets `data` in the same tick; only that reset is undone, synchronously, so
  // watchers of `data` never see the gap. Every other reset (`clear()`, the session boundary's
  // `clearNuxtData`) forgets the kept copy: another person's data is never put back. (Nuxt 4.5's
  // clear also drops the error first; this check doesn't rely on that order.) Never for another
  // key, nor after a refusal (401, 403, 404…).
  let last: { key: string, value: T } | null = null
  let justFailed = false
  watch(rawError, (value) => {
    justFailed = Boolean(value)
  }, { flush: 'sync' })
  watch(data, (value) => {
    if (value != null) {
      last = { key: toValue(key), value: value as T }
      justFailed = false
      return
    }
    const keep = justFailed && last?.key === toValue(key) && rawError.value != null && ApiError.from(rawError.value).retryable
    justFailed = false
    if (!keep || !last) {
      last = null
      return
    }
    ;(data as Ref<unknown>).value = last.value
  }, { flush: 'sync' })

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
