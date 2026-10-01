<script setup lang="ts">
/**
 * Menu items in a category's order (step 10.3, D118; the Add-ons reorder list's pattern, D75): a
 * drag handle (↑/↓ on it also move), the position, the name and whether it's published, and Move
 * up / Move down. Moves change the dialog's pending order only; it saves with Save order. Focus
 * stays on the moved row, and the new position is announced.
 */
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'

const props = defineProps<{ items: MenuItemSummary[], disabled?: boolean }>()
const emit = defineEmits<{ move: [from: number, to: number] }>()

const listEl = useTemplateRef<HTMLElement>('listEl')
const announcement = ref('')

async function move(index: number, to: number, focus: 'up' | 'down' | 'handle') {
  const item = props.items[index]
  if (!item || to < 0 || to >= props.items.length || props.disabled) return
  emit('move', index, to)
  announcement.value = ''
  await nextTick()
  announcement.value = `${item.name} moved to position ${to + 1} of ${props.items.length}`
  // Focus stays on the moved row: the pressed control, or at either end the one still enabled.
  const row = listEl.value?.querySelector<HTMLElement>(`[data-item="${item.id}"]`)
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
      aria-label="Menu items in order"
      class="space-y-2"
    >
      <li
        v-for="(item, i) in items"
        :key="item.id"
        :aria-label="item.name"
        :data-item="item.id"
        class="flex items-center gap-2 rounded-lg border border-default bg-default px-2 py-2 motion-safe:transition-colors"
      >
        <UButton
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          class="cursor-grab touch-none"
          data-handle
          :disabled="disabled"
          :aria-label="`Reorder ${item.name} (drag, or press up or down)`"
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
            {{ item.name }}
          </p>
          <p class="text-sm text-muted">
            {{ item.status === 'draft' ? 'Draft · not on the menu yet' : 'Published' }}
          </p>
        </div>
        <UButton
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          data-move="up"
          :disabled="disabled || i === 0"
          :aria-label="`Move ${item.name} up`"
          @click="move(i, i - 1, 'up')"
        />
        <UButton
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          data-move="down"
          :disabled="disabled || i === items.length - 1"
          :aria-label="`Move ${item.name} down`"
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
