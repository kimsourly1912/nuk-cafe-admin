/** Window in which invalidations are merged into a single refresh. */
const BATCH_WINDOW_MS = 30

let queued = new Set<string>()
let shared = new Set<string>()
let flushing: Promise<void> | undefined

/** When each query key last loaded successfully (set by `useApiQuery`). */
const fetchedAt = new Map<string, number>()

/** Called by `useApiQuery` after a successful load. */
export function markFetched(key: string) {
  fetchedAt.set(key, Date.now())
}

function schedule(features: string[], broadcast: boolean): Promise<void> {
  const nuxtApp = useNuxtApp()
  for (const feature of features) {
    queued.add(feature)
    if (broadcast) shared.add(feature)
  }

  flushing ??= new Promise(resolve => setTimeout(resolve, BATCH_WINDOW_MS)).then(async () => {
    const targets = [...queued]
    const toOtherTabs = [...shared]
    queued = new Set()
    shared = new Set()
    flushing = undefined
    // Other tabs of the app refresh too (plugins/data-freshness.client.ts). Only feature names cross.
    if (toOtherTabs.length) await nuxtApp.callHook('app:data-changed', toOtherTabs)
    const keys = Object.keys(nuxtApp.payload.data)
      .filter(key => targets.some(feature => key.startsWith(`${feature}:`)))
    if (keys.length) await nuxtApp.runWithContext(() => refreshNuxtData(keys))
  })
  return flushing
}

/**
 * Refetches every loaded `useAsyncData` whose key belongs to one of the given features,
 * in this tab and in the app's other open tabs.
 * Keys must be namespaced as `<feature>:<name>` (e.g. `categories:list`).
 *
 * Calls within a short window are merged, so N mutations finishing together
 * (e.g. a batch, or parallel single deletes) trigger one refresh per list (and one message
 * to other tabs). Resolves once this tab's refresh has finished.
 *
 * Must be called in a Nuxt context (after an `await`, wrap with `nuxtApp.runWithContext`).
 *
 * @example
 * await invalidate('products', 'schedules') // product saved with new scheduleIds
 */
export function invalidate(...features: string[]): Promise<void> {
  return schedule(features, true)
}

/** `invalidate` without telling other tabs. For changes that came *from* another tab. */
export function invalidateInThisTab(features: string[]): Promise<void> {
  return schedule(features, false)
}

/**
 * Refetches loaded API queries (`<feature>:<name>` keys) in this tab. With `olderThanMs`, only
 * those whose data loaded at least that long ago (the others are still fresh). Used by
 * `plugins/data-freshness.client.ts` on tab return and reconnect. Must be called in a Nuxt context.
 */
export async function invalidateAll(options: { olderThanMs?: number } = {}): Promise<void> {
  const { olderThanMs } = options
  const now = Date.now()
  const keys = Object.keys(useNuxtApp().payload.data).filter(key => /^[\w-]+:/.test(key)
    && (olderThanMs === undefined || now - (fetchedAt.get(key) ?? 0) >= olderThanMs))
  if (keys.length) await refreshNuxtData(keys)
}
