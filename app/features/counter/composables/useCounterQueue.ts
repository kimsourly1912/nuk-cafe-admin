import { useDocumentVisibility, useIntervalFn, useLocalStorage } from '@vueuse/core'
import type { CounterOrder, CounterQueue } from '#shared/contracts/orders'
import { NEW_FOR_MS } from '../utils/counter'

/** The new-order sound, on or off in this browser (the header's user menu, on every counter page). */
export const useCounterMuted = () => useLocalStorage('counter:muted', false, { initOnMounted: true })

/** The queue refreshes this often while the tab is visible (owner, 2026-09-29, D102). */
export const QUEUE_REFRESH_MS = 10_000

/**
 * The branch's queue (`GET /api/counter/{branchId}/orders`, D101), refreshed every 10 seconds while
 * the tab is visible (and on return, by the data-freshness plugin). Orders that appear after the
 * first load are marked new for a minute and play a short chime, unless muted in this browser.
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

  // --- New orders ---
  const muted = useCounterMuted()
  const firstSeen = ref(new Map<string, number>())
  let loaded = false
  watch(() => query.data.value, (queue) => {
    if (!queue) return
    offset.value = Date.parse(queue.serverTime) - Date.now()
    tick.value = Date.now()
    let arrived = false
    for (const order of queue.orders) {
      if (firstSeen.value.has(order.id)) continue
      // The first load's orders aren't new; later ones are.
      firstSeen.value.set(order.id, loaded ? now.value : 0)
      if (loaded && order.status === 'awaiting_payment') arrived = true
    }
    loaded = true
    if (arrived && !muted.value) chime()
  }, { immediate: true })

  const isNew = (order: CounterOrder) => {
    const seen = firstSeen.value.get(order.id)
    return Boolean(seen) && now.value - seen! < NEW_FOR_MS
  }

  return {
    query,
    queue: computed(() => query.data.value ?? null),
    now,
    isNew,
    muted,
  }
}

/** A short two-note chime (Web Audio: no file to load). Browsers may refuse before a tap: then silence. */
function chime() {
  try {
    const context = new AudioContext()
    for (const [index, frequency] of [880, 1320].entries()) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = frequency
      const start = context.currentTime + index * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.32)
    }
    setTimeout(() => void context.close(), 1000)
  }
  catch {
    // No audio here: the "New" badge still shows.
  }
}
