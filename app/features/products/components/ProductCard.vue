<script setup lang="ts">
/**
 * A menu item in the grid: image, name, category, price, status. Clicking the card opens it; the
 * checkbox and the ⋮ menu (always visible, for keyboard and touch) don't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Product } from '#shared/contracts/menu'

const props = defineProps<{
  product: Product
  actions: DropdownMenuItem[]
  selected: boolean
  /** A save or delete is running for it. */
  busy?: boolean
  /** Leave the category out (the grid is grouped by category already). */
  hideCategory?: boolean
}>()

const emit = defineEmits<{ open: [], select: [value: boolean] }>()

const inactive = computed(() => props.product.status === 'INACTIVE')
const details = computed(() => {
  const count = props.product.variantGroups.length
  return [
    props.hideCategory ? undefined : props.product.category.name,
    count ? `${count} ${count === 1 ? 'option group' : 'option groups'}` : undefined,
  ].filter(Boolean).join(' · ')
})

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
    :aria-label="product.name"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <div class="relative aspect-4/3 bg-elevated">
      <img
        v-if="product.image"
        :src="product.image?.url"
        :alt="product.name"
        loading="lazy"
        class="size-full object-cover"
        :class="inactive && 'grayscale'"
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
        :aria-label="`Select ${product.name}`"
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
            :aria-label="`Actions for ${product.name}`"
          />
        </UDropdownMenu>
      </div>
      <UBadge
        v-if="inactive"
        label="Inactive"
        color="neutral"
        variant="solid"
        size="sm"
        class="absolute bottom-2 left-2"
      />
    </div>

    <div class="flex flex-1 flex-col gap-1 p-3">
      <div class="flex items-start justify-between gap-2">
        <h3
          class="line-clamp-2 font-medium text-highlighted"
          :class="inactive && 'text-muted'"
        >
          {{ product.name }}
        </h3>
        <span class="shrink-0 font-semibold tabular-nums">{{ formatMinor(product.priceMinor) }}</span>
      </div>
      <p
        v-if="details"
        class="truncate text-sm text-muted"
      >
        {{ details }}
      </p>
    </div>
  </article>
</template>
