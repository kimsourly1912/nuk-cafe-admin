import type { CheckoutQuote, Order } from '#shared/contracts/orders'
import type { PlaceFailure, PriceChange } from '../utils/checkout'
import { orderLines, placeFailure, priceChange } from '../utils/checkout'
import { useCart, useShopBranch, useTableContext } from './useShopMenu'

/**
 * Review order (step 6.2b, D100): the order kept in this browser, priced by the server
 * (`POST /api/public/checkout/quote`, D98) and placed (`POST /api/shop/orders`, D99).
 *
 * - **The branch** is the menu's: the one the customer picked or a table's, else the first.
 * - **The quote** is asked again whenever a line or quantity changes (not a note: it never changes
 *   a price) and when it's more than 10 minutes old at "Place order".
 * - **Price changes** the customer didn't cause (a new quote with other unit prices) are kept
 *   until the order is placed, so the page can show the old prices struck through.
 * - **Placing** sends the total the page shows and an `Idempotency-Key` that stays the same until
 *   the order changes: a retry after a lost answer returns the order already placed.
 *
 * Placing keeps its own `placing` state, like the account forms (D97): its failures are shown on
 * the page, next to the order, never as a toast.
 */
export function useCheckout() {
  const shop = useShopBranch()
  const branchId = computed(() => shop.requestedBranchId.value ?? shop.branches.value[0]?.id)
  const cart = useCart(branchId)
  const { table, clearTable } = useTableContext()
  /** The table only counts at its own branch. */
  const tableHere = computed(() => (table.value && table.value.branchId === branchId.value ? table.value : null))

  const quoteBody = computed(() => (branchId.value && cart.lines.value.length
    ? { branchId: branchId.value, lines: orderLines(cart.lines.value, { withNotes: false }) }
    : null))
  const quoteKey = computed(() => JSON.stringify(quoteBody.value))
  const quote = useApiQuery(
    'menu:checkout-quote',
    () => (quoteBody.value
      ? apiFetch<CheckoutQuote>('/public/checkout/quote', { method: 'POST', body: quoteBody.value })
      : Promise.resolve(null)),
    { server: false, watch: [quoteKey] },
  )

  /** The quote the customer has seen, and what changed since (not by them). */
  const seen = shallowRef<CheckoutQuote | null>(null)
  const change = shallowRef<PriceChange | null>(null)
  watch(() => quote.data.value, (next) => {
    if (!next) return
    const found = priceChange(seen.value, next)
    if (found) change.value = found
    seen.value = next
  })

  // --- Placing ---
  const placeBody = computed(() => (branchId.value && quote.data.value
    ? {
        branchId: branchId.value,
        tableToken: tableHere.value?.token ?? null,
        lines: orderLines(cart.lines.value, { withNotes: true }),
        expectedTotalMinor: quote.data.value.totalMinor,
      }
    : null))
  /** One key per order as sent: a retry of the same order reuses it; any change makes a new one. */
  const idempotencyKey = ref(crypto.randomUUID())
  watch(() => JSON.stringify(placeBody.value), () => {
    idempotencyKey.value = crypto.randomUUID()
  })

  const placing = ref(false)
  const failure = ref<{ kind: PlaceFailure, message: string } | null>(null)

  /** Places the order; resolves to it, or `null` with `failure` set. */
  async function place(): Promise<Order | null> {
    if (placing.value) return null
    failure.value = null
    const current = quote.data.value
    if (current && Date.now() > Date.parse(current.expiresAt)) {
      const before = change.value
      await quote.refresh()
      // New prices since: shown, and the customer places again.
      if (change.value !== before || !quote.data.value?.orderable) return null
    }
    const body = placeBody.value
    if (!body || !quote.data.value?.orderable) return null
    placing.value = true
    try {
      const order = await apiFetch<Order>('/shop/orders', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey.value } })
      cart.clear()
      return order
    }
    catch (error) {
      failure.value = placeFailure(error)
      if (failure.value.kind === 'requote') await quote.refresh()
      return null
    }
    finally {
      placing.value = false
    }
  }

  return {
    branchId,
    cart,
    table: tableHere,
    clearTable,
    quote,
    change,
    placing,
    failure,
    place,
    dismissFailure: () => {
      failure.value = null
    },
  }
}
