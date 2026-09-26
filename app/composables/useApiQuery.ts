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
 *   'categories:list',
 *   () => unwrap(getCategoriesPage({ query: toValue(query) })),
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

  const asyncData = useAsyncData(key, handler, options)
  const { data, status, error: rawError, refresh, execute, clear } = asyncData

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
