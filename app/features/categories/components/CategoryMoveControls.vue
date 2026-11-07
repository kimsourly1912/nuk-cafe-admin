<script setup lang="ts">
/**
 * A category's Reorder mode controls: a drag handle (↑/↓ on it also moves; `touch-none`, so a finger
 * on it drags rather than scrolls the page) and Move up / Move down. `level` names the handle that
 * level's Sortable list looks for.
 */
const props = defineProps<{
  id: string
  name: string
  level: 'main' | 'sub'
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  'move': [by: -1 | 1]
  'handle-keydown': [event: KeyboardEvent]
}>()

const handle = computed(() => ({ [props.level === 'main' ? 'data-main-handle' : 'data-sub-handle']: props.id }))
</script>

<template>
  <div class="flex shrink-0 items-center">
    <UButton
      icon="i-lucide-grip-vertical"
      color="neutral"
      variant="ghost"
      class="cursor-grab touch-none"
      v-bind="handle"
      :aria-label="`Reorder ${name} (drag, or press up or down)`"
      @keydown="emit('handle-keydown', $event)"
    />
    <UButton
      icon="i-lucide-chevron-up"
      color="neutral"
      variant="ghost"
      :disabled="!canMoveUp"
      data-move="up"
      :aria-label="`Move ${name} up`"
      @click="emit('move', -1)"
    />
    <UButton
      icon="i-lucide-chevron-down"
      color="neutral"
      variant="ghost"
      :disabled="!canMoveDown"
      data-move="down"
      :aria-label="`Move ${name} down`"
      @click="emit('move', 1)"
    />
  </div>
</template>
