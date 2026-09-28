<script setup lang="ts">
/**
 * The group page's reorder mode (D75): one row per active add-on with a drag handle (↑/↓ on it also
 * move), its position, name and default price, and Move up / Move down. Moves change the page's
 * pending order only; the page saves it with Save order (one request) or drops it with Cancel.
 * Focus stays on the moved row, and the new position is announced.
 */
import type { Modifier } from '#shared/contracts/menu-modifiers'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import { formatMinor } from '~/utils/money'

const props = defineProps<{ modifiers: Modifier[], disabled?: boolean }>()
const emit = defineEmits<{ move: [from: number, to: number] }>()

const listEl = useTemplateRef<HTMLElement>('listEl')
const announcement = ref('')

async function move(index: number, to: number, focus: 'up' | 'down' | 'handle') {
  const modifier = props.modifiers[index]
  if (!modifier || to < 0 || to >= props.modifiers.length || props.disabled) return
  emit('move', index, to)
  announcement.value = ''
  await nextTick()
  announcement.value = `${modifier.name} moved to position ${to + 1} of ${props.modifiers.length}`
  // Focus stays on the moved row: the pressed control, or at either end the one still enabled.
  const row = listEl.value?.querySelector<HTMLElement>(`[data-modifier="${modifier.id}"]`)
  const pressed = focus === 'handle' ? '[data-handle]' : `[data-move=${focus}]`
  const target = row?.querySelector<HTMLElement>(`${pressed}:not(:disabled)`)
    ?? row?.querySelector<HTMLElement>('[data-move]:not(:disabled)')
    ?? row?.querySelector<HTMLElement>('[data-handle]')
  target?.focus()
}

function onHandleKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  move(index, to, 'handle')
}

// Sortable moves the DOM row; put it back and move the data instead, so Vue owns the rows.
const sortable = useSortable(listEl, [], {
  handle: '[data-handle]',
  animation: 150,
  watchElement: true,
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    move(event.oldIndex!, event.newIndex!, 'handle')
  },
})
watchEffect(() => sortable.option('disabled', !!props.disabled))
</script>

<template>
  <div>
    <ol
      ref="listEl"
      aria-label="Add-ons in order"
      class="space-y-2"
    >
      <li
        v-for="(modifier, i) in modifiers"
        :key="modifier.id"
        :aria-label="modifier.name"
        :data-modifier="modifier.id"
        class="flex items-center gap-2 rounded-lg border border-default bg-default px-2 py-2 motion-safe:transition-colors"
      >
        <UButton
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          class="cursor-grab touch-none"
          data-handle
          :disabled="disabled"
          :aria-label="`Reorder ${modifier.name} (drag, or press up or down)`"
          @keydown="onHandleKey($event, i)"
        />
        <UBadge
          :label="String(i + 1)"
          color="neutral"
          variant="soft"
          aria-hidden="true"
          class="shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="break-words text-highlighted">
            {{ modifier.name }}
          </p>
          <p class="text-sm text-muted">
            {{ formatMinor(modifier.priceDeltaMinor) }}
          </p>
        </div>
        <UButton
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          data-move="up"
          :disabled="disabled || i === 0"
          :aria-label="`Move ${modifier.name} up`"
          @click="move(i, i - 1, 'up')"
        />
        <UButton
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          data-move="down"
          :disabled="disabled || i === modifiers.length - 1"
          :aria-label="`Move ${modifier.name} down`"
          @click="move(i, i + 1, 'down')"
        />
      </li>
    </ol>
    <p
      aria-live="polite"
      class="sr-only"
    >
      {{ announcement }}
    </p>
  </div>
</template>
