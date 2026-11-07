<script setup lang="ts">
/**
 * Categories as two panels (D270, replacing the tree of D37 and D72): the main categories on the left,
 * and beside them a banner and the subcategories of the one on show (`?category=`, else the first).
 * Below `lg` they're one screen at a time: the list, then the category pushed over it. Select and
 * Reorder work the same way, one level at a time, starting from the list; a card with subcategories
 * steps into them, and the bar and the selection or new order carry over. From `lg` the page
 * scrolls as one, with no scrolling box inside it, and the category on show stays pinned beside a long
 * list. The whole list is loaded (it's small), so search, status tabs and counts work on the client. Three modes keep the
 * everyday view quiet:
 * - browse: a main category's name shows it, a subcategory's opens Edit; Edit details and the row
 *   menus (Add subcategory, Manage items, Archive / Restore);
 * - select (Active or Archived view): checkboxes and a bar with "Archive selected" or
 *   "Restore selected", across every category; the All view mixes statuses, so it has no bulk actions;
 * - reorder (Active view, no search): drag handles and Move up / Move down per level, then Save
 *   order or Discard. Moving to another parent is done in the Edit form, never by dragging.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { useEventListener } from '@vueuse/core'
import { describeWindows, useAvailabilityRuleOptions } from '~/features/availability-rules'
import { DELETE_BLOCKED, useCategoryMutations } from '../composables/useCategories'
import { useCategoryTree } from '../composables/useCategoryTree'
import { mainSummaryLabel, manageItemsPath, newItemPath } from '../schemas/category-display'
import CategoryBanner from './CategoryBanner.vue'
import CategoryFormModal from './CategoryFormModal.vue'
import CategoryMainList from './CategoryMainList.vue'
import CategoryRestoreModal from './CategoryRestoreModal.vue'
import type { CategoryPageMode } from './CategoryRow.vue'
import CategoryRow from './CategoryRow.vue'
import CategorySubList from './CategorySubList.vue'

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

const { archive, restore, remove, isBusy } = useCategoryMutations()
// A deleted row goes at once, before the refetch arrives.
const tree = useCategoryTree(filters, id => remove.isRemoved(id))
const groups = computed(() => tree.tree.value.groups)

// Every category shown, in order.
const rows = computed<MenuCategory[]>(() => [
  ...groups.value.flatMap(g => [g.main, ...g.subs]),
  ...tree.tree.value.orphans,
])

const mode = ref<CategoryPageMode>('browse')

// --- Select mode: rows of the view's status only, so a bulk action never mixes statuses ---
const selectableRows = computed(() => (view.value === 'all' ? [] : rows.value.filter(c => c.status === view.value)))
const selection = useTableSelection(selectableRows, c => c.id, { resetOn: [() => ({ ...filters })] })

function startSelect() {
  // Below `lg` a mode starts from the main categories: the level you can't reach from a category.
  if (!isExpanded.value) show(undefined)
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
  if (!isExpanded.value) show(undefined)
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

// --- The main category on show: in the URL, so a reload or shared link keeps it ---
const route = useRoute()
const router = useRouter()
const { isExpanded } = useLayoutContext()
const categoryInUrl = () => typeof route.query.category === 'string' ? route.query.category : undefined
const shownId = ref(categoryInUrl())
watch(categoryInUrl, (id) => {
  shownId.value = id
})

function writeShownToUrl(push: boolean) {
  if (categoryInUrl() === shownId.value) return
  const { category: _, ...query } = route.query
  const next = { query: shownId.value ? { ...query, category: shownId.value } : query }
  if (push) router.push(next)
  else router.replace(next)
}
/**
 * Below `lg` opening one from the list is a step Back returns from; the pills then swap it in
 * place, so Back still returns to the list. In Reorder mode the URL waits until the mode
 * ends: every route change asks about unsaved changes, and looking at another category's subcategories
 * while reordering isn't leaving.
 */
