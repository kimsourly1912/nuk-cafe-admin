import { useDocumentVisibility, useOnline } from '@vueuse/core'

/** Tab hidden at least this long counts as "away": lists may be stale when the user returns. */
const STALE_AFTER_MS = 30_000

/**
 * The portal stays open all day on counter tablets and laptops, and cafe wifi drops.
 * - Coming back to the tab after `STALE_AFTER_MS`: refetch loaded lists (another staff member may
 *   have changed the menu meanwhile). Quick tab switches don't refetch.
 * - Connection back: refetch loaded lists. The offline banner is `components/OfflineBanner.vue`.
 * Refetching keeps the old rows on screen (`refreshing`), and form input is untouched.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const visibility = useDocumentVisibility()
  const online = useOnline()
  let hiddenAt: number | undefined

  const refresh = () => nuxtApp.runWithContext(() => invalidateAll())

  watch(visibility, (state) => {
    if (state === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    const away = hiddenAt === undefined ? 0 : Date.now() - hiddenAt
    hiddenAt = undefined
    if (away >= STALE_AFTER_MS && online.value) refresh()
  })

  watch(online, (isOnline, wasOnline) => {
    if (isOnline && !wasOnline) refresh()
  })
})
