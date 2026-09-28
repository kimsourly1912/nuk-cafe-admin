<script setup lang="ts">
/**
 * A top-level category and its subcategories: a bordered card on small screens, a section of the
 * bordered list from `md` (D72). Subcategories reorder among themselves only, by dragging their
 * handle, ↑/↓ on a focused handle, or the Move up / Move down buttons; they never move to another
 * parent here (that's the Edit form's parent field). An active parent ends with "Add subcategory".
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import type { CategoryGroup } from '../schemas/category-tree'
import type { CategoryPageMode } from './CategoryRow.vue'
import CategoryRow from './CategoryRow.vue'

const props = defineProps<{
  group: CategoryGroup
  mode: CategoryPageMode
  /** Reorder mode and nothing saving: moves are allowed. */
  movable: boolean
  expanded: boolean
  showStatus: boolean
  /** Select mode: the status a row must have to be selectable (the view's). */
  selectableStatus?: MenuCategory['status']
  /** This group's position among the top-level categories (reorder). */
  index: number
  count: number
  actions: (category: MenuCategory) => DropdownMenuItem[]
  isSelected: (category: MenuCategory) => boolean
  isBusy: (id: string) => boolean
  ruleTimes?: ReadonlyMap<string, string>
}>()

const emit = defineEmits<{
  'open': [category: MenuCategory]
  'select': [category: MenuCategory, value: boolean]
  'toggle': []
  'add-sub': []
  'move-main': [by: -1 | 1]
  'main-handle-keydown': [event: KeyboardEvent]
  'move-sub': [from: number, to: number]
}>()

const main = computed(() => props.group.main)
/** "Add subcategory" closes the group of an active parent that has subcategories (browse mode). */
const showAdd = computed(() => props.mode === 'browse' && main.value.status === 'active' && !props.group.contextOnly && props.group.subs.length > 0)
const selectable = (category: MenuCategory) => props.mode === 'select' && category.status === props.selectableStatus

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
watchEffect(() => subsSortable.option('disabled', !props.movable))

/** Moves a subcategory and keeps focus on the control that moved it, so it can be pressed again. */
async function moveSub(index: number, to: number, focus: string) {
  const id = props.group.subs[index]?.id
  emit('move-sub', index, to)
  await nextTick()
  const row = subsEl.value?.querySelector<HTMLElement>(`[data-sub="${id}"]`)
  // At the top or bottom its button is disabled: the handle takes the focus then.
  const target = row?.querySelector<HTMLElement>(`${focus}:not(:disabled)`) ?? row?.querySelector<HTMLElement>('[data-sub-handle]')
  target?.focus()
}

function onSubKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  moveSub(index, to, '[data-sub-handle]')
}

/** Subs that can move: only active ones have a position (archived ones aren't in the order). */
const activeSubs = computed(() => props.group.subs.filter(s => s.status === 'active').length)
</script>

<template>
  <div
    role="listitem"
    :aria-label="main.name"
    :data-main="main.id"
    class="overflow-hidden rounded-lg border border-default bg-default md:rounded-none md:border-0"
  >
    <CategoryRow
      :category="main"
      level="main"
      :mode="mode"
      :actions="actions(main)"
      :show-status="showStatus"
      :selected="isSelected(main)"
      :selectable="selectable(main)"
      :busy="isBusy(main.id)"
      :context-only="group.contextOnly"
      :sub-count="group.subs.length"
      :expanded="expanded"
      :rule-times="ruleTimes"
      :can-move-up="movable && index > 0"
      :can-move-down="movable && index < count - 1"
      @open="emit('open', main)"
      @select="value => emit('select', main, value)"
      @toggle="emit('toggle')"
      @move="by => emit('move-main', by)"
      @handle-keydown="emit('main-handle-keydown', $event)"
    />
    <div
      v-show="expanded || mode === 'reorder'"
      :id="`subcategories-${main.id}`"
      class="border-t border-default"
    >
      <div
        ref="subsEl"
        role="list"
        :aria-label="`Subcategories of ${main.name}`"
        class="divide-y divide-default"
      >
        <CategoryRow
          v-for="(sub, i) in group.subs"
          :key="sub.id"
          role="listitem"
          :aria-label="sub.name"
          :data-sub="sub.id"
          :category="sub"
          level="sub"
          :mode="mode"
          :actions="actions(sub)"
          :show-status="showStatus"
          :selected="isSelected(sub)"
          :selectable="selectable(sub)"
          :busy="isBusy(sub.id)"
          :can-move-up="movable && i > 0"
          :can-move-down="movable && i < activeSubs - 1"
          :last="!showAdd && i === group.subs.length - 1"
          :rule-times="ruleTimes"
          @open="emit('open', sub)"
          @select="value => emit('select', sub, value)"
          @move="by => moveSub(i, i + by, by < 0 ? '[data-move=up]' : '[data-move=down]')"
          @handle-keydown="onSubKey($event, i)"
        />
      </div>
      <div
        v-if="showAdd"
        class="relative flex min-h-12 items-center border-t border-default pl-16 pr-3 md:pl-18"
      >
        <span
          aria-hidden="true"
          class="absolute left-7 top-0 h-1/2 border-l border-dashed border-accented md:left-8"
        />
        <span
          aria-hidden="true"
          class="absolute left-7 top-1/2 w-4 border-t border-dashed border-accented md:left-8"
        />
        <UButton
          label="Add subcategory"
          icon="i-lucide-plus"
          variant="link"
          :aria-label="`Add subcategory to ${main.name}`"
          @click="emit('add-sub')"
        />
      </div>
    </div>
  </div>
</template>
