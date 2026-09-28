<script setup lang="ts">
/**
 * Menu items: a card grid (pictures drive this screen) with a Grid / List switch; the list is the
 * table. Filters (search, category, status tabs) and the page are in the URL; the view is
 * remembered per viewer. States are actions: Publish, Unpublish, Archive, Restore (D70).
 * Links from other pages (D75): `?modifierGroupId=` shows the items offering an add-on group (a
 * filter that can be removed), `?item=<id>` opens that item's form.
 * On the UI standard (D89): the name is each record's target; the List view is rows on phones and
 * the table from `sm`; the grid's columns follow its container; bulk archive is a Select mode.
 * docs/plans/menu-screens-move.md
 */
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { ItemStatus, MenuItemSummary } from '#shared/contracts/menu-items'
import { useEventListener, useLocalStorage } from '@vueuse/core'
import { CategorySelect } from '~/features/categories'
import { useItemList, useItemMutations, useItemStatusCounts } from '../composables/useItems'
import { ITEM_STATUS_LABELS, priceRange } from '../utils/item-display'
import ProductCard from './ProductCard.vue'
import ProductGroupFilter from './ProductGroupFilter.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'

const TABS = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

// --- Filters & pagination (kept in the URL); the view per viewer ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  categoryId: ANY as string,
  modifierGroupId: '',
  status: ANY as string,
})

const view = useLocalStorage<'grid' | 'list'>('products:view', 'grid')
const { isCompact } = useLayoutContext()

/** `CategorySelect` holds `string | undefined`; the filter holds `ANY` for "all". */
const categoryFilter = computed({
  get: () => (filters.categoryId === ANY ? undefined : filters.categoryId),
  set: (id: string | undefined) => {
    filters.categoryId = id ?? ANY
  },
})

const listQuery = computed(() => ({ ...query.value, status: query.value.status as ItemStatus | undefined }))
const { data, loading, refreshing, error, refresh } = useItemList(listQuery)
const counts = useItemStatusCounts(() => ({ search: query.value.search, categoryId: query.value.categoryId, modifierGroupId: query.value.modifierGroupId }))
const { publish, unpublish, archive, restore, isBusy } = useItemMutations()

const rows = computed(() => data.value?.items ?? [])

// Archiving the last items of the last page (on a tab without archived ones): step back.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

// --- Select mode: bulk archive, so only items that aren't archived can be selected ---
const selecting = ref(false)
const selectableRows = computed(() => rows.value.filter(item => item.status !== 'archived'))
const selection = useTableSelection(selectableRows, item => item.id, { resetOn: [query] })

function startSelect() {
  if (selectableRows.value.length) selecting.value = true
}
function exitSelect() {
  selection.clear()
  selecting.value = false
}
// The Archived tab has nothing to archive.
watch(() => filters.status, (status) => {
  if (status === 'archived') exitSelect()
})

async function archiveSelected() {
  const result = await archive.executeMany(selection.selected)
  if (result.cancelled) return
  // Keep only the items that still need attention selected: failed, skipped (busy) and not started.
  const keep = [
    ...result.failed.map(f => f.input.id),
    ...result.skipped.map(item => item.id),
    ...result.notStarted.map(item => item.id),
  ]
  selection.select(keep)
  if (!keep.length) exitSelect()
}

/** The name: opens the item, or in Select mode selects it. */
function onName(item: MenuItemSummary) {
  if (!selecting.value) openForm(item)
  else if (item.status !== 'archived') selection.toggle(item, !selection.isSelected(item))
}

// --- Table (List view) ---
const columns = computed<TableColumn<MenuItemSummary>[]>(() => [
  ...(selecting.value ? [{ id: 'select' }] : []),
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'categoryName', header: 'Category' },
  { id: 'price', header: 'Price', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
])

function rowActions(item: MenuItemSummary): DropdownMenuItem[] {
  if (item.status === 'archived') {
    return [
      { label: 'View', icon: 'i-lucide-eye', onSelect: () => openForm(item) },
      { label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute(item) },
    ]
  }
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(item) },
    item.status === 'draft'
      ? { label: 'Publish', icon: 'i-lucide-send', onSelect: () => publish.execute(item) }
      : { label: 'Unpublish', icon: 'i-lucide-eye-off', onSelect: () => unpublish.execute(item) },
    { label: 'Archive', icon: 'i-lucide-archive', color: 'error', onSelect: () => archive.execute(item) },
  ]
}

