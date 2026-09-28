<script setup lang="ts">
/**
 * Categories as a tree: top-level categories as groups with their subcategories (D37, D72). The
 * whole list is loaded (it's small), so search, status tabs and counts work on the client. Three
 * modes keep the everyday view quiet:
 * - browse: the tree, expand/collapse, row menus (Edit, Add subcategory, Archive / Restore);
 * - select (Active or Archived view): checkboxes and a bar with "Archive selected" or
 *   "Restore selected"; the All view mixes statuses, so it has no bulk actions;
 * - reorder (Active view, no search): drag handles and Move up / Move down per level, then Save
 *   order or Discard. Moving to another parent is done in the Edit form, never by dragging.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { useEventListener, useLocalStorage } from '@vueuse/core'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import { describeWindows, useAvailabilityRuleOptions } from '~/features/availability-rules'
import { useCategoryMutations } from '../composables/useCategories'
import { useCategoryTree } from '../composables/useCategoryTree'
import { rowColumns } from '../schemas/category-display'
import CategoryFormModal from './CategoryFormModal.vue'
import CategoryModeBar from './CategoryModeBar.vue'
import CategoryRestoreModal from './CategoryRestoreModal.vue'
import type { CategoryPageMode } from './CategoryRow.vue'
import CategoryRow from './CategoryRow.vue'
import CategoryTreeGroup from './CategoryTreeGroup.vue'

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

// --- Filters (kept in the URL); the Active tab by default ---
const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: 'active' as string,
})
const view = computed<'all' | MenuCategory['status']>(() => (filters.status === 'active' || filters.status === 'archived' ? filters.status : 'all'))
/** Status badges only where statuses differ or aren't obvious: not repeated on every Active row. */
const showStatus = computed(() => view.value !== 'active')

const { archive, restore, isBusy } = useCategoryMutations()
const tree = useCategoryTree(filters)
const groups = computed(() => tree.tree.value.groups)

// Every category shown, in order.
const rows = computed<MenuCategory[]>(() => [
  ...groups.value.flatMap(g => [g.main, ...g.subs]),
  ...tree.tree.value.orphans,
])

const mode = ref<CategoryPageMode>('browse')

// --- Expand / collapse (a search shows every match); remembered per viewer in this browser ---
const collapsedIds = useLocalStorage<string[]>('categories:collapsed', [])
const collapsed = computed(() => new Set(collapsedIds.value))
const isExpanded = (id: string) => !!filters.search || !collapsed.value.has(id)
const expandable = computed(() => groups.value.filter(g => g.subs.length).map(g => g.main.id))
const allExpanded = computed(() => expandable.value.every(id => !collapsed.value.has(id)))
function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsedIds.value = [...next]
}
function toggleAllGroups() {
  collapsedIds.value = allExpanded.value ? [...expandable.value] : []
}

// --- Select mode: rows of the view's status only, so a bulk action never mixes statuses ---
const selectableRows = computed(() => (view.value === 'all' ? [] : rows.value.filter(c => c.status === view.value)))
const selection = useTableSelection(selectableRows, c => c.id, { resetOn: [() => ({ ...filters })] })

function startSelect() {
  mode.value = 'select'
}
function exitSelect() {
  selection.clear()
  if (mode.value === 'select') mode.value = 'browse'
}
// The All view has no bulk actions.
watch(view, (next) => {
  if (next === 'all') exitSelect()
})

async function runBulk() {
  // Archive: subcategories first (batch phases); restore: parents first.
  const result = await (view.value === 'archived' ? restore : archive).executeMany(selection.selected)
  if (result.cancelled) return
  // Keep only what still needs attention selected: failed, skipped (busy) and not started.
  const keep = [
    ...result.failed.map(f => f.input.id),
    ...result.skipped.map(c => c.id),
    ...result.notStarted.map(c => c.id),
  ]
  selection.select(keep)
  if (!keep.length) exitSelect()
}

// --- Reorder mode: the whole active tree, so starting it clears the search and shows Active ---
const filtersLocked = computed(() => mode.value === 'reorder' || tree.isDirty.value || tree.saving.value)
const movable = computed(() => mode.value === 'reorder' && tree.sortable.value && !tree.saving.value)

