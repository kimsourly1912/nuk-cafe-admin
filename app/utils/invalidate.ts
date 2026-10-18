/** Window in which invalidations are merged into a single refresh. */
const BATCH_WINDOW_MS = 30

let queued = new Set<string>()
let shared = new Set<string>()
let flushing: Promise<void> | undefined

// Per query key, in this tab (browser only: on the server these maps would be shared by every
// request). Kept data (`useApiQuery`'s `staleTime`, D173) is used only while these say it's good.
/** When each key last loaded successfully. */
const fetchedAt = new Map<string, number>()
/** Bumped by every invalidation: a load started before it doesn't count as fresh. */
const generation = new Map<string, number>()
/** Changed since its last load (our write, another tab's), or its last load failed: never reuse it. */
const changed = new Set<string>()
/** Loads running now. */
const running = new Map<string, number>()

/** `useApiQuery` around each load: returns `settled(ok)` to call when it ends. */
export function queryStarted(key: string) {
  const startedIn = generation.get(key) ?? 0
  running.set(key, (running.get(key) ?? 0) + 1)
  return (ok: boolean) => {
    running.set(key, (running.get(key) ?? 1) - 1)
    if (!ok) changed.add(key)
    else if (startedIn === (generation.get(key) ?? 0)) {
      fetchedAt.set(key, Date.now())
      changed.delete(key)
    }
  }
}

/** Data the server rendered with the page: loaded now, as far as `staleTime` is concerned. */
export function queryHydrated(key: string) {
  if (!fetchedAt.has(key)) fetchedAt.set(key, Date.now())
}

/** A load for this key is running (another component's): join it instead of starting one. */
export const queryRunning = (key: string) => (running.get(key) ?? 0) > 0

/** Kept data for this key may be shown: nothing changed it since it loaded. */
export const queryReusable = (key: string) => !changed.has(key)

/** Milliseconds since this key last loaded (`Infinity` if never, or marked stale). */
export const queryAge = (key: string) => Date.now() - (fetchedAt.get(key) ?? -Infinity)

/** The queries components use now: `invalidate` refreshes these. */
const mounted = new Set<{ key: () => string, refresh: () => Promise<unknown> }>()

/** `useApiQuery` registers each use of a query; returns the unregister. */
export function registerQuery(query: { key: () => string, refresh: () => Promise<unknown> }) {
  mounted.add(query)
  return () => {
    mounted.delete(query)
  }
}

/**
 * Refetches the keys on screen that `matches`, once each, with cancel: `refreshNuxtData` would join
 * a load started earlier (`useApiQuery` makes first fetches join, D173), and would miss a key whose
 * first load hasn't answered yet.
 */
async function refreshMounted(matches: (key: string) => boolean) {
  const refreshes = new Map<string, () => Promise<unknown>>()
  for (const query of mounted) {
    const key = query.key()
    if (matches(key) && !refreshes.has(key)) refreshes.set(key, query.refresh)
  }
  await Promise.all([...refreshes.values()].map(refresh => refresh()))
}

/** The data changed: its kept copy must not be shown again, and running loads don't count. */
function markChanged(keys: string[]) {
  for (const key of keys) {
    generation.set(key, (generation.get(key) ?? 0) + 1)
    changed.add(key)
  }
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
    const matches = (key: string) => targets.some(feature => key.startsWith(`${feature}:`))
    // Kept data nobody shows (D173) loads fresh when next opened; keys on screen refetch now. A
    // load already running started before the write: it no longer counts as fresh.
    markChanged([...new Set([...Object.keys(nuxtApp.payload.data), ...[...mounted].map(query => query.key())])].filter(matches))
    await refreshMounted(matches)
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
 *
 * Kept data nobody shows (D173) is marked stale: shown when next opened, and refetched then.
 */
export async function invalidateAll(options: { olderThanMs?: number } = {}): Promise<void> {
  const { olderThanMs } = options
  const old = (key: string) => /^[\w-]+:/.test(key) && (olderThanMs === undefined || queryAge(key) >= olderThanMs)
  const onScreen = new Set([...mounted].map(query => query.key()))
  for (const key of Object.keys(useNuxtApp().payload.data)) {
    if (old(key) && !onScreen.has(key)) fetchedAt.delete(key)
  }
  await refreshMounted(old)
}
