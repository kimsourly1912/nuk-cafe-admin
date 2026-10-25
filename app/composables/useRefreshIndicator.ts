import { type MaybeRefOrGetter, onScopeDispose, readonly, type Ref, ref, toValue, watch } from 'vue'

/** A refresh shorter than this shows nothing: most answer in time, and a flash reads as a glitch. */
export const REFRESH_SHOW_DELAY = 150
/** Once shown, the indicator stays at least this long, so it never blinks. */
export const REFRESH_MIN_SHOWN = 300

/**
 * Whether to show that a refetch is running behind the content (`useApiQuery().refreshing`): true
 * only after `REFRESH_SHOW_DELAY` ms of refreshing, and then for at least `REFRESH_MIN_SHOWN` ms.
 * `RefreshBar` uses it; use it directly where the bar can't sit on a panel header (a tab's
 * content dims its own list).
 *
 * @example
 * const showRefreshing = useRefreshIndicator(refreshing)
 * <div :class="showRefreshing && 'opacity-60'" />
 */
export function useRefreshIndicator(refreshing: MaybeRefOrGetter<boolean>): Readonly<Ref<boolean>> {
  const shown = ref(false)
  let shownAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(fn: () => void, ms: number) {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }

  watch(() => toValue(refreshing), (active) => {
    if (active) {
      if (shown.value) clearTimeout(timer)
      else schedule(() => {
        shown.value = true
        shownAt = Date.now()
      }, REFRESH_SHOW_DELAY)
      return
    }
    if (!shown.value) {
      clearTimeout(timer)
      return
    }
    const left = REFRESH_MIN_SHOWN - (Date.now() - shownAt)
    if (left > 0) schedule(() => (shown.value = false), left)
    else shown.value = false
  }, { immediate: true })

  onScopeDispose(() => clearTimeout(timer))
  return readonly(shown)
}