function startReorder() {
  exitSelect()
  if (!tree.sortable.value) clearFilters()
  mode.value = 'reorder'
}
function finishReorder() {
  if (tree.isDirty.value) return
  mode.value = 'browse'
}
async function saveOrder() {
  await tree.save()
  if (!tree.isDirty.value) mode.value = 'browse'
}
/** A refused save: why, and whether reloading the versions can fix it. */
const saveConflict = computed(() => tree.saveError.value?.code === 'VERSION_CONFLICT')

const groupsEl = useTemplateRef<HTMLElement>('groupsEl')
const groupsSortable = useSortable(groupsEl, [], {
  handle: '[data-main-handle]',
  animation: 150,
  watchElement: true,
  // Sortable moves the DOM node; put it back and move the data instead, so Vue owns the rows.
  onUpdate: (event) => {
    removeNode(event.item)
    insertNodeAt(event.from, event.item, event.oldIndex!)
    tree.moveMain(event.oldIndex!, event.newIndex!)
  },
})
watchEffect(() => groupsSortable.option('disabled', !movable.value))

/** Moves a top-level category; focus stays on the control that moved it (or its handle). */
async function moveMain(index: number, by: -1 | 1, focus: string) {
  const id = groups.value[index]?.main.id
  if (!id || index + by < 0 || index + by >= groups.value.length) return
  tree.moveMain(index, index + by)
  await nextTick()
  const row = groupsEl.value?.querySelector<HTMLElement>(`[data-main="${id}"] > :first-child`)
  const target = row?.querySelector<HTMLElement>(`${focus}:not(:disabled)`) ?? row?.querySelector<HTMLElement>('[data-main-handle]')
  target?.focus()
}

function onMainKey(event: KeyboardEvent, index: number) {
  const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : undefined
  if (by === undefined) return
  event.preventDefault()
  moveMain(index, by, '[data-main-handle]')
}

// --- Availability: each rule's times, for the tooltips (the library is small and shared) ---
const { data: rules } = useAvailabilityRuleOptions()
const ruleTimes = computed(() => new Map(rules.value.map(rule => [rule.id, describeWindows(rule.windows)])))

// --- Row actions ---
const byId = computed(() => new Map(tree.categories.value.map(c => [c.id, c])))
const archivedSubs = (id: string) => tree.categories.value.filter(c => c.parentId === id && c.status === 'archived').length

const overlay = useOverlay()
/** Restore; a top-level category with archived subcategories asks whether they come back too. */
async function restoreOne(category: MenuCategory) {
  const subs = category.parentId === null ? archivedSubs(category.id) : 0
  if (!subs) return restore.execute(category)
  const answer = await overlay.create(CategoryRestoreModal, { destroyOnClose: true }).open({ category, archivedSubs: subs }).result
  if (answer) await restore.execute({ ...category, withSubcategories: answer.withSubcategories })
}

function rowActions(category: MenuCategory): DropdownMenuItem[] {
  if (category.status === 'archived') {
    // A subcategory comes back only under an active parent.
    const parent = category.parentId ? byId.value.get(category.parentId) : undefined
    const blocked = parent !== undefined && parent.status !== 'active'
    return [{
      label: blocked ? `Restore (restore "${parent.name}" first)` : 'Restore',
      icon: 'i-lucide-archive-restore',
      disabled: blocked,
      onSelect: () => restoreOne(category),
    }]
  }
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(category) },
    // A category holds subcategories or menu items, never both (D44).
    ...(category.parentId === null
      ? [category.itemCount
          ? { label: 'Add subcategory (it holds menu items)', icon: 'i-lucide-list-plus', disabled: true }
          : { label: 'Add subcategory', icon: 'i-lucide-list-plus', onSelect: () => openForm(undefined, category.id) }]
      : []),
    { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute(category) },
  ]
}

const formModal = useOverlay().create(CategoryFormModal)
function openForm(category?: MenuCategory, parentId?: string) {
  // An archived category can't be edited (the server refuses): restore it first.
  if (category?.status === 'archived') return
  formModal.open({ category, parentId })
}

usePageShortcuts({
  n: () => openForm(),
  s: () => {
    if (mode.value === 'browse' && view.value !== 'all' && selectableRows.value.length) startSelect()
  },
  r: () => {
    if (mode.value !== 'reorder' && tree.total.value > 1) startReorder()
  },
})

