<script setup lang="ts">
/**
 * One order on the counter's board (D102, D269): the big number and the total, then who and where
 * (the customer's first name, pickup or the table), the items (two lines, so a narrow column still
 * says what to make), the time since it was placed and, while unpaid, the time to pay by (a warning
 * badge in the last 5 minutes). One action: Take payment (opens the order), Mark ready, or Complete.
 * The number and name open the order. The column says the status, so the card carries no color of
 * its own. No dragging between columns: a payment needs its method, and an order only moves forward
 * (the owner's review).
 */
import type { CounterOrder } from '#shared/contracts/orders'
import { firstName, itemCount, itemNames, orderNumber, orderTypeText, payBySoon, timeAgo } from '../utils/counter'

const props = defineProps<{
  order: CounterOrder
  now: number
  isNew: boolean
  busy: boolean
}>()
const emit = defineEmits<{ open: [], action: [] }>()

const unpaid = computed(() => props.order.status === 'awaiting_payment')
const soon = computed(() => unpaid.value && payBySoon(props.order, props.now))
const action = computed(() => {
  switch (props.order.status) {
    case 'awaiting_payment': return { label: 'Take payment', color: 'primary' as const, variant: 'solid' as const, icon: 'i-lucide-wallet' }
    case 'preparing': return { label: 'Mark ready', color: 'neutral' as const, variant: 'outline' as const, icon: 'i-lucide-bell-ring' }
    default: return { label: 'Complete', color: 'success' as const, variant: 'subtle' as const, icon: 'i-lucide-circle-check' }
  }
})
</script>

<template>
  <article
    class="rounded-lg bg-default p-3 ring transition-opacity dark:bg-elevated"
    :class="[isNew ? 'ring-2 ring-primary' : 'ring-default dark:ring-accented', busy && 'opacity-60']"
    :aria-label="`Order ${orderNumber(order)}`"
    :aria-busy="busy"
  >
    <!-- The number is the button, stretched over this block (D152): "Open order 042" holds the 042 it shows -->
    <div class="relative">
      <div class="flex flex-wrap items-center justify-between gap-x-2">
        <span class="flex items-center gap-2">
          <button
            type="button"
            class="text-start text-3xl font-bold tabular-nums text-highlighted after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary"
            @click="emit('open')"
          >
            <span class="sr-only">Open order </span>{{ orderNumber(order) }}
          </button>
          <UBadge
            v-if="isNew"
            label="New"
            color="primary"
            variant="subtle"
          />
        </span>
        <span class="text-base font-semibold tabular-nums text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
      </div>
      <p class="mt-1 truncate text-sm font-medium text-highlighted">
        {{ firstName(order.customer.name) }}
      </p>
      <p class="text-sm break-words text-muted">
        {{ orderTypeText(order) }}
      </p>
    </div>

    <p class="mt-2 line-clamp-2 text-sm text-default">
      <span class="font-medium text-highlighted">{{ itemCount(order) }}</span> · {{ itemNames(order) }}
    </p>

    <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
      <span>{{ timeAgo(order.placedAt, now) }}</span>
      <UBadge
        v-if="soon"
        :label="`Pay by ${formatTime(order.paymentDueAt)}`"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock"
      />
      <span v-else-if="unpaid">Pay by {{ formatTime(order.paymentDueAt) }}</span>
    </div>

    <UButton
      :label="action.label"
      :color="action.color"
      :variant="action.variant"
      :icon="action.icon"
      :loading="busy"
      :disabled="busy"
      block
      size="lg"
      class="mt-3"
      :aria-label="`${action.label}: order ${orderNumber(order)}`"
      @click="emit('action')"
    />
  </article>
</template>
