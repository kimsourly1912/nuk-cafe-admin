import type { CounterFinishedOrders, CounterOrderHistory } from '#shared/contracts/orders'

/**
 * Today's finished orders (step 10.2, D116): read when the page opens, again when the counter's
 * commands change an order (they invalidate `counter`) and on return to the tab (D22). No timer:
 * a finished order doesn't change.
 */
export function useFinishedToday(branchId: MaybeRefOrGetter<string>) {
  return useApiQuery(
    () => `counter:finished:${toValue(branchId)}`,
    () => apiFetch<CounterFinishedOrders>(`/counter/${encodeURIComponent(toValue(branchId))}/orders/finished`),
    { server: false },
  )
}

/** One order with every step and who took it, for the panel (`null`: nothing open). */
export function useOrderHistory(branchId: MaybeRefOrGetter<string>, orderId: MaybeRefOrGetter<string | null>) {
  return useApiQuery(
    () => `counter:history:${toValue(orderId) ?? 'none'}`,
    async () => {
      const id = toValue(orderId)
      if (!id) return null
      return apiFetch<CounterOrderHistory>(`/counter/${encodeURIComponent(toValue(branchId))}/orders/${encodeURIComponent(id)}/history`)
    },
    { server: false },
  )
}
