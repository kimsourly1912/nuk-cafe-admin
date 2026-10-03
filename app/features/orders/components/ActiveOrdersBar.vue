<script setup lang="ts">
/**
 * The bar above the menu while the customer has an order in progress (step 6.5b, D114, the owner's
 * frame): "Order 042 · Preparing · View", success-colored with "Order 042 is ready"; several open
 * orders: "2 orders in progress · View" to Your orders. It scrolls with the page (the phone header
 * is already tall). Read every 10 seconds while an order is in progress.
 *
 * Mount it only for a signed-in customer (the menu page checks), so other visitors make no request.
 */
import { useCustomerOrders } from '../composables/useOrders'
import { orderBarText } from '../utils/order'

const query = useCustomerOrders({ poll: true })
const orders = computed(() => query.data.value?.inProgress ?? [])
const bar = computed(() => orderBarText(orders.value))
const tenantPath = useTenantPath()
const to = computed(() => tenantPath(orders.value.length === 1 ? `/orders/${encodeURIComponent(orders.value[0]!.id)}` : '/orders'))
</script>

<template>
  <NuxtLink
    v-if="bar"
    :to="to"
    class="flex items-center gap-3 rounded-lg px-4 py-3 ring transition-colors focus-visible:outline-2 focus-visible:outline-primary"
    :class="bar.ready ? 'bg-success/10 text-success ring-success/40 hover:bg-success/15' : 'bg-default text-highlighted ring-default hover:bg-elevated/50'"
  >
    <span
      class="size-2.5 shrink-0 rounded-full"
      :class="bar.ready ? 'bg-success' : 'bg-info'"
      aria-hidden="true"
    />
    <span class="min-w-0 flex-1 truncate font-medium">{{ bar.text }}</span>
    <span class="flex shrink-0 items-center gap-1 text-sm font-medium">
      View
      <UIcon
        name="i-lucide-chevron-right"
        class="size-4"
      />
    </span>
  </NuxtLink>
</template>
