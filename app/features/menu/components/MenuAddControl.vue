<script setup lang="ts">
/**
 * The add slot of an item card or row (D93, revised in D124). It changes in place:
 * - an item with nothing to choose: "Add", then a quantity stepper (0 removes it);
 * - an item with choices: "Customize" opens its detail (how many are in the order is the card's to say);
 * - sold out: a disabled "Sold out"; the branch closed: the button disabled.
 * `compact` is the phone row's smaller size.
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
      disabled
    />
    <UButton
      v-else-if="choices"
      label="Customize"
      :size="size"
      :variant="compact ? 'soft' : 'solid'"
      :disabled="closed"
      :aria-label="`Customize ${item.name}`"
      @click="emit('choose')"
    />
    <UInputNumber
      v-else-if="quantity > 0"
      :model-value="quantity"
      :min="0"
      :max="MAX_LINE_QUANTITY"
      :size="size"
      :disabled="closed"
      :aria-label="`Quantity of ${item.name}`"
      class="w-28"
      @update:model-value="value => emit('set-quantity', value ?? 0)"
    />
    <UButton
      v-else
      label="Add"
      icon="i-lucide-plus"
      :size="size"
      :variant="compact ? 'soft' : 'solid'"
      :disabled="closed"
      :aria-label="`Add ${item.name} to order`"
      @click="emit('add')"
    />
  </div>
</template>