// Escape leaves Select or Reorder. Not a `defineShortcuts` key: those prevent the default, and
// Escape must still close menus, selects and dialogs first (they win: nothing happens here then).
useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || mode.value === 'browse') return
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
  if (mode.value === 'select') exitSelect()
  else finishReorder()
})
</script>

<template>
  <UDashboardPanel id="categories">
    <template #header>
      <UDashboardNavbar title="Categories">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New category"
            :kbds="['n']"
          >
            <UButton
              label="New category"
              icon="i-lucide-plus"
              @click="openForm()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <!-- On phones the search gives up width so the view buttons stay on screen. -->
      <UDashboardToolbar :ui="{ left: 'min-w-0' }">
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search categories…"
            :disabled="filtersLocked"
            class="w-64 min-w-0 shrink"
          />
          <UIcon
            v-if="tree.refreshing.value"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
          <UButton
            :icon="allExpanded ? 'i-lucide-list-collapse' : 'i-lucide-list-tree'"
            color="neutral"
            variant="outline"
            :aria-label="allExpanded ? 'Collapse all' : 'Expand all'"
            :disabled="!!filters.search || !expandable.length || mode === 'reorder'"
            @click="toggleAllGroups()"
          >
            <span class="hidden lg:inline">{{ allExpanded ? 'Collapse all' : 'Expand all' }}</span>
          </UButton>
          <UTooltip
            text="Reorder categories"
            :kbds="['r']"
          >
            <UButton
              icon="i-lucide-arrow-down-up"
              color="neutral"
              :variant="mode === 'reorder' ? 'soft' : 'outline'"
              aria-label="Reorder"
              :aria-pressed="mode === 'reorder'"
              :disabled="mode === 'reorder' || tree.total.value < 2"
              @click="startReorder()"
            >
              <span class="hidden lg:inline">Reorder</span>
            </UButton>
          </UTooltip>
          <UTooltip
            :text="view === 'all' ? 'Choose Active or Archived to select categories' : 'Select categories to archive or restore'"
            :kbds="view === 'all' ? undefined : ['s']"
          >
            <UButton
              icon="i-lucide-list-checks"
              color="neutral"
              :variant="mode === 'select' ? 'soft' : 'outline'"
              aria-label="Select"
              :aria-pressed="mode === 'select'"
              :disabled="view === 'all' || mode !== 'browse' || !selectableRows.length"
              @click="startSelect()"
            >
              <span class="hidden lg:inline">Select</span>
            </UButton>
          </UTooltip>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div
        class="space-y-4"
        :class="mode !== 'browse' && 'pb-32 md:pb-0'"
      >
        <p class="text-sm text-muted">
          Organize how customers browse your menu.
        </p>

        <StatusTabs
          v-model="filters.status"
          :tabs="TABS"
          :counts="tree.counts.value"
          :disabled="filtersLocked"
        />

        <!-- Selection bar -->
        <CategoryModeBar
          v-if="mode === 'select'"
          label="Bulk actions"
        >
          <div class="flex flex-wrap items-center gap-x-3">
            <span class="font-semibold text-highlighted">{{ selection.count }} selected</span>
            <UButton
              :label="selection.allSelected ? 'Unselect all' : 'Select all'"
              color="neutral"
              variant="link"
              class="px-0"
              @click="selection.toggleAll(!selection.allSelected)"
            />
          </div>
          <template #actions>
            <UButton
              v-if="view === 'archived'"
              label="Restore selected"
              icon="i-lucide-archive-restore"
              :disabled="!selection.count"
              @click="runBulk()"
            />
            <UButton
              v-else
              label="Archive selected"
              icon="i-lucide-archive"
              color="neutral"
              variant="subtle"
              :disabled="!selection.count"
              @click="runBulk()"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              aria-label="Exit selection"
              @click="exitSelect()"
            />
          </template>
        </CategoryModeBar>

        <!-- Reorder bar -->
        <CategoryModeBar
          v-if="mode === 'reorder'"
          label="Reorder"
        >
          <p
            v-if="tree.saveError.value"
            class="text-error"
          >
            {{ saveConflict ? 'Someone else changed these categories. Reload to get their changes; your new order is kept, then save again.' : tree.saveError.value.message }}
          </p>
          <p
            v-else-if="tree.isDirty.value || tree.saving.value"
            class="font-medium text-highlighted"
          >
            The new order isn't saved yet.
          </p>
          <p
            v-else
            class="text-muted"
          >
            Drag a row or use its arrows. Categories move among their siblings only; change a parent in Edit.
          </p>
          <template #actions>
            <UButton
              v-if="saveConflict"
              label="Reload"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              :disabled="tree.saving.value"
              @click="tree.reload()"
            />
            <template v-if="tree.isDirty.value || tree.saving.value">
              <UButton
                label="Discard"
                color="neutral"
                variant="outline"
                :disabled="tree.saving.value"
                @click="tree.reset()"
              />
              <UButton
                label="Save order"
                icon="i-lucide-save"
                :loading="tree.saving.value"
                @click="saveOrder()"
              />
            </template>
            <UButton
              v-else
              label="Done"
              color="neutral"
              variant="outline"
              @click="finishReorder()"
            />
          </template>
        </CategoryModeBar>

        <ApiErrorAlert
          v-if="tree.error.value"
          :error="tree.error.value"
          title="Could not load categories"
          @retry="tree.refresh()"
        />

        <ListSkeleton
          v-else-if="tree.loading.value"
          label="Loading categories…"
        />

        <ListEmptyState
          v-else-if="!rows.length"
          noun="categories"
          :filtered="isFiltered"
          create-label="New category"
          @create="openForm()"
          @clear="clearFilters()"
        />

        <div
          v-else
          class="md:overflow-hidden md:rounded-lg md:border md:border-default"
        >
          <!-- Column headings (desktop) -->
          <div
            class="hidden items-center gap-4 border-b border-default bg-elevated/25 px-4 py-2 text-sm font-medium text-muted"
            :class="rowColumns(showStatus)"
            aria-hidden="true"
          >
            <span>Category</span>
            <span>Contains</span>
            <span>Availability</span>
            <span v-if="showStatus">Status</span>
            <span class="text-right">Actions</span>
          </div>

          <div
            ref="groupsEl"
            role="list"
            aria-label="Categories"
            class="space-y-3 md:space-y-0 md:divide-y md:divide-default"
          >
            <CategoryTreeGroup
              v-for="(group, i) in groups"
              :key="group.main.id"
              :group="group"
              :mode="mode"
              :movable="movable"
              :expanded="isExpanded(group.main.id)"
              :show-status="showStatus"
              :selectable-status="view === 'all' ? undefined : view"
              :index="i"
              :count="groups.length"
              :actions="rowActions"
              :is-selected="selection.isSelected"
              :is-busy="isBusy"
              :rule-times="ruleTimes"
              @open="category => openForm(category)"
              @select="(category, value) => selection.toggle(category, value)"
              @toggle="toggle(group.main.id)"
              @add-sub="openForm(undefined, group.main.id)"
              @move-main="by => moveMain(i, by, by < 0 ? '[data-move=up]' : '[data-move=down]')"
              @main-handle-keydown="onMainKey($event, i)"
              @move-sub="(from, to) => tree.moveSub(group.main.id, from, to)"
            />
          </div>

          <!-- Subcategories whose parent is gone: shown, not reorderable. -->
          <div
            v-if="tree.tree.value.orphans.length"
            role="list"
            aria-label="Without a parent category"
            class="mt-3 overflow-hidden rounded-lg border border-default md:mt-0 md:rounded-none md:border-0 md:border-t"
          >
            <p class="border-b border-default bg-elevated/25 px-4 py-2 text-sm text-muted">
              Without a parent category
            </p>
            <CategoryRow
              v-for="orphan in tree.tree.value.orphans"
              :key="orphan.id"
              role="listitem"
              :aria-label="orphan.name"
              :category="orphan"
              level="sub"
              :mode="mode === 'reorder' ? 'browse' : mode"
              :actions="rowActions(orphan)"
              :show-status="showStatus"
              :selected="selection.isSelected(orphan)"
              :selectable="mode === 'select' && orphan.status === view"
              :busy="isBusy(orphan.id)"
              :rule-times="ruleTimes"
              last
              @open="openForm(orphan)"
              @select="value => selection.toggle(orphan, value)"
            />
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
