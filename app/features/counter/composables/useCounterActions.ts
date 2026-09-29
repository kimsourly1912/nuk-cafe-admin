import type { CancelOrderInput, CounterOrder, PayOrderInput } from '#shared/contracts/orders'
import { orderNumber } from '../utils/counter'

/**
 * The counter's commands (D101, D102). Every one names the order's `version` and sends an
 * `Idempotency-Key`; a refused one leaves the order as it is.
 *
 * - **Mark ready** and **Complete** are one tap on a card: `useMutation` (one per order at a time,
 *   the order's lock, a toast if refused, the queue refreshed).
 * - **Take payment** and **Cancel** run in the order panel, which keeps its own state and shows a
 *   refusal next to the order, with Reload or Try again (like Review order, D100). Their key stays
 *   the same for a retry of the same request: a payment is never recorded twice.
 */
export function useCounterActions(branchId: MaybeRefOrGetter<string>) {
  const path = (order: CounterOrder, action: string) =>
    `/counter/${encodeURIComponent(toValue(branchId))}/orders/${encodeURIComponent(order.id)}/${action}`

  const post = (order: CounterOrder, action: string, body: Record<string, unknown>, key: string = crypto.randomUUID()) =>
    apiFetch<CounterOrder>(path(order, action), { method: 'POST', body, headers: { 'Idempotency-Key': key } })

  const lock = (order: CounterOrder) => `counter-order:${order.id}`

  const markReady = useMutation(
    (order: CounterOrder) => post(order, 'ready', { version: order.version }),
    {
      id: 'counter:ready',
      key: order => order.id,
      lock,
      successMessage: false,
      errorMessage: order => `Couldn't mark order ${orderNumber(order)} ready`,
      invalidate: ['counter'],
    },
  )

  const complete = useMutation(
    (order: CounterOrder) => post(order, 'complete', { version: order.version }),
    {
      id: 'counter:complete',
      key: order => order.id,
      lock,
      successMessage: order => `Order ${orderNumber(order)} completed`,
      errorMessage: order => `Couldn't complete order ${orderNumber(order)}`,
      invalidate: ['counter'],
    },
  )

  async function pay(order: CounterOrder, input: PayOrderInput, key: string) {
    const paid = await post(order, 'pay', input, key)
    await invalidate('counter')
    return paid
  }

  async function cancel(order: CounterOrder, input: CancelOrderInput, key: string) {
    const cancelled = await post(order, 'cancel', input, key)
    await invalidate('counter')
    return cancelled
  }

  /** Any command in flight for this order (the card dims and shows a spinner). */
  const isBusy = (order: CounterOrder) => markReady.isPending(order.id) || complete.isPending(order.id)

  return { markReady, complete, pay, cancel, isBusy }
}
