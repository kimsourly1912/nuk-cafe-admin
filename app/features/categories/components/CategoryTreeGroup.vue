<script setup lang="ts">
/**
 * A main category and its sub-categories. The subs reorder among themselves only (by dragging
 * their handle, or ↑/↓ on a focused handle): each main category numbers its own subs (D37).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Category } from '#shared/contracts/menu'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import type { CategoryGroup } from '../schemas/category-tree'
import CategoryRow from './CategoryRow.vue'

const props = defineProps<{
  group: CategoryGroup
  sortable: boolean
  expanded: boolean
  actions: (category: Category) => DropdownMenuItem[]
  isSelected: (category: Category) => boolean
  isBusy: (id: string) => boolean
}>()

const emit = defineEmits<{
  'open': [category: Category]
  'select': [category: Category, value: boolean]
  'toggle': []
  'main-handle-keydown': [event: KeyboardEvent]
  'move-sub': [from: number, to: number]
}>()

// Sortable moves the DOM row; put it back and move the data instead, so Vue owns the rows.
const subsEl = useTemplateRef<HTMLElement>('subsEl')
const subsSortable = useSortable(subsEl, [], {
  handle: '[data-sub-handle]',
  animation: 150,
  watchElement: true,
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    emit('move-sub', event.oldIndex!, event.newIndex!)
  },
})
watchEffect(() => subsSortable.option('disabled', !props.sortable))

async function onSubKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  const id = props.group.subs[index]?.id
  emit('move-sub', index, to)
  // Moving a DOM node drops its focus: give it back so ↑/↓ can be pressed again.
  await nextTick()
  subsEl.value?.querySelector<HTMLElement>(`[data-sub-handle="${id}"]`)?.focus()
}
</script>

<template>
  <div
    role="listitem"
    :aria-label="group.main.name"
  >
    <CategoryRow
      :category="group.main"
      level="main"
      :actions="actions(group.main)"
      :selected="isSelected(group.main)"
      :busy="isBusy(group.main.id)"
      :sortable="sortable"
      :context-only="group.contextOnly"
      :sub-count="group.subs.length"
      :expanded="expanded"
      @open="emit('open', group.main)"
      @select="value => emit('select', group.main, value)"
      @toggle="emit('toggle')"
      @handle-keydown="emit('main-handle-keydown', $event)"
    />
    <div
      v-show="expanded"
      ref="subsEl"
      role="list"
      :aria-label="`Sub-categories of ${group.main.name}`"
      class="pl-8"
    >
      <CategoryRow
        v-for="(sub, i) in group.subs"
        :key="sub.id"
        :category="sub"
        level="sub"
        role="listitem"
        :aria-label="sub.name"
        :actions="actions(sub)"
        :selected="isSelected(sub)"
        :busy="isBusy(sub.id)"
        :sortable="sortable"
        @open="emit('open', sub)"
        @select="value => emit('select', sub, value)"
        @handle-keydown="onSubKey($event, i)"
      />
    </div>
  </div>
</template>
