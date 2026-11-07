<script setup lang="ts">
/**
 * The left panel of the Categories page (D270): the main categories as cards. A card's name shows
 * that category's subcategories beside it, in every mode, because that's the only way to reach them;
 * a card's actions are on the banner of the category it shows. Select mode adds a checkbox as a
 * sibling of the name, Reorder mode the move controls. It opens with the category on show in view.
 */
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import { mainContentsLabel, statusBadge } from '../schemas/category-display'
import type { CategoryGroup } from '../schemas/category-tree'
import CategoryMoveControls from './CategoryMoveControls.vue'
import type { CategoryPageMode } from './CategoryRow.vue'

const props = defineProps<{
  groups: CategoryGroup[]
  /** Every category loaded: a card's counts don't change with the search or tab. */
  categories: MenuCategory[]
  /** The category on show beside the list, if any. */
  currentId?: string
  mode: CategoryPageMode
  /** Reorder mode and nothing saving: moves are allowed. */
  movable: boolean
  showStatus: boolean
  /** Select mode: the status a card must have to be selectable (the view's). */
  selectableStatus?: MenuCategory['status']
  isSelected: (category: MenuCategory) => boolean
  isBusy: (id: string) => boolean
}>()

const emit = defineEmits<{
  show: [id: string]
  select: [category: MenuCategory, value: boolean]
  move: [from: number, to: number]
}>()

const activeSubs = (id: string) => props.categories.filter(c => c.parentId === id && c.status === 'active')
const selectable = (category: MenuCategory) => props.mode === 'select' && category.status === props.selectableStatus

function meta(group: CategoryGroup) {
  const contents = mainContentsLabel(group.main, activeSubs(group.main.id))
  if (props.mode !== 'select') return contents
  const picked = group.subs.filter(props.isSelected).length
  return picked ? `${contents} · ${picked} selected` : contents
}

const listEl = useTemplateRef<HTMLElement>('listEl')
// Moved by a chevron or key, a category slides to its new place (a drag has Sortable's animation).
const { moveClass, onStart, onEnd } = useReorderTransition(() => props.movable)
const sortable = useSortable(listEl, [], {
  handle: '[data-main-handle]',
  animation: 150,
  watchElement: true,
  onStart,
  onEnd,
  // Sortable moves the DOM node; put it back and move the data instead, so Vue owns the rows.
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    emit('move', event.oldIndex!, event.newIndex!)
  },
})
watchEffect(() => sortable.option('disabled', !props.movable))

onMounted(() => {
  // A link to a category far down the list. `nearest`: only as far as it takes.
  listEl.value?.querySelector(`[data-main="${props.currentId}"]`)?.scrollIntoView({ block: 'nearest' })
})

/** Moves a category; focus stays on the control that moved it, or its handle at either end. */
async function move(index: number, by: -1 | 1, focus: string) {
  const id = props.groups[index]?.main.id
  if (!id || index + by < 0 || index + by >= props.groups.length) return
  emit('move', index, index + by)
  await nextTick()
  const card = listEl.value?.querySelector<HTMLElement>(`[data-main="${id}"]`)
  const target = card?.querySelector<HTMLElement>(`${focus}:not(:disabled)`) ?? card?.querySelector<HTMLElement>('[data-main-handle]')
  target?.focus()
}

function onHandleKey(event: KeyboardEvent, index: number) {
  const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : undefined
  if (by === undefined) return
  event.preventDefault()
  move(index, by, '[data-main-handle]')
}
</script>

<template>
  <section class="space-y-3">
    <h2 class="font-semibold text-highlighted">
      Main categories
    </h2>

    <div
      ref="listEl"
      role="list"
      aria-label="Categories"
      class="space-y-2"
    >
      <TransitionGroup :move-class="moveClass">
        <div
          v-for="(group, i) in groups"
          :key="group.main.id"
          role="listitem"
          :aria-label="group.main.name"
          :data-main="group.main.id"
          class="flex items-center gap-1 rounded-lg border bg-default p-1.5 transition-colors"
          :class="[
            group.main.id === currentId ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-default',
            isBusy(group.main.id) && 'pointer-events-none opacity-50',
          ]"
          :aria-busy="isBusy(group.main.id) || undefined"
        >
          <CategoryMoveControls
            v-if="mode === 'reorder'"
            :id="group.main.id"
            :name="group.main.name"
            level="main"
            :can-move-up="movable && i > 0"
            :can-move-down="movable && i < groups.length - 1"
            @move="by => move(i, by, by < 0 ? '[data-move=up]' : '[data-move=down]')"
            @handle-keydown="onHandleKey($event, i)"
          />

          <div
            v-if="mode === 'select'"
            class="flex size-8 shrink-0 items-center justify-center"
          >
            <UCheckbox
              v-if="selectable(group.main)"
              :model-value="isSelected(group.main)"
              :aria-label="`Select ${group.main.name}`"
              @update:model-value="value => emit('select', group.main, !!value)"
            />
          </div>

          <!-- The name is the button, stretched over the block (D152): its name is the text on it -->
          <div class="relative flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 hover:bg-elevated/50">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-md"
              :class="[group.main.id === currentId ? 'bg-default' : 'bg-elevated', mode === 'reorder' && 'max-lg:hidden']"
            >
              <UIcon
                name="i-lucide-tags"
                class="size-5 text-muted"
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2">
                <UButton
                  color="neutral"
                  variant="link"
                  :aria-current="group.main.id === currentId || undefined"
                  class="min-h-6 p-0 text-left font-semibold text-highlighted after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-primary"
                  @click="emit('show', group.main.id)"
                >
                  <span class="line-clamp-2 break-words">{{ group.main.name }}</span>
                </UButton>
                <UBadge
                  v-if="showStatus"
                  v-bind="statusBadge(group.main.status)"
                />
              </div>
              <p
                class="text-sm break-words"
                :class="group.main.id === currentId ? 'text-default' : 'text-muted'"
              >
                {{ meta(group) }}
              </p>
            </div>

            <!-- Below `lg` a card opens its own screen: in a mode, only one with subcategories to reach.
                 Inside the block and not a target itself (a masked icon paints over the name's stretched
                 target), so a tap on › opens it too. -->
            <UIcon
              v-if="!isBusy(group.main.id) && (mode === 'browse' || group.subs.length)"
              name="i-lucide-chevron-right"
              class="pointer-events-none size-5 shrink-0 text-muted lg:hidden"
            />
            <UIcon
              v-if="isBusy(group.main.id)"
              name="i-lucide-loader-circle"
              class="size-5 shrink-0 animate-spin text-muted"
              aria-label="Working…"
            />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </section>
</template>
