<script setup lang="ts">
/**
 * Menu items: a card grid (pictures drive this screen) with a Grid / List switch; the list is the
 * table. The grid can be grouped by category, in the order customers see the menu; grouped, it
 * loads the whole filtered menu instead of a page. View and grouping are remembered per viewer.
 * docs/plans/list-ui-refresh.md
 */
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { Product } from '#shared/contracts/menu'
import { useLocalStorage } from '@vueuse/core'
import { CategorySelect, useCategoryOptions } from '~/features/categories'
import { useProductList, useProductMenu, useProductMutations, useProductStatusCounts } from '../composables/useProducts'
import { menuSections } from '../utils/menu-sections'
import { formatMinor } from '../utils/money'
import ProductCard from './ProductCard.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'

// --- Filters & pagination (kept in the URL); view and grouping per viewer ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  categoryId: ANY as string,
  status: ANY as Status | Any,
})

const view = useLocalStorage<'grid' | 'list'>('products:view', 'grid')
const grouped = useLocalStorage('products:grouped', false)
/** The grid grouped by category shows the whole menu, not a page. */
const showMenu = computed(() => view.value === 'grid' && grouped.value)

const menuQuery = computed(() => {
  const { page: _page, pageSize: _size, ...rest } = query.value
  return rest
})

/** `CategorySelect` holds `number | undefined`; the filter holds `ANY` for "all". */
const categoryFilter = computed({
  get: () => (filters.categoryId === ANY ? undefined : filters.categoryId),
  set: (id: string | undefined) => {
    filters.categoryId = id ?? ANY
  },
})

const list = useProductList(query, () => !showMenu.value)
const menu = useProductMenu(menuQuery, showMenu)
const { data: categories } = useCategoryOptions()
const counts = useProductStatusCounts(() => ({ search: query.value.search, categoryId: query.value.categoryId }))
const { remove, isBusy } = useProductMutations()

const source = computed(() => (showMenu.value ? menu : list))
const loading = computed(() => source.value.loading.value)
const refreshing = computed(() => source.value.refreshing.value)
const error = computed(() => source.value.error.value)
const refresh = () => source.value.refresh()

// Deleted items disappear immediately, before the refreshed list arrives.
const rows = computed(() => ((showMenu.value ? menu.data.value : list.data.value?.items) ?? []).filter(p => !remove.isRemoved(p.id)))
const sections = computed(() => menuSections(rows.value, categories.value))

// Deleting the last items of the last page: step back to a page that exists.
watch(() => list.data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, p => p.id, { resetOn: [query, showMenu] })

async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  // Keep only the items that still need attention selected: failed, skipped (busy) and not started.
  selection.select([
    ...result.failed.map(f => f.input.id),
    ...result.skipped.map(p => p.id),
    ...result.notStarted.map(p => p.id),
  ])
}

// --- Table (List view) ---
const columns: TableColumn<Product>[] = [
  { id: 'select' },
  { accessorKey: 'name', header: 'Name' },
  { id: 'category', header: 'Category' },
  { accessorKey: 'priceMinor', header: 'Price', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

function rowActions(product: Product): DropdownMenuItem[] {
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(product) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove.execute(product) },
  ]
}

const formPanel = useOverlay().create(ProductFormSlideover)
function openForm(product?: Product) {
  formPanel.open({ product })
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
            include-inactive
            aria-label="Category"
            class="w-48"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
          <USwitch
            v-if="view === 'grid'"
            v-model="grouped"
            label="Group by category"
            size="sm"
          />
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

      <!-- Grid, grouped by category: the menu as customers see it. -->
      <div
        v-else-if="showMenu"
        class="space-y-8"
      >
        <section
          v-for="section in sections"
          :key="section.key"
          :aria-label="section.title"
        >
          <h2 class="mb-3 flex items-baseline gap-2 font-semibold text-highlighted">
            {{ section.title }}
            <span class="text-sm font-normal text-muted">{{ section.products.length }}</span>
          </h2>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
            <ProductCard
              v-for="product in section.products"
              :key="product.id"
              :product="product"
              hide-category
              :actions="rowActions(product)"
              :selected="selection.isSelected(product)"
              :busy="isBusy(product.id)"
              @open="openForm(product)"
              @select="value => selection.toggle(product, value)"
            />
          </div>
        </section>
      </div>

      <!-- Grid, one page. -->
      <div
        v-else-if="view === 'grid'"
        class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4"
      >
        <ProductCard
          v-for="product in rows"
          :key="product.id"
          :product="product"
          :actions="rowActions(product)"
          :selected="selection.isSelected(product)"
          :busy="isBusy(product.id)"
          @open="openForm(product)"
          @select="value => selection.toggle(product, value)"
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
            aria-label="Select row"
            @update:model-value="value => row.toggleSelected(!!value)"
          />
        </template>

        <template #name-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar
              :src="row.original.image?.url"
              icon="i-lucide-image"
              :alt="row.original.name"
              class="size-10 shrink-0 rounded-md"
            />
            <div class="min-w-0">
              <p class="font-medium text-highlighted">
                {{ row.original.name }}
              </p>
              <p
                v-if="row.original.description"
                class="max-w-xs truncate text-muted"
              >
                {{ row.original.description }}
              </p>
            </div>
          </div>
        </template>

        <template #category-cell="{ row }">
          {{ row.original.category.name }}
        </template>

        <template #priceMinor-cell="{ row }">
          <span class="tabular-nums">{{ formatMinor(row.original.priceMinor) }}</span>
        </template>

        <template #status-cell="{ row }">
          <StatusBadge :status="row.original.status" />
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
              aria-label="Actions"
            />
          </UDropdownMenu>
        </template>
      </UTable>

      <div
        v-if="!showMenu && (list.data.value?.totalPages ?? 0) > 1"
        class="flex justify-end border-t border-default pt-4"
      >
        <UPagination
          v-model:page="page"
          :total="list.data.value?.total ?? 0"
          :items-per-page="pageSize"
        />
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
