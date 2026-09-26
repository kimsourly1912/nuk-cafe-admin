import { useBroadcastChannel, useDocumentVisibility, useOnline } from '@vueuse/core'

/** Data loaded longer ago than this is refetched when the user returns to the tab. */
const STALE_AFTER_MS = 5_000

interface DataChangedMessage {
  features: string[]
}

/**
 * Keeps lists fresh while the portal stays open all day (decision D22, cases in
 * docs/reference/app-behavior.md → "Data freshness"). The same model as TanStack Query / SWR /
 * Pinia Colada, plus cross-tab invalidation:
 *
 * 1. Saved in another tab of this browser: that tab's `invalidate()` sends the feature names over
 *    a BroadcastChannel; this tab refreshes the same lists at once, even if it's in the background
 *    or in a window side by side (where no visibility event fires). Data never crosses tabs.
 * 2. Tab visible again (`visibilitychange`, not `focus`, which also fires for dialogs, iframes and
 *    DevTools): refetch queries loaded more than `STALE_AFTER_MS` ago. Covers changes made on
 *    other devices by other staff.
 * 3. Connection back: refetch every loaded query. The offline banner is `components/OfflineBanner.vue`.
 *
 * Refetching keeps old rows on screen (`refreshing`); form input is never touched.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const visibility = useDocumentVisibility()
  const online = useOnline()
  const { isSupported, data: message, post } = useBroadcastChannel<DataChangedMessage, DataChangedMessage>({ name: 'nuk-cafe-admin:data-changed' })

  // 1. Cross-tab
  if (isSupported.value) {
    nuxtApp.hook('app:data-changed', (features) => {
      post({ features })
    })
    watch(message, (received) => {
      const features = received?.features
      if (!Array.isArray(features) || !features.every(f => typeof f === 'string')) return
      nuxtApp.runWithContext(() => invalidateInThisTab(features))
    })
  }

  // 2. Returning to the tab
  watch(visibility, (state) => {
    if (state === 'visible' && online.value) {
      nuxtApp.runWithContext(() => invalidateAll({ olderThanMs: STALE_AFTER_MS }))
    }
  })

  // 3. Reconnect
  watch(online, (isOnline, wasOnline) => {
    if (isOnline && !wasOnline) nuxtApp.runWithContext(() => invalidateAll())
  })
})
