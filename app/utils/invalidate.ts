/** Window in which invalidations are merged into a single refresh. */
const BATCH_WINDOW_MS = 30

let queued = new Set<string>()
let flushing: Promise<void> | undefined

/**
 * Refetches every loaded `useAsyncData` whose key belongs to one of the given features.
 * Keys must be namespaced as `<feature>:<name>` (e.g. `categories:list`).
 *
 * Calls within a short window are merged, so N mutations finishing together
 * (e.g. a batch, or parallel single deletes) trigger one refresh per list.
 * Resolves once that refresh has finished.
 *
 * Must be called in a Nuxt context (after an `await`, wrap with `nuxtApp.runWithContext`).
 *
 * @example
 * await invalidate('products', 'schedules') // product saved with new scheduleIds
 */
export function invalidate(...features: string[]): Promise<void> {
  const nuxtApp = useNuxtApp()
  for (const feature of features) queued.add(feature)

  flushing ??= new Promise(resolve => setTimeout(resolve, BATCH_WINDOW_MS)).then(async () => {
    const targets = [...queued]
    queued = new Set()
    flushing = undefined
    const keys = Object.keys(nuxtApp.payload.data)
      .filter(key => targets.some(feature => key.startsWith(`${feature}:`)))
    if (keys.length) await nuxtApp.runWithContext(() => refreshNuxtData(keys))
  })
  return flushing
}
