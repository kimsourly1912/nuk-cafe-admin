import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import type { CustomerOrders, Order } from '#shared/contracts/orders'
import { isInProgress } from '../utils/order'

/** How often an order in progress is read again while its page is visible (D114, like the counter, D102). */
export const ORDER_REFRESH_MS = 10_000

/** Past orders shown at first, and added by each "Load more". */
export const PAST_PAGE_SIZE = 20

/**
 * Polls `refresh` every 10 seconds while the tab is visible and `active` holds; the data-freshness
 * plugin already refetches when the customer comes back to the tab (D22). Live pushes may replace
 * this later (docs/plans/live-updates.md).
 */
function usePolling(active: () => boolean, pending: () => boolean, refresh: () => unknown) {
  const visibility = useDocumentVisibility()
  useIntervalFn(() => {
    if (visibility.value === 'visible' && active() && !pending()) void refresh()
  }, ORDER_REFRESH_MS)
}

/**
 * One order (`GET /api/shop/orders/{id}`), refreshed while it's still in progress, and when it
 * last arrived ("Updated just now"). Browser-only: only its customer may read it.
 */
export function useOrderTracking(id: MaybeRefOrGetter<string>) {
  const query = useApiQuery(
    () => `orders:order:${toValue(id)}`,
    () => apiFetch<Order>(`/shop/orders/${encodeURIComponent(toValue(id))}`),
    { server: false },
  )
  const updatedAt = ref<number | null>(null)
  watch(() => query.data.value, (order) => {
    if (order) updatedAt.value = Date.now()
  })
  usePolling(() => Boolean(query.data.value && isInProgress(query.data.value.status)), () => query.pending.value, query.refresh)
  return { ...query, updatedAt }
}

/**
 * The customer's orders (`GET /api/shop/orders`, D106): in progress, then the past ones, 20 at a
 * time. "Load more" adds a page; a refresh reads every page shown again (in parallel), so the list
 * stays consistent when an order moves from In progress to Past, and a row that shifted between
 * pages is shown once.
 */
export function useCustomerOrders(options: { poll?: boolean, pages?: Ref<number> } = {}) {
  const { poll = false, pages = ref(1) } = options
  const query = useApiQuery(
    () => `orders:list:${pages.value}`,
    () => loadPages(pages.value),
    { server: false },
  )
  if (poll) usePolling(() => Boolean(query.data.value?.inProgress.length), () => query.pending.value, query.refresh)
  return query
}

async function loadPages(count: number): Promise<CustomerOrders> {
  const answers = await Promise.all(Array.from({ length: count }, (_, index) =>
    apiFetch<CustomerOrders>('/shop/orders', { query: { page: index + 1, pageSize: PAST_PAGE_SIZE } })))
  const first = answers[0]!
  const seen = new Set<string>()
  const items = answers.flatMap(answer => answer.past.items).filter((order) => {
    if (seen.has(order.id)) return false
    seen.add(order.id)
    return true
  })
  return { inProgress: first.inProgress, past: { ...first.past, items } }
}

/**
 * The customer's cancel while unpaid (`POST /api/shop/orders/{id}/cancel`, D106). The sheet keeps
 * its own state and shows a refusal in place (like the counter's panel, D102); the key stays the
 * same for Try again, so a lost answer never cancels twice.
 */
export async function cancelOrder(order: Pick<Order, 'id' | 'version'>, key: string) {
  const cancelled = await apiFetch<Order>(`/shop/orders/${encodeURIComponent(order.id)}/cancel`, {
    method: 'POST',
    body: { version: order.version },
    headers: { 'Idempotency-Key': key },
  })
  await invalidate('orders')
  return cancelled
}