function show(id: string | undefined) {
  shownId.value = id
  if (mode.value !== 'reorder') writeShownToUrl(!isExpanded.value && !!id && !categoryInUrl() && mode.value === 'browse')
}

/**
 * A card's name. Below `lg` in a mode it steps into the subcategories; one without any has nowhere to
 * go, so there it does what the name does on a subcategory's row: ticks it, in Select mode.
 */
function onCard(id: string) {
  const group = groups.value.find(g => g.main.id === id)
  if (isExpanded.value || mode.value === 'browse' || group?.subs.length) return show(id)
  if (group && mode.value === 'select' && group.main.status === view.value) selection.toggle(group.main, !selection.isSelected(group.main))
}
watch(mode, (next, previous) => {
  if (previous === 'reorder') writeShownToUrl(false)
})

/** The one asked for, while the search and tab still show it. */
const opened = computed(() => groups.value.find(g => g.main.id === shownId.value))
/** Beside the list there's always one: the first until another is chosen. */
const shown = computed(() => opened.value ?? groups.value[0])
const currentId = computed(() => opened.value || isExpanded.value ? shown.value?.main.id : undefined)

/** The pills that change category below `lg`, where the list isn't beside it. */
const mainPills = computed(() => groups.value.map(g => ({ id: g.main.id, label: g.main.name })))
/** Subcategories of any status: an archived one still keeps menu items out, on the server too. */
const hasSubs = (id: string) => tree.categories.value.some(c => c.parentId === id)

const shownSummary = computed(() => {
  const main = shown.value?.main
  return main ? mainSummaryLabel(main, tree.categories.value.filter(c => c.parentId === main.id && c.status === 'active')) : ''
})

// --- Availability: each rule's times, for the tooltips (the library is small and shared) ---
const { data: rules } = useAvailabilityRuleOptions()
const ruleTimes = computed(() => new Map(rules.value.map(rule => [rule.id, describeWindows(rule.windows)])))

// --- Row actions ---
const byId = computed(() => new Map(tree.categories.value.map(c => [c.id, c])))
const archivedSubs = (id: string) => tree.categories.value.filter(c => c.parentId === id && c.status === 'archived').length

