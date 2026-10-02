<script setup lang="ts">
/**
 * The order before checkout beside the menu, from `lg` (D93): the title with the item count, the
 * order type and "Clear order"; the lines; the subtotal and "Review order". At most as tall as the
 * screen below the header: the title and the totals stay in view, only the lines scroll (D124).
 * Below `lg` the same parts sit in the order drawer's header, body and footer (`MenuPage`).
 */
import type { ResolvedCart } from '../utils/cart'
import OrderActions from './OrderActions.vue'
import OrderLines from './OrderLines.vue'
import OrderTotals from './OrderTotals.vue'

defineProps<{
  cart: ResolvedCart
  /** "Pickup" or "Table 12". */
  orderType: string
  closed: boolean
  closedNote?: string
}>()
const emit = defineEmits<{ 'set-quantity': [key: string, quantity: number], 'set-note': [key: string, note: string], 'clear': [] }>()
</script>

<template>
  <section
    aria-labelledby="order-heading"
    class="flex max-h-[calc(100dvh-var(--shop-header,7rem)-1rem)] flex-col overflow-hidden rounded-lg border border-default bg-default"
  >
    <div class="flex items-start justify-between gap-3 border-b border-default p-4">
      <div>
        <h2
          id="order-heading"
          class="text-lg font-semibold text-highlighted"
        >
          Your order
        </h2>
        <p class="text-sm text-muted">
          {{ pluralize(cart.count, ['item', 'items']) }}
        </p>
      </div>
      <OrderActions
        :order-type="orderType"
        :count="cart.lines.length"
        @clear="emit('clear')"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <OrderLines
        :cart="cart"
        @set-quantity="(key, quantity) => emit('set-quantity', key, quantity)"
        @set-note="(key, note) => emit('set-note', key, note)"
      />
    </div>
    <div class="border-t border-default p-4">
      <OrderTotals
        :subtotal-minor="cart.subtotalMinor"
        :count="cart.count"
        :closed="closed"
        :closed-note="closedNote"
      />
    </div>
  </section>
</template>