const formPanel = useOverlay().create(ProductFormSlideover)
function openForm(item?: MenuItemSummary) {
  formPanel.open({ itemId: item?.id })
}

usePageShortcuts({ n: () => openForm(), s: () => startSelect() })

// Escape leaves Select mode. Not a `defineShortcuts` key: those prevent the default, and Escape
// must still close menus, selects and dialogs first (they win: nothing happens here then).
useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !selecting.value) return
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
  exitSelect()
})

// `?item=<id>` (a link from another page) opens that item, then leaves the URL as the list's.
const route = useRoute()
const router = useRouter()
watch(() => route.query.item, (itemId) => {
  if (typeof itemId !== 'string' || !itemId) return
  formPanel.open({ itemId })
  const { item: _, ...rest } = route.query
  router.replace({ query: rest })
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="products">
    <template #header>
      <UDashboardNavbar title="Menu items">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New menu item"
            :kbds="['n']"
          >
            <UButton
              label="New menu item"
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
            placeholder="Search menu items…"
            class="w-full sm:w-64"
          />
          <CategorySelect
            v-model="categoryFilter"
            none-label="All categories"
            include-archived
            aria-label="Category"
            class="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
          <ProductGroupFilter
            v-if="filters.modifierGroupId"
            :group-id="filters.modifierGroupId"
            @clear="filters.modifierGroupId = ''"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
          <UTooltip
            text="Select menu items to archive"
            :kbds="['s']"
          >
            <UButton
              icon="i-lucide-list-checks"
              color="neutral"
              :variant="selecting ? 'soft' : 'outline'"
              aria-label="Select"
              :aria-pressed="selecting"
              :disabled="selecting || !selectableRows.length"
              @click="startSelect()"
            >
              <span class="hidden lg:inline">Select</span>
            </UButton>
          </UTooltip>
          <UFieldGroup>
            <UButton
              icon="i-lucide-layout-grid"
              :color="view === 'grid' ? 'primary' : 'neutral'"
              :variant="view === 'grid' ? 'soft' : 'ghost'"
              aria-label="Grid view"
              :aria-pressed="view === 'grid'"
              @click="view = 'grid'"
            />
            <UButton
              icon="i-lucide-list"
              :color="view === 'list' ? 'primary' : 'neutral'"
              :variant="view === 'list' ? 'soft' : 'ghost'"
              aria-label="List view"
              :aria-pressed="view === 'list'"
              @click="view = 'list'"
            />
          </UFieldGroup>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <StatusTabs
        v-model="filters.status"
        :tabs="TABS"
        :counts="counts"
      />

      <BulkActionsBar
        v-if="selecting"
        :count="selection.count"
        :all-selected="selection.allSelected"
        @toggle-all="selection.toggleAll(!selection.allSelected)"
        @exit="exitSelect()"
      >
        <UButton
          label="Archive selected"
          icon="i-lucide-archive"
          color="neutral"
          variant="subtle"
          :disabled="!selection.count"
          @click="archiveSelected"
        />
      </BulkActionsBar>

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load menu items"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading menu items…"
        :variant="view === 'grid' ? 'card' : 'row'"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="menu items"
        :filtered="isFiltered"
        create-label="New menu item"
        @create="openForm()"
        @clear="clearFilters()"
      />

      <!-- Grid: one page; its columns follow the width it has (a card is at least 13rem) -->
      <div
        v-else-if="view === 'grid'"
        class="@container"
      >
        <div class="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5">
          <ProductCard
            v-for="item in rows"
            :key="item.id"
            :item="item"
            :actions="rowActions(item)"
            :selecting="selecting"
            :selectable="item.status !== 'archived'"
            :selected="selection.isSelected(item)"
            :busy="isBusy(item.id)"
            @open="openForm(item)"
            @select="value => selection.toggle(item, value)"
          />
        </div>
      </div>

      <!-- List on phones: rows, the name the one target and the actions beside it (page-patterns §2) -->
      <ul
        v-else-if="isCompact"
        aria-label="Menu items"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="item in rows"
          :key="item.id"
          class="flex items-center gap-1 p-1"
          :class="isBusy(item.id) && 'opacity-50'"
        >
          <div
            v-if="selecting"
            class="flex size-8 shrink-0 items-center justify-center"
          >
            <UCheckbox
              v-if="item.status !== 'archived'"
              :model-value="selection.isSelected(item)"
              :aria-label="`Select ${item.name}`"
              @update:model-value="value => selection.toggle(item, !!value)"
            />
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="item.name"
            :disabled="isBusy(item.id) || (selecting && item.status === 'archived')"
            :tabindex="selecting ? -1 : undefined"
            class="min-w-0 flex-1 gap-3 text-left"
            @click="onName(item)"
          >
            <UAvatar
              :src="item.imageUrl ?? undefined"
              icon="i-lucide-image"
              :alt="item.name"
              class="size-10 shrink-0 rounded-md"
            />
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="flex max-w-full flex-wrap items-center gap-x-2">
                <span class="break-words font-medium text-highlighted">{{ item.name }}</span>
                <UBadge
                  v-if="item.status !== 'active'"
                  :label="ITEM_STATUS_LABELS[item.status]"
                  :color="item.status === 'draft' ? 'warning' : 'neutral'"
                  variant="subtle"
                />
              </span>
              <span class="max-w-full truncate font-normal text-muted">{{ item.categoryName }} · {{ priceRange(item) }}</span>
            </span>
          </UButton>
          <UIcon
            v-if="isBusy(item.id)"
            name="i-lucide-loader-circle"
            class="size-5 shrink-0 animate-spin text-muted"
            aria-label="Working…"
          />
          <UDropdownMenu
            v-else-if="!selecting"
            :items="rowActions(item)"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              :aria-label="`Actions for ${item.name}`"
            />
          </UDropdownMenu>
        </li>
      </ul>

      <!-- List from sm: the table, for comparing across columns -->
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        class="shrink-0"
        :meta="{ class: { tr: row => (isBusy(row.original.id) ? 'opacity-50 pointer-events-none' : '') } }"
      >
        <template #select-header>
          <UCheckbox
            :model-value="selection.someSelected ? 'indeterminate' : selection.allSelected"
            aria-label="Select all"
            @update:model-value="value => selection.toggleAll(!!value)"
          />
        </template>
        <template #select-cell="{ row }">
          <UCheckbox
            v-if="row.original.status !== 'archived'"
            :model-value="selection.isSelected(row.original)"
            :aria-label="`Select ${row.original.name}`"
            @update:model-value="value => selection.toggle(row.original, !!value)"
          />
        </template>

        <!-- The name opens the item: the record's one target, beside (not around) its actions -->
        <template #name-cell="{ row }">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="row.original.name"
            :disabled="selecting && row.original.status === 'archived'"
            :tabindex="selecting ? -1 : undefined"
            class="-mx-2.5 -my-1.5 max-w-full gap-3 text-left"
            @click="onName(row.original)"
          >
            <UAvatar
              :src="row.original.imageUrl ?? undefined"
              icon="i-lucide-image"
              :alt="row.original.name"
              class="size-10 shrink-0 rounded-md"
            />
            <span class="font-medium text-highlighted">{{ row.original.name }}</span>
          </UButton>
        </template>

        <template #price-cell="{ row }">
          <span class="tabular-nums">{{ priceRange(row.original) }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :label="ITEM_STATUS_LABELS[row.original.status]"
            :color="row.original.status === 'active' ? 'success' : row.original.status === 'draft' ? 'warning' : 'neutral'"
            variant="subtle"
          />
        </template>

        <template #actions-cell="{ row }">
          <UIcon
            v-if="isBusy(row.original.id)"
            name="i-lucide-loader-circle"
            class="size-5 animate-spin text-muted"
            aria-label="Working…"
          />
          <UDropdownMenu
            v-else-if="!selecting"
            :items="rowActions(row.original)"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              :aria-label="`Actions for ${row.original.name}`"
            />
          </UDropdownMenu>
        </template>
      </UTable>

      <div
        v-if="(data?.totalPages ?? 0) > 1"
        class="flex justify-end border-t border-default pt-4"
      >
        <UPagination
          v-model:page="page"
          :total="data?.total ?? 0"
          :items-per-page="pageSize"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
