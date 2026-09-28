<script setup lang="ts">
/**
 * One active value in the option-set editor (D73), by the editor's mode:
 * - browse: its position, its name and a ⋮ menu (Rename, Archive); while renaming, the default slot
 *   (the inline edit) takes the name's place;
 * - reorder: a drag handle (↑/↓ on it also moves), its position, its name and Move up / Move down.
 *   A row that just moved is highlighted for a moment.
 * The editor owns the data and the focus after a move; this only renders and emits.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionValue } from '#shared/contracts/menu-options'

const props = defineProps<{
  value: OptionValue
  position: number
  mode: 'browse' | 'reorder'
  /** Browse: the ⋮ menu (empty on an archived set: read-only). */
  actions: DropdownMenuItem[]
  renaming?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  highlighted?: boolean
}>()

const emit = defineEmits<{
  'move': [by: -1 | 1]
  'handle-keydown': [event: KeyboardEvent]
}>()

const name = computed(() => props.value.name)
</script>

<template>
  <li
    :aria-label="name"
    :data-value="value.id"
    class="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors duration-500"
    :class="highlighted ? 'border-primary bg-primary/15' : 'border-default bg-default'"
  >
    <UButton
      v-if="mode === 'reorder'"
      icon="i-lucide-grip-vertical"
      color="neutral"
      variant="ghost"
      class="cursor-grab touch-none"
      data-value-handle
      :aria-label="`Reorder ${name} (drag, or press up or down)`"
      @keydown="emit('handle-keydown', $event)"
    />
    <UBadge
      :label="String(position)"
      color="neutral"
      variant="soft"
      aria-hidden="true"
      class="shrink-0"
    />

    <div class="min-w-0 flex-1">
      <slot v-if="renaming" />
      <span
        v-else
        class="block break-words text-default"
      >{{ name }}</span>
    </div>

    <template v-if="mode === 'reorder'">
      <UButton
        icon="i-lucide-arrow-up"
        color="neutral"
        variant="ghost"
        :disabled="!canMoveUp"
        data-move="up"
        :aria-label="`Move ${name} up`"
        @click="emit('move', -1)"
      />
      <UButton
        icon="i-lucide-arrow-down"
        color="neutral"
        variant="ghost"
        :disabled="!canMoveDown"
        data-move="down"
        :aria-label="`Move ${name} down`"
        @click="emit('move', 1)"
      />
    </template>
    <UDropdownMenu
      v-else-if="actions.length && !renaming"
      :items="actions"
      :content="{ align: 'end' }"
    >
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        :aria-label="`Actions for ${name}`"
      />
    </UDropdownMenu>
  </li>
</template>
