/**
 * Refetches every loaded `useAsyncData` whose key belongs to one of the given features.
 * Keys must be namespaced as `<feature>:<name>` (e.g. `categories:list`).
 *
 * Mutations call this with their own feature plus any feature whose data they affect,
 * without importing that feature's internals.
 *
 * @example
 * await invalidate('products', 'schedules') // product saved with new scheduleIds
 */
export async function invalidate(...features: string[]) {
  const nuxtApp = useNuxtApp()
  const keys = Object.keys(nuxtApp.payload.data)
    .filter(key => features.some(feature => key.startsWith(`${feature}:`)))
  if (keys.length) await refreshNuxtData(keys)
}
