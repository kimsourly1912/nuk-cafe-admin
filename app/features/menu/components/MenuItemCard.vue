<script setup lang="ts">
/**
 * One item on the customer menu (D93, revised in D124). From `sm`: a white card on the page's gray,
 * the photo on the left and the text on the right; under a line, "N in order" (an item with
 * choices) and the price on the left, the add slot on the right. On phones: a row, the text on the
 * left with the price and a small add slot, the photo on the right. The name opens the detail; so
 * does the whole card (a stretched button), except the add slot above it.
 *
 * Row or card is decided by CSS alone, so the server's page and the browser's agree at every width
 * (D95): the price and the add slot are rendered once per layout, the other hidden (`display: none`,
 * so it's out of the accessibility tree too).
 */
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import { hasChoices, highlightParts, priceOf } from '../utils/menu'
import MenuAddControl from './MenuAddControl.vue'

const props = defineProps<{
  item: PublicMenuItem
  quantity: number
  closed: boolean
  /** Search text to highlight in the name. */
  highlight?: string
}>()
const emit = defineEmits<{ 'open': [], 'add': [], 'set-quantity': [quantity: number] }>()

const price = computed(() => priceOf(props.item))
const nameParts = computed(() => highlightParts(props.item.name, props.highlight ?? ''))
const priceText = computed(() => (price.value.from ? `from ${formatMinor(price.value.minor)}` : formatMinor(price.value.minor)))
/** Lines of an item with choices aren't shown on the card, only how many are in the order. */
const inOrder = computed(() => (hasChoices(props.item) && props.quantity > 0 ? `${props.quantity} in order` : undefined))
</script>

<template>
  <article
    class="relative flex gap-3 py-4 sm:flex-col sm:rounded-lg sm:border sm:border-default sm:bg-default sm:p-4"
    :aria-label="item.name"
  >
    <div class="flex min-w-0 flex-1 gap-3 max-sm:flex-row-reverse sm:gap-4">
      <div class="flex size-22 shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated sm:size-24">
        <img
          v-if="item.imageUrl"
          :src="item.imageUrl"
          alt=""
          loading="lazy"
          class="size-full object-cover"
          :class="{ 'opacity-50 grayscale': item.soldOut }"
        >
        <UIcon
          v-else
          name="i-lucide-coffee"
          class="size-8 text-dimmed"
        />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h3 class="font-medium text-highlighted">
          <button
            type="button"
            class="text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-primary"
            @click="emit('open')"
          >
            <template
              v-for="(part, index) in nameParts"
              :key="index"
            >
              <mark
                v-if="part.match"
                class="rounded-sm bg-primary/15 text-inherit"
              >{{ part.text }}</mark>
              <template v-else>
                {{ part.text }}
              </template>
            </template>
          </button>
        </h3>
        <p
          v-if="item.description"
          class="line-clamp-2 text-sm text-muted"
        >
          {{ item.description }}
        </p>
        <!-- Phones: the price and a small add slot under the text -->
        <div class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 sm:hidden">
          <span
            class="text-sm font-semibold"
            :class="item.soldOut ? 'text-muted' : 'text-highlighted'"
          >{{ priceText }}</span>
          <span
            v-if="inOrder"
            class="text-sm text-muted"
          >· {{ inOrder }}</span>
        </div>
        <MenuAddControl
          :item="item"
          :quantity="quantity"
          :closed="closed"
          compact
          class="mt-2 self-start sm:hidden"
          @add="emit('add')"
          @choose="emit('open')"
          @set-quantity="value => emit('set-quantity', value)"
        />
      </div>
    </div>
    <!-- From sm: under a line, how many are in the order and the price, then the add slot -->
    <div class="mt-auto flex items-end justify-between gap-3 border-t border-default pt-3 max-sm:hidden">
      <div class="min-w-0">
        <p
          v-if="inOrder"
          class="text-sm text-muted"
        >
          {{ inOrder }}
        </p>
        <p
          class="font-semibold"
          :class="item.soldOut ? 'text-muted' : 'text-highlighted'"
        >
          {{ priceText }}
        </p>
      </div>
      <MenuAddControl
        :item="item"
        :quantity="quantity"
        :closed="closed"
        @add="emit('add')"
        @choose="emit('open')"
        @set-quantity="value => emit('set-quantity', value)"
      />
    </div>
  </article>
</template>
