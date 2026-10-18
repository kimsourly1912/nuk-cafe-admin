import type { AsyncDataOptions } from '#app'

/** `staleTime` for reference data: libraries, pickers' options, settings (D173). */
export const REFERENCE_STALE_TIME = 60_000

export interface ApiQueryOptions<T, DefaultT> extends AsyncDataOptions<T, T, never[], DefaultT> {
  /**
   * Keep the data after the last component using it unmounts (D173). When it's next shown: younger
   * than this (ms), no request; older, shown at once and refetched. A write (`invalidate`, here or
   * in another tab) or a failed load means it's never shown again: the next visit loads fresh. Set
   * it where the query is defined, so every call site of the key passes the same options.
   */
  staleTime?: number
}

/**
 * `useAsyncData` for API reads, with the same shape as `useMutation`:
 * `pending` is a boolean and `error` is already an `ApiError` (user-safe `message`, `kind`).
 *
 * Keys must be `<feature>:<name>` so `invalidate('<feature>')` can refresh them.
 * All `useAsyncData` options pass through, plus `staleTime` (kept between visits, D173).
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
  options?: ApiQueryOptions<T, DefaultT>,
) {
  if (import.meta.dev && !/^[\w-]+:/.test(toValue(key))) {
    console.warn(`[useApiQuery] key "${toValue(key)}" should be "<feature>:<name>" so invalidate() can find it.`)
  }

  // Each load is recorded per key (`utils/invalidate.ts`), in the browser only: load time, so
  // returning to the tab only refetches what's stale; whether it's running, so a second component
  // joins it; whether it's still good to keep (D173).
  const tracked = async () => {
    if (import.meta.server) return handler()
    const settled = queryStarted(toValue(key))
    try {
      const result = await handler()
      settled(true)
      return result
    }
    catch (error) {
      settled(false)
      throw error
    }
  }
  // `watch` is handled here, not by useAsyncData: in Nuxt 4.5 its watch path (debounceTick) waits
  // for a running request and only then fetches again, so one slow response (e.g. an older
  // search) blocked the newer one and was shown first. `refresh()` cancels instead: the newer
  // request starts at once and the older response is ignored (docs/decisions.md D30).
  const { watch: watchSources, staleTime, ...asyncOptions } = options ?? {}
  // Nuxt's default `dedupe: 'cancel'` also applies to the first fetch: a second component mounting
  // the key while it loads cancelled the load and started another, so a form and a section of it
  // sharing a query read it twice (D173). The first fetch joins instead; every refresh still
  // cancels (`refresh` below, `invalidate`), so a load started before a write never counts after it.
  asyncOptions.dedupe ??= 'defer'
  // Kept data (D173): a custom `getCachedData` also stops Nuxt purging the key on unmount. Only the
  // first fetch asks; refreshes always load.
  if (staleTime !== undefined) {
    asyncOptions.getCachedData = (cacheKey, nuxtApp, context) => {
      if (nuxtApp.isHydrating) return nuxtApp.payload.data[cacheKey]
      if (context.cause === 'initial' && queryReusable(cacheKey)) return nuxtApp.payload.data[cacheKey]
    }
  }
  const asyncData = useAsyncData(key, tracked, asyncOptions)
  const { data, status, error: rawError, clear } = asyncData
  const refresh: typeof asyncData.refresh = (refreshOptions = {}) => asyncData.refresh({ dedupe: 'cancel', ...refreshOptions })
  if (watchSources) watch(watchSources, () => refresh())
  if (import.meta.client) {
    // `invalidate()` refreshes the keys on screen through this (with cancel, see above).
    const unregister = registerQuery({ key: () => toValue(key), refresh: () => refresh() })
    if (getCurrentScope()) onScopeDispose(unregister)
    // Rendered by the server with the page: as fresh as a load now, not "never loaded" (D173).
    if (useNuxtApp().isHydrating && data.value != null) queryHydrated(toValue(key))
    // Shown from what was kept, but older than `staleTime`: refetch behind it.
    if (staleTime !== undefined && data.value != null && !queryRunning(toValue(key)) && queryAge(toValue(key)) >= staleTime) void refresh()
  }

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
    execute: refresh,
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
