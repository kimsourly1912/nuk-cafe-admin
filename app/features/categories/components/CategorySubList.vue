<script setup lang="ts">
/**
 * The subcategories of the main category on show (D270), in customer order. Keyed by that category
 * on the page, so its Sortable belongs to one list. Subcategories reorder among themselves only, by
 * their handle, ↑/↓ on a focused handle or the Move buttons; another parent is the Edit form's field.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import { contentsLabel, manageItemsPath, newItemPath } from '../schemas/category-display'
import type { CategoryGroup } from '../schemas/category-tree'
import type { CategoryPageMode } from './CategoryRow.vue'
import CategoryRow from './CategoryRow.vue'

const props = defineProps<{
  group: CategoryGroup
  /** It has subcategories of any status, shown or not: then it can't take menu items (the server counts archived ones). */
  hasSubs: boolean
  mode: CategoryPageMode
  /** Reorder mode and nothing saving: moves are allowed. */
  movable: boolean
  /** Positions mean something only over every active sibling: no search, the Active tab. */
  numbered: boolean
  showStatus: boolean
  /** Select mode: the status a row must have to be selectable (the view's). */
  selectableStatus?: MenuCategory['status']
  actions: (category: MenuCategory) => DropdownMenuItem[]
  isSelected: (category: MenuCategory) => boolean
  isBusy: (id: string) => boolean
  ruleTimes?: ReadonlyMap<string, string>
}>()

const emit = defineEmits<{
  open: [category: MenuCategory]
  select: [category: MenuCategory, value: boolean]
  add: []
  move: [from: number, to: number]
}>()

const main = computed(() => props.group.main)
const name = computed(() => main.value.name)
const usable = computed(() => main.value.status === 'active' && !props.group.contextOnly)
/** A category holds subcategories or menu items, never both (D44). */
const holdsItems = computed(() => main.value.itemCount > 0)
/** Holding items too: a new subcategory takes them (D270). */
const showAdd = computed(() => props.mode === 'browse' && usable.value)
const showItems = computed(() => props.mode === 'browse' && usable.value && !props.hasSubs)
/** Nothing listed though it has some (the search or tab leaves them out), or nothing can be added. */
const showNone = computed(() => !props.group.subs.length && !holdsItems.value && (props.hasSubs || !showAdd.value))

const tenantPath = useTenantPath()

const selectable = (category: MenuCategory) => props.mode === 'select' && category.status === props.selectableStatus

// Sortable moves the DOM row; put it back and move the data instead, so Vue owns the rows.
const listEl = useTemplateRef<HTMLElement>('listEl')
// Moved by a chevron or key, a subcategory slides to its new place.
const { moveClass, onStart, onEnd } = useReorderTransition(() => props.movable)
const sortable = useSortable(listEl, [], {
  handle: '[data-sub-handle]',
  animation: 150,
  watchElement: true,
  onStart,
  onEnd,
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    emit('move', event.oldIndex!, event.newIndex!)
  },
})
watchEffect(() => sortable.option('disabled', !props.movable))

/** Moves a subcategory and keeps focus on the control that moved it, so it can be pressed again. */
async function move(index: number, to: number, focus: string) {
  const id = props.group.subs[index]?.id
  if (to < 0 || to >= activeSubs.value) return
  emit('move', index, to)
  await nextTick()
  const row = listEl.value?.querySelector<HTMLElement>(`[data-sub="${id}"]`)
  // At the top or bottom its button is disabled: the handle takes the focus then.
  const target = row?.querySelector<HTMLElement>(`${focus}:not(:disabled)`) ?? row?.querySelector<HTMLElement>('[data-sub-handle]')
  target?.focus()
}

function onHandleKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  move(index, to, '[data-sub-handle]')
}

/** Subs that can move: only active ones have a position (archived ones aren't in the order). */
const activeSubs = computed(() => props.group.subs.filter(s => s.status === 'active').length)
</script>

<template>
  <div class="@container space-y-4">
    <section
      v-if="showAdd || !holdsItems || group.subs.length"
      class="space-y-3"
    >
      <div>
        <h3 class="font-semibold text-highlighted">
          Subcategories in {{ name }}
        </h3>
        <p
          v-if="numbered && group.subs.length"
          class="text-sm text-muted"
        >
          Customers see them in this order.
        </p>
      </div>

      <div
        ref="listEl"
        role="list"
        :aria-label="`Subcategories of ${name}`"
        class="space-y-2"
      >
        <TransitionGroup :move-class="moveClass">
          <CategoryRow
            v-for="(sub, i) in group.subs"
            :key="sub.id"
            role="listitem"
            :aria-label="sub.name"
            :data-sub="sub.id"
            :category="sub"
            :mode="mode"
            :actions="actions(sub)"
            :show-status="showStatus"
            :selected="isSelected(sub)"
            :selectable="selectable(sub)"
            :busy="isBusy(sub.id)"
            :position="numbered && sub.status === 'active' ? i + 1 : undefined"
            :can-move-up="movable && i > 0"
            :can-move-down="movable && i < activeSubs - 1"
            :rule-times="ruleTimes"
            @open="emit('open', sub)"
            @select="value => emit('select', sub, value)"
            @move="by => move(i, i + by, by < 0 ? '[data-move=up]' : '[data-move=down]')"
            @handle-keydown="onHandleKey($event, i)"
          />
        </TransitionGroup>
      </div>

      <p
        v-if="showNone"
        class="text-sm text-muted"
      >
        No subcategories to show here.
      </p>

      <UButton
        v-if="showAdd"
        label="Add subcategory"
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        :aria-label="`Add subcategory to ${name}`"
        @click="emit('add')"
      />
    </section>

    <!-- A category without subcategories holds menu items (or can): they're managed on their own page. -->
    <div
      v-if="showItems"
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-default p-3"
    >
      <p class="flex min-w-0 items-center gap-2 font-medium text-highlighted">
        <UIcon
          name="i-lucide-utensils"
          class="size-4 shrink-0 text-muted"
        />
        <span class="break-words">Menu items in {{ name }}</span>
        <span class="text-sm font-normal text-muted">{{ contentsLabel(main) }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          label="Add menu item"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          :to="tenantPath(newItemPath(main.id))"
          :aria-label="`Add menu item to ${name}`"
        />
        <UButton
          label="Manage items"
          trailing-icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          :to="tenantPath(manageItemsPath(main.id))"
          :aria-label="`Manage items in ${name}`"
        />
      </div>
    </div>
  </div>
</template>
