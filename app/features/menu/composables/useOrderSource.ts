import { createSharedComposable, useLocalStorage } from '@vueuse/core'
import type { OrderSource } from '#shared/contracts/marketing'
import { ORDER_SOURCES } from '#shared/contracts/marketing'

/** How long after opening a post's link an order still counts as from it. */
const SOURCE_HOURS = 24

interface StoredSource { slug: string, source: OrderSource, at: number }

// Read after mounting (server-rendered menu, D95); unavailable storage just forgets it.
const useStoredSource = createSharedComposable(() => useLocalStorage<StoredSource | null>('nuk-cafe:order-source', null, {
  initOnMounted: true,
  serializer: { read: (raw: string) => JSON.parse(raw) as StoredSource | null, write: (value: StoredSource | null) => JSON.stringify(value) },
}))

/**
 * Where this customer came from (M2a, D164): a channel post's Order now link opens the menu with
 * `?src=telegram`; the order placed in this cafe within 24 hours says so, and the promotion's page
 * counts it. Kept in this browser only, cleared once an order carried it.
 */
export function useOrderSource() {
  const stored = useStoredSource()
  const slug = useTenantSlug()

  function remember(source: unknown) {
    if (typeof source !== 'string' || !(ORDER_SOURCES as readonly string[]).includes(source)) return
    stored.value = { slug: slug.value, source: source as OrderSource, at: Date.now() }
  }

  /** The source for an order placed now in this cafe, if any. */
  function current(): OrderSource | undefined {
    const value = stored.value
    if (!value || value.slug !== slug.value || Date.now() - value.at > SOURCE_HOURS * 3_600_000) return undefined
    return value.source
  }

  const clear = () => {
    stored.value = null
  }

  return { remember, current, clear }
}
