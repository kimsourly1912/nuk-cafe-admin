<script setup lang="ts">
/**
 * A menu item in the grid: image, name, category, price range, status. Clicking the card opens it;
 * the checkbox and the ⋮ menu (always visible, for keyboard and touch) don't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import { ITEM_STATUS_LABELS, priceRange } from '../utils/item-display'

const props = defineProps<{
  item: MenuItemSummary
  actions: DropdownMenuItem[]
  selected: boolean
  /** A save or state change is running for it. */
  busy?: boolean
}>()

const emit = defineEmits<{ open: [], select: [value: boolean] }>()

const muted = computed(() => props.item.status !== 'active')

function onClick(event: MouseEvent) {
  // Clicks on the checkbox or the menu are theirs, not "open".
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <article
    class="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-default transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary"
    :class="[selected ? 'border-primary ring-1 ring-primary' : 'border-default', busy && 'pointer-events-none opacity-50']"
    :aria-label="item.name"
    :aria-busy="busy || undefined"
    @click="onClick"
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

      <UCheckbox
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
          v-else
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
        <h3
          class="line-clamp-2 font-medium text-highlighted"
          :class="muted && 'text-muted'"
        >
          {{ item.name }}
        </h3>
        <span class="shrink-0 font-semibold tabular-nums">{{ priceRange(item) }}</span>
      </div>
      <p class="truncate text-sm text-muted">
        {{ item.categoryName }}
      </p>
    </div>
  </article>
</template>
