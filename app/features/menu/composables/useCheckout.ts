import { refDebounced } from '@vueuse/core'
import type { CheckoutQuote, Order } from '#shared/contracts/orders'
import { useAccountActions, useCustomerAccount } from '~/features/account'
import type { PlaceFailure, PriceChange } from '../utils/checkout'
import { orderLines, placeFailure, priceChange } from '../utils/checkout'
import { useOrderSource } from './useOrderSource'
import { useCart, useShopBranch, useTableContext } from './useShopMenu'

/** How long the order must stay unchanged before it is priced again. */
const QUOTE_SETTLE_MS = 400

/**
 * Review order (step 6.2b, D100): the order kept in this browser, priced by the server
 * (`POST /api/public/checkout/quote`, D98) and placed (`POST /api/shop/orders`, D99).
 *
 * - **The branch** is the menu's: the one the customer picked or a table's, else the first.
 * - **The quote** is asked again when a line or quantity changes (not a note: it never changes a
 *   price), once the changes stop for a moment (`QUOTE_SETTLE_MS`), so tapping + five times asks
 *   once; and when it's more than 10 minutes old at "Place order". Until then `quoteSettling` is on
 *   and the order can't be placed.
 * - **Price changes** the customer didn't cause (a new quote with other unit prices) are kept
 *   until the order is placed, so the page can show the old prices struck through.
 * - **Placing** sends the total the page shows and an `Idempotency-Key` that stays the same until
 *   the order changes: a retry after a lost answer returns the order already placed.
 * - **Without an account** (D156): placing signs this browser in as a guest first and sends the
 *   name the customer gave; an account sends none (it has its name).
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
  // Tapping + or − several times asks once, after the last tap. The first quote (the cart just
  // loaded) and an emptied cart don't wait.
  const settledKey = ref(quoteKey.value)
  const debouncedKey = refDebounced(quoteKey, QUOTE_SETTLE_MS)
  watch(debouncedKey, (next) => {
    settledKey.value = next
  })
  watch(quoteKey, (next) => {
    if (next === 'null' || settledKey.value === 'null') settledKey.value = next
  })
  /** The order changed and its new quote hasn't been asked for yet. */
  const quoteSettling = computed(() => quoteKey.value !== settledKey.value)
  const quote = useApiQuery(
    'menu:checkout-quote',
    () => (quoteBody.value
      ? apiFetch<CheckoutQuote>('/public/checkout/quote', { method: 'POST', body: quoteBody.value })
      : Promise.resolve(null)),
    { server: false, watch: [settledKey] },
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
  /** The order was placed and the page is moving on to it. */
  const placed = ref(false)
  const failure = ref<{ kind: PlaceFailure, message: string } | null>(null)
  const { account, guest } = useCustomerAccount()
  const { signInAsGuest } = useAccountActions()
  const orderSource = useOrderSource()

  /** Places the order; resolves to it, or `null` with `failure` set. `guestName`: without an account. */
  async function place(options: { guestName?: string } = {}): Promise<Order | null> {
    // The total on screen is for the order before the last change: wait for its quote.
    if (placing.value || quoteSettling.value) return null
    // The last refusal stays on screen while placing again: clearing it here would collapse the
    // banner and shift the page, then bring it back when the server refuses again. It is replaced
    // by the next refusal, or dropped on success or when the page's state moves on.
    const current = quote.data.value
    if (current && Date.now() > Date.parse(current.expiresAt)) {
      const before = change.value
      await quote.refresh()
      // New prices since: shown, and the customer places again.
      if (change.value !== before || !quote.data.value?.orderable) {
        failure.value = null
        return null
      }
    }
    const body = placeBody.value
    if (!body || !quote.data.value?.orderable) return null
    placing.value = true
    try {
      // No account and no guest yet: this browser becomes a guest (one per browser, kept for its orders).
      if (!account.value && !guest.value) await signInAsGuest()
      const source = orderSource.current()
      const named = { ...(account.value ? body : { ...body, guestName: options.guestName }), ...(source ? { source } : {}) }
      const order = await apiFetch<Order>('/shop/orders', { method: 'POST', body: named, headers: { 'Idempotency-Key': idempotencyKey.value } })
      failure.value = null
      // Before the cart empties, so the page shows the hand-off, not "Your order is empty".
      placed.value = true
      cart.clear()
      orderSource.clear()
      return order
    }
    catch (error) {
      failure.value = placeFailure(error)
      if (failure.value.kind === 'requote') await quote.refresh()
      // The session ended: read it again, so placing again starts a new one.
      if (failure.value.kind === 'signIn') await invalidate('account')
      return null
    }
    finally {
      placing.value = false
    }
  }

  return {
    /** The branches: until they're known, so isn't the order (kept per branch) nor its table. */
    shop,
    branchId,
    cart,
    table: tableHere,
    clearTable,
    quote,
    quoteSettling,
    change,
    placing,
    placed,
    failure,
    place,
    dismissFailure: () => {
      failure.value = null
    },
  }
}
