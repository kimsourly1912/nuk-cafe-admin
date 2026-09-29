<script setup lang="ts">
/**
 * The add slot of an item card or row (D93). It changes in place, at the same size:
 * - an item with nothing to choose: "Add to order", then a quantity stepper (0 removes it);
 * - an item with choices: "Add to order" opens its detail, then "2 in order" and "Add another";
 * - sold out, or the branch closed: a disabled button saying so.
 * `compact` is the phone row's smaller "Add"; otherwise the button fills the card's width.
 */
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import { MAX_LINE_QUANTITY } from '../utils/cart'
import { hasChoices } from '../utils/menu'

const props = defineProps<{
  item: PublicMenuItem
  /** Of this item in the order, over all its lines. */
  quantity: number
  closed: boolean
  compact?: boolean
}>()
const emit = defineEmits<{
  /** Add one (an item with nothing to choose). */
  'add': []
  /** A new quantity for its only line (an item with nothing to choose); 0 removes it. */
  'set-quantity': [quantity: number]
  /** Open the detail to choose. */
  'choose': []
}>()

const choices = computed(() => hasChoices(props.item))
const size = computed(() => (props.compact ? 'sm' : 'md'))
</script>

<template>
  <div class="relative z-10">
    <UButton
      v-if="item.soldOut"
      label="Sold out"
      color="neutral"
      variant="soft"
      :size="size"
      :block="!compact"
      disabled
    />
    <UInputNumber
      v-else-if="!choices && quantity > 0"
      :model-value="quantity"
      :min="0"
      :max="MAX_LINE_QUANTITY"
      :size="size"
      :disabled="closed"
      :aria-label="`Quantity of ${item.name}`"
      :class="compact ? 'w-28' : 'w-full'"
      @update:model-value="value => emit('set-quantity', value ?? 0)"
    />
    <div
      v-else-if="choices && quantity > 0"
      class="flex items-center justify-between gap-2"
    >
      <span class="text-sm font-medium text-highlighted">{{ quantity }} in order</span>
      <UButton
        label="Add another"
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        :size="size"
        :disabled="closed"
        :aria-label="`Add another ${item.name}`"
        @click="emit('choose')"
      />
    </div>
    <UButton
      v-else
      :label="compact ? 'Add' : 'Add to order'"
      icon="i-lucide-plus"
      :size="size"
      :block="!compact"
      :variant="compact ? 'soft' : 'solid'"
      :disabled="closed"
      :aria-label="`Add ${item.name} to order`"
      @click="choices ? emit('choose') : emit('add')"
    />
  </div>
</template>
