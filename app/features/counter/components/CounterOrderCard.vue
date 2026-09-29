<script setup lang="ts">
/**
 * One order on the counter's board (D102, the owner's frames): the big number, pickup or the table,
 * the customer's first name, the items, the total, the time since it was placed and, while unpaid,
 * the time to pay by (amber in the last 5 minutes). One action: Take payment (opens the order),
 * Mark ready, or Complete. The number and name open the order. No dragging between columns: a
 * payment needs its method, and an order only moves forward (the owner's review).
 */
import type { CounterOrder } from '#shared/contracts/orders'
import { clockTime, firstName, itemCount, itemNames, orderNumber, orderTypeText, payBySoon, timeAgo } from '../utils/counter'

const props = defineProps<{
  order: CounterOrder
  now: number
  isNew: boolean
  busy: boolean
}>()
const emit = defineEmits<{ open: [], action: [] }>()

const soon = computed(() => props.order.status === 'awaiting_payment' && payBySoon(props.order, props.now))
const action = computed(() => {
  switch (props.order.status) {
    case 'awaiting_payment': return { label: 'Take payment', color: 'primary' as const, variant: 'solid' as const }
    case 'preparing': return { label: 'Mark ready', color: 'neutral' as const, variant: 'outline' as const }
    default: return { label: 'Complete', color: 'success' as const, variant: 'subtle' as const, icon: 'i-lucide-circle-check' }
  }
})
</script>

<template>
  <article
    class="rounded-lg bg-default p-3 ring ring-default transition-opacity"
    :class="[isNew && 'ring-2 ring-primary', busy && 'opacity-60']"
    :aria-label="`Order ${orderNumber(order)}`"
    :aria-busy="busy"
  >
    <button
      type="button"
      class="-m-1 flex w-[calc(100%+0.5rem)] items-start gap-3 rounded-md p-1 text-start focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`Open order ${orderNumber(order)}`"
      @click="emit('open')"
    >
      <span class="text-3xl font-bold tabular-nums text-highlighted">{{ orderNumber(order) }}</span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-x-2 text-sm">
          <span class="font-medium text-highlighted">{{ orderTypeText(order) }}</span>
          <UBadge
            v-if="isNew"
            label="New"
            color="primary"
            variant="subtle"
            size="sm"
          />
        </span>
        <span class="block truncate text-sm text-muted">{{ firstName(order.customer.name) }}</span>
      </span>
    </button>

    <p class="mt-2 truncate text-sm">
      <span class="font-medium text-highlighted">{{ itemCount(order) }}</span>
      <span class="text-muted"> · {{ itemNames(order) }}</span>
    </p>

    <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span class="font-semibold text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
      <span class="text-muted">{{ timeAgo(order.placedAt, now) }}</span>
      <span
        v-if="order.status === 'awaiting_payment'"
        :class="soon ? 'font-medium text-warning' : 'text-muted'"
      >Pay by {{ clockTime(order.paymentDueAt) }}</span>
    </div>

    <UButton
      :label="action.label"
      :color="action.color"
      :variant="action.variant"
      :icon="action.icon"
      :loading="busy"
      :disabled="busy"
      block
      class="mt-3"
      :aria-label="`${action.label}: order ${orderNumber(order)}`"
      @click="emit('action')"
    />
  </article>
</template>
