<script setup lang="ts">
/**
 * The order before checkout (D93): its lines with a quantity each (0 removes), the subtotal and
 * "Review order" (`/checkout`, D100; not while closed). A line whose item left the menu or sold
 * out says so and doesn't count. Beside the menu from `lg`; in a bottom sheet below it.
 */
import type { ResolvedCart } from '../utils/cart'
import { MAX_LINE_QUANTITY } from '../utils/cart'

defineProps<{
  cart: ResolvedCart
  /** "Pickup" or "Table 12". */
  orderType: string
  closed: boolean
  closedNote?: string
}>()
const emit = defineEmits<{ 'set-quantity': [key: string, quantity: number] }>()
</script>

<template>
  <section
    aria-labelledby="order-heading"
    class="flex flex-col gap-4"
  >
    <div class="flex items-baseline justify-between gap-2">
      <h2
        id="order-heading"
        class="text-lg font-semibold text-highlighted"
      >
        Your order
      </h2>
      <span class="text-sm text-muted">{{ orderType }}</span>
    </div>

    <div
      v-if="!cart.lines.length"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default px-4 py-8 text-center"
    >
      <UIcon
        name="i-lucide-shopping-bag"
        class="size-8 text-dimmed"
      />
      <p class="font-medium text-highlighted">
        Your order is empty
      </p>
      <p class="text-sm text-muted">
        Add items from the menu.
      </p>
    </div>

    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="line in cart.lines"
        :key="line.key"
        class="flex flex-col gap-2 py-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p
              class="font-medium"
              :class="line.available ? 'text-highlighted' : 'text-muted line-through'"
            >
              {{ line.name }}
            </p>
            <p
              v-if="line.detail"
              class="text-sm text-muted"
            >
              {{ line.detail }}
            </p>
            <UBadge
              v-if="!line.available"
              label="No longer available"
              color="warning"
              variant="subtle"
              size="sm"
              class="mt-1"
            />
          </div>
          <span
            v-if="line.available"
            class="shrink-0 text-sm font-medium text-highlighted"
          >{{ formatMinor(line.unitPriceMinor * line.quantity) }}</span>
        </div>
        <UInputNumber
          v-if="line.available"
          :model-value="line.quantity"
          :min="0"
          :max="MAX_LINE_QUANTITY"
          size="sm"
          :aria-label="`Quantity of ${line.name}`"
          class="w-28"
          @update:model-value="value => emit('set-quantity', line.key, value ?? 0)"
        />
        <UButton
          v-else
          label="Remove"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="link"
          size="sm"
          class="self-start px-0"
          :aria-label="`Remove ${line.name}`"
          @click="emit('set-quantity', line.key, 0)"
        />
      </li>
    </ul>

    <div class="space-y-3 border-t border-default pt-4">
      <div class="flex items-baseline justify-between">
        <span class="text-sm text-muted">Subtotal</span>
        <span class="font-semibold text-highlighted">{{ formatMinor(cart.subtotalMinor) }}</span>
      </div>
      <UButton
        label="Review order"
        to="/checkout"
        block
        :disabled="closed || !cart.count"
      />
      <p
        v-if="closed"
        class="text-center text-sm text-muted"
      >
        {{ closedNote ?? 'Closed now.' }}
      </p>
    </div>
  </section>
</template>
