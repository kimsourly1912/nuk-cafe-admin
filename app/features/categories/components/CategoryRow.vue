<script setup lang="ts">
/**
 * One category in the tree: [drag handle] [expand toggle / indent] [checkbox] name · status · ⋮.
 * Main and sub handles have different attributes (`data-main-handle` / `data-sub-handle`), so
 * dragging a sub never drags its whole group.
 * Clicking the row opens it; the handle, toggle, checkbox and menu don't.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'

const props = defineProps<{
  category: CategoryResponse
  level: 'main' | 'sub'
  actions: DropdownMenuItem[]
  selected: boolean
  busy?: boolean
  /** Show the drag handle (reordering is possible). */
  sortable?: boolean
  /** Shown only as the parent of matching sub-categories. */
  contextOnly?: boolean
  /** Main rows: number of sub-categories and whether they're shown. */
  subCount?: number
  expanded?: boolean
}>()

const emit = defineEmits<{
  'open': []
  'select': [value: boolean]
  'toggle': []
  'handle-keydown': [event: KeyboardEvent]
}>()

const name = computed(() => props.category.categoryName ?? `#${props.category.id}`)
const inactive = computed(() => props.category.status === 'INACTIVE')

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label')) return
  emit('open')
}
</script>

<template>
  <div
    class="flex cursor-pointer items-center gap-2 border-b border-default py-2 pr-2 transition-colors hover:bg-elevated/50"
    :class="[level === 'sub' ? 'pl-2' : 'pl-2 bg-elevated/25', selected && 'bg-primary/10', busy && 'pointer-events-none opacity-50']"
    :aria-busy="busy || undefined"
    @click="onClick"
  >
    <UButton
      v-if="sortable"
      icon="i-lucide-grip-vertical"
      color="neutral"
      variant="ghost"
      size="xs"
      class="cursor-grab"
      v-bind="{ [level === 'main' ? 'data-main-handle' : 'data-sub-handle']: category.id }"
      :aria-label="`Reorder ${name} (drag, or press up or down)`"
      @keydown="emit('handle-keydown', $event)"
    />
    <span
      v-else
      class="w-6"
    />

    <UButton
      v-if="level === 'main'"
      :icon="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
      color="neutral"
      variant="ghost"
      size="xs"
      :disabled="!subCount"
      :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${name}`"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    />
    <span
      v-else
      class="w-10"
    />

    <UCheckbox
      :model-value="selected"
      :aria-label="`Select ${name}`"
      @update:model-value="value => emit('select', !!value)"
    />

    <div class="min-w-0 flex-1 pl-1">
      <span
        class="truncate"
        :class="[level === 'main' ? 'font-medium text-highlighted' : 'text-default', (inactive || contextOnly) && 'text-muted']"
      >{{ name }}</span>
      <span
        v-if="level === 'main' && subCount !== undefined"
        class="ml-2 text-xs text-muted"
      >{{ subCount }} {{ subCount === 1 ? 'sub-category' : 'sub-categories' }}</span>
    </div>

    <div class="w-20">
      <StatusBadge :status="category.status" />
    </div>

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
        variant="ghost"
        size="sm"
        :aria-label="`Actions for ${name}`"
      />
    </UDropdownMenu>
  </div>
</template>
