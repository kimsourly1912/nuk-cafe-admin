import type { Ref } from 'vue'

/**
 * A page's tab kept in the URL (`?tab=tables`), so a reload or a shared link opens the same tab.
 * The first tab is the default and leaves the URL clean. Switching replaces the URL without a
 * route change: Back still leaves the page, and the unsaved-changes guard (which asks on every
 * navigation) doesn't ask when a tab with a draft is merely hidden.
 */
export function useUrlTab<T extends string>(tabs: readonly T[], param = 'tab'): Ref<T> {
  const route = useRoute()
  const fallback = tabs[0]!
  const fromUrl = route.query[param]
  const tab = ref((tabs as readonly string[]).includes(fromUrl as string) ? fromUrl : fallback) as Ref<T>

  watch(tab, (value) => {
    if (!import.meta.client) return
    const url = new URL(window.location.href)
    if (value === fallback) url.searchParams.delete(param)
    else url.searchParams.set(param, value)
    const path = `${url.pathname}${url.search}${url.hash}`
    // Vue Router keeps the current location in `history.state.current`; keep it in step.
    window.history.replaceState({ ...window.history.state, current: path }, '', path)
  })

  return tab
}
