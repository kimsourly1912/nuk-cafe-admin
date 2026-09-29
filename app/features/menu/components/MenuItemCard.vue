<script setup lang="ts">
/**
 * One item on the customer menu (D93). From `sm`: a card, the photo on the left, the text on the
 * right and the full-width add slot at the bottom. On phones (`row`): a row, the text on the left
 * with a small "Add", the photo on the right. The name opens the detail; so does the whole card
 * (a stretched button), except the add slot above it.
 */
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import { highlightParts, priceOf } from '../utils/menu'
import MenuAddControl from './MenuAddControl.vue'

const props = defineProps<{
  item: PublicMenuItem
  quantity: number
  closed: boolean
  row?: boolean
  /** Search text to highlight in the name. */
  highlight?: string
}>()
const emit = defineEmits<{ 'open': [], 'add': [], 'set-quantity': [quantity: number] }>()

const price = computed(() => priceOf(props.item))
const nameParts = computed(() => highlightParts(props.item.name, props.highlight ?? ''))
</script>

<template>
  <article
    class="relative flex"
    :class="row ? 'gap-3 py-4' : 'flex-col gap-3 rounded-lg border border-default bg-default p-3'"
    :aria-label="item.name"
  >
    <div
      class="flex min-w-0 flex-1 gap-3"
      :class="row ? 'flex-row-reverse' : ''"
    >
      <div
        class="flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
        :class="row ? 'size-22' : 'size-24'"
      >
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
        <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <span
            class="text-sm font-semibold"
            :class="item.soldOut ? 'text-muted' : 'text-highlighted'"
          >{{ price.from ? `from ${formatMinor(price.minor)}` : formatMinor(price.minor) }}</span>
          <UBadge
            v-if="item.soldOut"
            label="Sold out"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
        <MenuAddControl
          v-if="row"
          :item="item"
          :quantity="quantity"
          :closed="closed"
          compact
          class="mt-2 self-start"
          @add="emit('add')"
          @choose="emit('open')"
          @set-quantity="value => emit('set-quantity', value)"
        />
      </div>
    </div>
    <MenuAddControl
      v-if="!row"
      :item="item"
      :quantity="quantity"
      :closed="closed"
      @add="emit('add')"
      @choose="emit('open')"
      @set-quantity="value => emit('set-quantity', value)"
    />
  </article>
</template>
