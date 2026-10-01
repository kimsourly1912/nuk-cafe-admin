<script setup lang="ts">
/**
 * The lines of the order before checkout (D93, D124): name and price, the choices under it, then a
 * trash button and a quantity stepper (from 1: removing is the trash's job, so "−" can't remove a
 * line by accident). A line whose item left the menu or sold out says so, doesn't count, and can
 * only be removed. The panel or sheet around it keeps its header and totals in view.
 */
import type { ResolvedCart } from '../utils/cart'
import { MAX_LINE_QUANTITY } from '../utils/cart'

defineProps<{ cart: ResolvedCart }>()
const emit = defineEmits<{ 'set-quantity': [key: string, quantity: number] }>()
</script>

<template>
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
    aria-label="Items in your order"
  >
    <li
      v-for="line in cart.lines"
      :key="line.key"
      class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
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
          class="shrink-0 font-medium text-highlighted"
        >{{ formatMinor(line.unitPriceMinor * line.quantity) }}</span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="outline"
          size="sm"
          :aria-label="`Remove ${line.name}`"
          @click="emit('set-quantity', line.key, 0)"
        />
        <UInputNumber
          v-if="line.available"
          :model-value="line.quantity"
          :min="1"
          :max="MAX_LINE_QUANTITY"
          size="sm"
          :aria-label="`Quantity of ${line.name}`"
          class="w-28"
          @update:model-value="value => emit('set-quantity', line.key, value ?? 1)"
        />
      </div>
    </li>
  </ul>
</template>
