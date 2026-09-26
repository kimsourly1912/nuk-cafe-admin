<script setup lang="ts">
/**
 * Categories as a tree: main categories with their sub-categories nested and collapsible. The
 * whole list is loaded (it's small), so search, status tabs and counts work on the client, and
 * the order is changed by drag and drop per level (docs/plans/list-ui-refresh.md, D37).
 */
import type { BannerProps, DropdownMenuItem } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import { useCategoryMutations } from '../composables/useCategories'
import { useCategoryTree } from '../composables/useCategoryTree'
import CategoryFormModal from './CategoryFormModal.vue'
import CategoryRow from './CategoryRow.vue'
import CategoryTreeGroup from './CategoryTreeGroup.vue'

// --- Filters (kept in the URL) ---
const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
})

const { remove, isBusy } = useCategoryMutations()
const tree = useCategoryTree(filters, id => remove.isRemoved(id))

// Every category shown, in order: for selection and bulk actions.
const rows = computed<CategoryResponse[]>(() => [
  ...tree.tree.value.groups.flatMap(g => [g.main, ...g.subs]),
  ...tree.tree.value.orphans,
])

// --- Collapsing (all expanded; a search shows every match) ---
const collapsed = ref(new Set<number>())
const isExpanded = (id: number) => !!filters.search || !collapsed.value.has(id)
function toggle(id: number) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, c => c.id!, { resetOn: [() => ({ ...filters })] })

async function removeSelected() {
  // Sub-categories go first (batch phases), so a main isn't refused for still having children.
  const result = await remove.executeMany(selection.selected)
  // Keep only the rows that still need attention selected: failed, skipped (busy) and not started.
  selection.select([
    ...result.failed.map(f => f.input.id!),
    ...result.skipped.map(c => c.id!),
    ...result.notStarted.map(c => c.id!),
  ])
}

// --- Row actions ---
function rowActions(category: CategoryResponse): DropdownMenuItem[] {
  const isMain = category.mainCategoryId === undefined || category.mainCategoryId === null
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(category) },
    ...(isMain ? [{ label: 'Add sub-category', icon: 'i-lucide-list-plus', onSelect: () => openForm(undefined, category.id) }] : []),
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => remove.execute(category) },
  ]
}

const formModal = useOverlay().create(CategoryFormModal)
function openForm(category?: CategoryResponse, parentId?: number) {
  formModal.open({ category, parentId })
}

usePageShortcuts({ n: () => openForm() })

// --- Reordering main categories (subs reorder inside their group) ---
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
watchEffect(() => groupsSortable.option('disabled', !tree.sortable.value || tree.saving.value))

/** ↑/↓ on a focused main handle moves the group; focus follows it. */
async function onMainKey(event: KeyboardEvent, index: number) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : undefined
  if (to === undefined) return
  event.preventDefault()
  const id = tree.tree.value.groups[index]?.main.id
  tree.moveMain(index, to)
  await nextTick()
  groupsEl.value?.querySelector<HTMLElement>(`[data-main-handle="${id}"]`)?.focus()
}

// --- Banner: how to reorder, or Save/Discard for an unsaved order ---
// UBanner is a solid one-line bar by default: hints get a quiet panel look and may wrap.
const WRAP_UI = { container: 'h-auto min-h-12 py-2', title: 'whitespace-normal' }
const HINT_UI = { ...WRAP_UI, root: 'bg-elevated/60 ring ring-default', icon: 'text-muted', title: 'whitespace-normal text-default font-normal' }

const banner = computed<BannerProps | undefined>(() => {
  if (tree.isDirty.value || tree.saving.value) {
    return {
      icon: 'i-lucide-save',
      color: 'warning',
      ui: WRAP_UI,
      title: 'The new order isn\'t saved yet.',
      actions: [
        { label: 'Save order', color: 'neutral', loading: tree.saving.value, onClick: () => tree.save() },
        { label: 'Discard', color: 'neutral', variant: 'outline', disabled: tree.saving.value, onClick: () => tree.reset() },
      ],
    }
  }
  if (!tree.sortable.value && tree.total.value > 1) {
    return {
      icon: 'i-lucide-arrow-down-up',
      color: 'neutral',
      ui: HINT_UI,
      title: 'Clear the search and status filter to change the order.',
      actions: [{ label: 'Clear filters', color: 'neutral', variant: 'outline', onClick: () => clearFilters() }],
    }
  }
  return undefined
})

/** While a new order is unsaved, the list must not change under it. */
const filtersLocked = computed(() => tree.isDirty.value || tree.saving.value)
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

      <UDashboardToolbar>
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search categories…"
            :disabled="filtersLocked"
            class="w-64"
          />
          <UIcon
            v-if="tree.refreshing.value"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
          <span
            v-if="tree.sortable.value && tree.total.value > 1"
            class="hidden items-center gap-1 text-xs text-muted sm:flex"
          >
            Drag
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-3"
            />
            to reorder (or focus it and press ↑/↓)
          </span>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <StatusTabs
          v-model="filters.status"
          :counts="tree.counts.value"
          :disabled="filtersLocked"
        />
        <UCheckbox
          v-if="rows.length"
          :model-value="selection.someSelected ? 'indeterminate' : selection.allSelected"
          :label="selection.allSelected ? 'Unselect all' : 'Select all'"
          aria-label="Select all"
          @update:model-value="value => selection.toggleAll(!!value)"
        />
      </div>

      <UBanner
        v-if="banner"
        v-bind="banner"
        class="rounded-md"
      />

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
        class="overflow-hidden rounded-lg border border-default"
      >
        <div
          ref="groupsEl"
          role="list"
          aria-label="Categories"
        >
          <CategoryTreeGroup
            v-for="(group, i) in tree.tree.value.groups"
            :key="group.main.id"
            :group="group"
            :sortable="tree.sortable.value && !tree.saving.value"
            :expanded="isExpanded(group.main.id!)"
            :actions="rowActions"
            :is-selected="selection.isSelected"
            :is-busy="isBusy"
            @open="category => openForm(category)"
            @select="(category, value) => selection.toggle(category, value)"
            @toggle="toggle(group.main.id!)"
            @main-handle-keydown="onMainKey($event, i)"
            @move-sub="(from, to) => tree.moveSub(group.main.id!, from, to)"
          />
        </div>

        <!-- Sub-categories whose main category is gone: shown, not reorderable. -->
        <div
          v-if="tree.tree.value.orphans.length"
          role="list"
          aria-label="Without a main category"
        >
          <p class="border-b border-default bg-elevated/25 px-4 py-2 text-sm text-muted">
            Without a main category
          </p>
          <CategoryRow
            v-for="orphan in tree.tree.value.orphans"
            :key="orphan.id"
            role="listitem"
            :aria-label="orphan.categoryName"
            :category="orphan"
            level="sub"
            :actions="rowActions(orphan)"
            :selected="selection.isSelected(orphan)"
            :busy="isBusy(orphan.id!)"
            class="pl-8"
            @open="openForm(orphan)"
            @select="value => selection.toggle(orphan, value)"
          />
        </div>
      </div>

      <BulkActionsBar
        :count="selection.count"
        @clear="selection.clear()"
      >
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="subtle"
          @click="removeSelected"
        />
      </BulkActionsBar>
    </template>
  </UDashboardPanel>
</template>