const tenantPath = useTenantPath()
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
    // Only an empty category without history can go for good (D200); otherwise it says why.
    const deleteForGood: DropdownMenuItem = category.deleteBlocker
      ? { label: DELETE_BLOCKED[category.deleteBlocker], icon: 'i-lucide-trash-2', disabled: true }
      : { label: 'Delete permanently', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove.execute(category) }
    return [
      {
        label: blocked ? `Restore (restore "${parent.name}" first)` : 'Restore',
        icon: 'i-lucide-archive-restore',
        disabled: blocked,
        onSelect: () => restoreOne(category),
      },
      { type: 'separator' },
      deleteForGood,
    ]
  }
  // One order at both levels (D270): Edit, what can be added, Manage items, then Archive apart.
  const addItem: DropdownMenuItem = { label: 'Add menu item', icon: 'i-lucide-plus', to: tenantPath(newItemPath(category.id)) }
  const manageItems: DropdownMenuItem = { label: 'Manage items', icon: 'i-lucide-utensils', to: tenantPath(manageItemsPath(category.id)) }
  const archiveLast: DropdownMenuItem[] = [
    { type: 'separator' },
    { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute(category) },
  ]
  if (category.parentId !== null) {
    return [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(category) }, addItem, manageItems, ...archiveLast]
  }
  // A main category's Edit details is beside this menu on its banner. It holds subcategories or menu
  // items, never both (D44): with subcategories it takes no items, which stays visible, saying why
  // (ui §9); with items, a new subcategory takes them (D270).
  return [
    { label: 'Add subcategory', icon: 'i-lucide-plus', onSelect: () => openForm(undefined, category.id) },
    ...(hasSubs(category.id)
      ? [{ label: category.childCount ? 'Add menu item (it has subcategories)' : 'Add menu item (it has archived subcategories)', icon: 'i-lucide-plus', disabled: true }]
      : [addItem, manageItems]),
    ...archiveLast,
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
    if (mode.value === 'select') exitSelect()
    else if (mode.value === 'browse' && view.value !== 'all' && selectableRows.value.length) startSelect()
  },
  r: () => {
    if (mode.value === 'reorder') finishReorder()
    else if (mode.value === 'browse' && tree.total.value > 1) startReorder()
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
          <UButton
            v-if="opened && mode === 'browse'"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            aria-label="Back to main categories"
            class="lg:hidden"
            @click="show(undefined)"
          />
        </template>
        <template #right>
          <UTooltip
            text="New category"
            :kbds="['n']"
          >
            <UButton
              icon="i-lucide-plus"
              aria-label="New category"
              @click="openForm()"
            >
              <span class="hidden sm:inline">New category</span>
            </UButton>
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
        </template>
        <template #right>
          <!-- Modes are toggles (D129): the button that starts Reorder or Select leaves it. -->
          <UTooltip
            :text="mode === 'reorder' ? (tree.isDirty.value || tree.saving.value ? 'Save or discard the new order first' : 'Leave Reorder mode') : 'Reorder categories'"
            :kbds="['r']"
          >
            <UButton
              :icon="mode === 'reorder' ? 'i-lucide-check' : 'i-lucide-arrow-down-up'"
              color="neutral"
              :variant="mode === 'reorder' ? 'soft' : 'outline'"
              :aria-label="mode === 'reorder' ? 'Done reordering' : 'Reorder'"
              :disabled="mode === 'reorder' ? tree.isDirty.value || tree.saving.value : mode === 'select' || tree.total.value < 2"
              @click="mode === 'reorder' ? finishReorder() : startReorder()"
            >
              <span class="hidden xl:inline">{{ mode === 'reorder' ? 'Done' : 'Reorder' }}</span>
            </UButton>
          </UTooltip>
          <UTooltip
            :text="mode === 'select' ? 'Leave Select mode' : view === 'all' ? 'Choose Active or Archived to select categories' : 'Select categories to archive or restore'"
            :kbds="view === 'all' ? undefined : ['s']"
          >
            <UButton
              :icon="mode === 'select' ? 'i-lucide-x' : 'i-lucide-list-checks'"
              color="neutral"
              :variant="mode === 'select' ? 'soft' : 'outline'"
              :aria-label="mode === 'select' ? 'Cancel selection' : 'Select'"
              :disabled="mode !== 'select' && (view === 'all' || mode !== 'browse' || !selectableRows.length)"
              @click="mode === 'select' ? exitSelect() : startSelect()"
            >
              <span class="hidden xl:inline">{{ mode === 'select' ? 'Cancel' : 'Select' }}</span>
            </UButton>
          </UTooltip>
        </template>
      </UDashboardToolbar>
      <RefreshBar :active="tree.refreshing.value" />
    </template>

    <template #body>
      <div class="space-y-4">
        <StatusTabs
          v-model="filters.status"
          :tabs="TABS"
          :counts="tree.counts.value"
          :disabled="filtersLocked"
        />

        <!-- Selection bar -->
        <BulkActionsBar
          v-if="mode === 'select'"
          :count="selection.count"
          :all-selected="selection.allSelected"
          @toggle-all="selection.toggleAll(!selection.allSelected)"
        >
          <UButton
            v-if="view === 'archived'"
            label="Restore selected"
            icon="i-lucide-archive-restore"
            color="neutral"
            variant="subtle"
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
        </BulkActionsBar>

        <!-- Reorder bar -->
        <BottomActionBar
          v-if="mode === 'reorder'"
          label="Reorder"
        >
          <p
            v-if="tree.saveError.value"
            class="min-w-0 flex-1 text-sm text-error"
          >
            {{ saveConflict ? 'Someone else changed these categories. Reload to get their changes; your new order is kept, then save again.' : tree.saveError.value.message }}
          </p>
          <p
            v-else-if="tree.isDirty.value || tree.saving.value"
            class="min-w-0 flex-1 text-sm font-medium text-highlighted"
          >
            The new order isn't saved yet.
          </p>
          <p
            v-else
            class="min-w-0 flex-1 text-sm text-muted"
          >
            Drag a row or use its arrows. Categories move among their siblings only; change a parent in Edit.
          </p>
          <div class="flex flex-wrap items-center justify-end gap-2">
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
          </div>
        </BottomActionBar>

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

        <!-- Page layout at `lg`; below it, one level at a time: the list or the category on show. -->
        <div
          v-else
          class="flex flex-col gap-4 lg:flex-row lg:items-start"
        >
          <CategoryMainList
            class="w-full lg:w-72 lg:shrink-0 xl:w-80"
            :class="opened && 'max-lg:hidden'"
            :groups="groups"
            :categories="tree.categories.value"
            :current-id="currentId"
            :mode="mode"
            :movable="movable"
            :show-status="showStatus"
            :selectable-status="view === 'all' ? undefined : view"
            :is-selected="selection.isSelected"
            :is-busy="isBusy"
            @show="onCard"
            @select="(category, value) => selection.toggle(category, value)"
            @move="(from, to) => tree.moveMain(from, to)"
          />

          <!-- Pinned: a card clicked far down a long list changes what's beside it, not something scrolled away. -->
          <div
            v-if="shown"
            class="min-w-0 flex-1 space-y-4 lg:sticky lg:top-6"
            :class="!opened && 'max-lg:hidden'"
          >
            <UButton
              v-if="mode !== 'browse'"
              label="Main categories"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              class="lg:hidden"
              @click="show(undefined)"
            />
            <PillNav
              v-if="mode === 'browse'"
              :items="mainPills"
              :active-id="shown.main.id"
              aria-label="Main categories"
              class="lg:hidden"
              @select="show"
            />
            <CategoryBanner
              :class="mode !== 'browse' && 'max-lg:hidden'"
              :category="shown.main"
              :summary="shownSummary"
              :actions="mode === 'reorder' ? [] : rowActions(shown.main)"
              :editable="mode !== 'reorder' && shown.main.status === 'active' && !shown.contextOnly"
              :show-status="showStatus"
              :busy="isBusy(shown.main.id)"
              :rule-times="ruleTimes"
              @edit="openForm(shown!.main)"
            />
            <CategorySubList
              :key="shown.main.id"
              :group="shown"
              :has-subs="hasSubs(shown.main.id)"
              :mode="mode"
              :movable="movable"
              :numbered="tree.sortable.value"
              :show-status="showStatus"
              :selectable-status="view === 'all' ? undefined : view"
              :actions="rowActions"
              :is-selected="selection.isSelected"
              :is-busy="isBusy"
              :rule-times="ruleTimes"
              @open="category => openForm(category)"
              @select="(category, value) => selection.toggle(category, value)"
              @add="openForm(undefined, shown!.main.id)"
              @move="(from, to) => tree.moveSub(shown!.main.id, from, to)"
            />
          </div>
        </div>

        <!-- Subcategories whose parent is gone: shown, not reorderable. -->
        <section
          v-if="tree.tree.value.orphans.length"
          class="@container space-y-3"
        >
          <h2 class="font-semibold text-highlighted">
            Without a parent category
          </h2>
          <div
            role="list"
            aria-label="Without a parent category"
            class="space-y-2"
          >
            <CategoryRow
              v-for="orphan in tree.tree.value.orphans"
              :key="orphan.id"
              role="listitem"
              :aria-label="orphan.name"
              :category="orphan"
              :mode="mode === 'reorder' ? 'browse' : mode"
              :actions="rowActions(orphan)"
              :show-status="showStatus"
              :selected="selection.isSelected(orphan)"
              :selectable="mode === 'select' && orphan.status === view"
              :busy="isBusy(orphan.id)"
              :rule-times="ruleTimes"
              @open="openForm(orphan)"
              @select="value => selection.toggle(orphan, value)"
            />
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
