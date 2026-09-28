<script setup lang="ts">
/**
 * Menu items: a card grid (pictures drive this screen) with a Grid / List switch; the list is the
 * table. Filters (search, category, status tabs) and the page are in the URL; the view is
 * remembered per viewer. States are actions: Publish, Unpublish, Archive, Restore (D70).
 * docs/plans/menu-screens-move.md
 */
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { ItemStatus, MenuItemSummary } from '#shared/contracts/menu-items'
import { useLocalStorage } from '@vueuse/core'
import { CategorySelect } from '~/features/categories'
import { useItemList, useItemMutations, useItemStatusCounts } from '../composables/useItems'
import { ITEM_STATUS_LABELS, priceRange } from '../utils/item-display'
import ProductCard from './ProductCard.vue'
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
  status: ANY as string,
})

const view = useLocalStorage<'grid' | 'list'>('products:view', 'grid')

/** `CategorySelect` holds `string | undefined`; the filter holds `ANY` for "all". */
const categoryFilter = computed({
  get: () => (filters.categoryId === ANY ? undefined : filters.categoryId),
  set: (id: string | undefined) => {
    filters.categoryId = id ?? ANY
  },
})

const listQuery = computed(() => ({ ...query.value, status: query.value.status as ItemStatus | undefined }))
const { data, loading, refreshing, error, refresh } = useItemList(listQuery)
const counts = useItemStatusCounts(() => ({ search: query.value.search, categoryId: query.value.categoryId }))
const { publish, unpublish, archive, restore, isBusy } = useItemMutations()

const rows = computed(() => data.value?.items ?? [])

// Archiving the last items of the last page (on a tab without archived ones): step back.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, item => item.id, { resetOn: [query] })
const archivable = computed(() => selection.selected.filter(item => item.status !== 'archived'))

async function archiveSelected() {
  const result = await archive.executeMany(archivable.value)
  // Keep only the items that still need attention selected: failed, skipped (busy) and not started.
  selection.select([
    ...result.failed.map(f => f.input.id),
    ...result.skipped.map(item => item.id),
    ...result.notStarted.map(item => item.id),
  ])
}

// --- Table (List view) ---
const columns: TableColumn<MenuItemSummary>[] = [
  { id: 'select' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'categoryName', header: 'Category' },
  { id: 'price', header: 'Price', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

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

usePageShortcuts({ n: () => openForm() })
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
            class="w-64"
          />
          <CategorySelect
            v-model="categoryFilter"
            none-label="All categories"
            include-archived
            aria-label="Category"
            class="w-56"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
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
      <div class="flex flex-wrap items-center justify-between gap-2">
        <StatusTabs
          v-model="filters.status"
          :tabs="TABS"
          :counts="counts"
        />
        <UCheckbox
          v-if="view === 'grid' && rows.length"
          :model-value="selection.someSelected ? 'indeterminate' : selection.allSelected"
          :label="selection.allSelected ? 'Unselect all' : 'Select all'"
          aria-label="Select all"
          @update:model-value="value => selection.toggleAll(!!value)"
        />
      </div>

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

      <!-- Grid: one page. -->
      <div
        v-else-if="view === 'grid'"
        class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4"
      >
        <ProductCard
          v-for="item in rows"
          :key="item.id"
          :item="item"
          :actions="rowActions(item)"
          :selected="selection.isSelected(item)"
          :busy="isBusy(item.id)"
          @open="openForm(item)"
          @select="value => selection.toggle(item, value)"
        />
      </div>

      <!-- List: the table, for comparing across columns. -->
      <UTable
        v-else
        v-model:row-selection="selection.rowSelection"
        :get-row-id="selection.getRowId"
        :data="rows"
        :columns="columns"
        :meta="{ class: { tr: row => (isBusy(row.original.id) ? 'opacity-50 pointer-events-none' : 'cursor-pointer') } }"
        @select="(_, row) => openForm(row.original)"
      >
        <template #select-header="{ table }">
          <UCheckbox
            :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
            aria-label="Select all"
            @update:model-value="value => table.toggleAllPageRowsSelected(!!value)"
          />
        </template>
        <template #select-cell="{ row }">
          <UCheckbox
            :model-value="row.getIsSelected()"
            :aria-label="`Select ${row.original.name}`"
            @update:model-value="value => row.toggleSelected(!!value)"
          />
        </template>

        <template #name-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar
              :src="row.original.imageUrl ?? undefined"
              icon="i-lucide-image"
              :alt="row.original.name"
              class="size-10 shrink-0 rounded-md"
            />
            <p class="font-medium text-highlighted">
              {{ row.original.name }}
            </p>
          </div>
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
            v-else
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

      <BulkActionsBar
        :count="selection.count"
        @clear="selection.clear()"
      >
        <UButton
          label="Archive"
          icon="i-lucide-archive"
          color="error"
          variant="subtle"
          :disabled="!archivable.length"
          @click="archiveSelected"
        />
      </BulkActionsBar>
    </template>
  </UDashboardPanel>
</template>
