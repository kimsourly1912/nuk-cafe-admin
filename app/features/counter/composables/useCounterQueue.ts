import { useDocumentVisibility, useIntervalFn, useLocalStorage } from '@vueuse/core'
import type { CounterOrder, CounterQueue } from '#shared/contracts/orders'
import { NEW_FOR_MS } from '../utils/counter'
import { useCounterSound } from './useCounterSound'

/** The new-order sound, on or off in this browser (the header's user menu, on every counter page). */
export const useCounterMuted = () => useLocalStorage('counter:muted', false, { initOnMounted: true })

/** The queue refreshes this often while the tab is visible (owner, 2026-09-29, D102). */
export const QUEUE_REFRESH_MS = 10_000

/**
 * The branch's queue (`GET /api/counter/{branchId}/orders`, D101), refreshed every 10 seconds while
 * the tab is visible (and on return, by the data-freshness plugin). Orders that appear after the
 * first load are marked new for a minute and play a short chime (`useCounterSound`), unless muted in this browser.
 * `now` follows the server's clock (the answer carries it), so "Pay by" doesn't depend on the
 * tablet's.
 */
export function useCounterQueue(branchId: MaybeRefOrGetter<string>) {
  const query = useApiQuery(
    () => `counter:queue:${toValue(branchId)}`,
    () => apiFetch<CounterQueue>(`/counter/${encodeURIComponent(toValue(branchId))}/orders`),
    { server: false },
  )

  const visibility = useDocumentVisibility()
  useIntervalFn(() => {
    if (visibility.value === 'visible' && !query.pending.value) void query.refresh()
  }, QUEUE_REFRESH_MS)

  // --- The server's clock ---
  const offset = ref(0)
  const tick = ref(Date.now())
  useIntervalFn(() => {
    tick.value = Date.now()
  }, 15_000)
  const now = computed(() => tick.value + offset.value)

  // --- When the queue last loaded (D149) ---
  // A failed refresh keeps the board (`useApiQuery`, D150); this says how old it is.
  const updatedAt = ref<string | null>(null)
  watch(() => toValue(branchId), () => {
    updatedAt.value = null
  })

  // --- New orders ---
  const muted = useCounterMuted()
  const sound = useCounterSound()
  const firstSeen = ref(new Map<string, number>())
  let loaded = false
  watch(() => query.data.value, (queue) => {
    if (!queue) return
    offset.value = Date.parse(queue.serverTime) - Date.now()
    tick.value = Date.now()
    updatedAt.value = new Date().toISOString()
    let arrived = false
    for (const order of queue.orders) {
      if (firstSeen.value.has(order.id)) continue
      // The first load's orders aren't new; later ones are.
      firstSeen.value.set(order.id, loaded ? now.value : 0)
      if (loaded && order.status === 'awaiting_payment') arrived = true
    }
    loaded = true
    if (arrived && !muted.value) sound.chime()
  }, { immediate: true })

  const isNew = (order: CounterOrder) => {
    const seen = firstSeen.value.get(order.id)
    return Boolean(seen) && now.value - seen! < NEW_FOR_MS
  }

  return {
    query,
    /** The queue as last loaded: kept while a refresh fails (`query.error` says so, D150). */
    queue: computed(() => query.data.value ?? null),
    now,
    /** The server's clock minus this tablet's, for countdowns by the second (the KHQR's). */
    serverOffset: readonly(offset),
    /** When the queue last loaded, on this tablet's clock (`localNow`). */
    updatedAt: readonly(updatedAt),
    localNow: computed(() => tick.value),
    isNew,
    muted,
    /** The chime and the stale-queue warning; `blocked` until someone taps the page (D150). */
    sound,
  }
}
