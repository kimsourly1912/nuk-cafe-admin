<script setup lang="ts">
/**
 * A menu item in the grid: image, name, category, price range, status (D70, D89). The name is the
 * card's one record target (page-patterns §2), a button stretched over the whole card, so a click
 * anywhere opens the item, or, in Select mode, selects it. The checkbox (Select mode only) and the
 * ⋮ menu are siblings above it, never nested inside it.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import { ITEM_STATUS_LABELS, priceRange } from '../utils/item-display'

const props = defineProps<{
  item: MenuItemSummary
  actions: DropdownMenuItem[]
  /** Select mode: a checkbox instead of opening. */
  selecting?: boolean
  selected?: boolean
  /** Select mode: this item can be selected (archived ones can't). */
  selectable?: boolean
  /** A save or state change is running for it. */
  busy?: boolean
}>()

const emit = defineEmits<{ open: [], select: [value: boolean] }>()

const muted = computed(() => props.item.status !== 'active')
/** The name opens the item, selects it (Select mode), or does nothing (Select mode, not selectable). */
const target = computed(() => (!props.selecting ? 'open' : props.selectable ? 'select' : undefined))

function onName() {
  if (target.value === 'open') emit('open')
  else if (target.value === 'select') emit('select', !props.selected)
}
</script>

<template>
  <article
    class="relative flex flex-col overflow-hidden rounded-lg border bg-default transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="[selected ? 'border-primary ring-1 ring-primary' : 'border-default', busy && 'pointer-events-none opacity-50']"
    :aria-label="item.name"
    :aria-busy="busy || undefined"
  >
    <div class="relative aspect-4/3 bg-elevated">
      <img
        v-if="item.imageUrl"
        :src="item.imageUrl"
        :alt="item.name"
        loading="lazy"
        class="size-full object-cover"
        :class="item.status === 'archived' && 'grayscale'"
      >
      <div
        v-else
        class="flex size-full items-center justify-center text-dimmed"
      >
        <UIcon
          name="i-lucide-image"
          class="size-10"
        />
      </div>

      <UBadge
        v-if="muted"
        :label="ITEM_STATUS_LABELS[item.status]"
        :color="item.status === 'draft' ? 'warning' : 'neutral'"
        variant="solid"
        size="sm"
        class="absolute bottom-2 left-2"
      />
    </div>

    <div class="flex flex-1 flex-col gap-1 p-3">
      <div class="flex items-start justify-between gap-2">
        <h3 class="min-w-0">
          <!-- after:inset-0 stretches the button over the card: the whole card is its target -->
          <UButton
            v-if="target"
            color="neutral"
            variant="link"
            :aria-label="item.name"
            :tabindex="target === 'select' ? -1 : undefined"
            class="p-0 text-left font-medium after:absolute after:inset-0"
            :class="muted ? 'text-muted' : 'text-highlighted'"
            @click="onName"
          >
            <span class="line-clamp-2 break-words">{{ item.name }}</span>
          </UButton>
          <span
            v-else
            class="line-clamp-2 font-medium text-muted"
          >{{ item.name }}</span>
        </h3>
        <span class="shrink-0 font-semibold tabular-nums">{{ priceRange(item) }}</span>
      </div>
      <p class="truncate text-sm text-muted">
        {{ item.categoryName }}
      </p>
    </div>

    <UCheckbox
      v-if="selecting && selectable"
      :model-value="selected"
      :aria-label="`Select ${item.name}`"
      class="absolute top-2 left-2 rounded bg-default/90 p-1"
      @update:model-value="value => emit('select', !!value)"
    />
    <div class="absolute top-2 right-2">
      <UIcon
        v-if="busy"
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted"
        aria-label="Working…"
      />
      <UDropdownMenu
        v-else-if="!selecting"
        :items="actions"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="solid"
          size="xs"
          class="bg-default/90 text-default hover:bg-default"
          :aria-label="`Actions for ${item.name}`"
        />
      </UDropdownMenu>
    </div>
  </article>
</template>
