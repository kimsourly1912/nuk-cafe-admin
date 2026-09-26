<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { ProductResponse } from '~/generated/api'
import { CategorySelect } from '~/features/categories'
import type { ProductListQuery } from '../composables/useProducts'
import { useProductList, useProductMutations } from '../composables/useProducts'
import { formatPrice } from '../utils/money'
import ProductFormSlideover from './ProductFormSlideover.vue'

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  productName: '',
  categoryId: ANY as number | string,
  status: ANY as Status | Any,
})

// A category id read back from the URL is a string; the API wants a number.
const apiQuery = computed<ProductListQuery>(() => {
  const { categoryId, ...rest } = query.value
  return { ...rest, categoryId: categoryId === undefined ? undefined : Number(categoryId) }
})

/** `CategorySelect` holds `number | undefined`; the filter holds `ANY` for "all". */
const categoryFilter = computed({
  get: () => (filters.categoryId === ANY ? undefined : Number(filters.categoryId)),
  set: (id: number | undefined) => {
    filters.categoryId = id ?? ANY
  },
})

const { data, loading, refreshing, error, refresh } = useProductList(apiQuery)
const { remove, isBusy } = useProductMutations()

// Deleted rows disappear immediately, before the refreshed list arrives.
const rows = computed(() => (data.value?.content ?? []).filter(p => !remove.isRemoved(p.id!)))

// Deleting the last rows of the last page: step back to a page that exists.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, p => p.id!, { resetOn: [query] })

async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  // Keep only the rows that still need attention selected: failed, skipped (busy) and not started.
  selection.select([
    ...result.failed.map(f => f.input.id!),
    ...result.skipped.map(p => p.id!),
    ...result.notStarted.map(p => p.id!),
  ])
}

// --- Table ---
const columns: TableColumn<ProductResponse>[] = [
  { id: 'select' },
  { accessorKey: 'productName', header: 'Name' },
  { id: 'category', header: 'Category' },
  { accessorKey: 'price', header: 'Price', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

function rowActions(product: ProductResponse): DropdownMenuItem[] {
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(product) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove.execute(product) },
  ]
}

const formPanel = useOverlay().create(ProductFormSlideover)
function openForm(product?: ProductResponse) {
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
            v-model="filters.productName"
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
          <USelect
            v-model="filters.status"
            :items="STATUS_FILTER_ITEMS"
            class="w-40"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
        <template #right>
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
      </UDashboardToolbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load menu items"
        @retry="refresh()"
      />

      <UTable
        v-else
        v-model:row-selection="selection.rowSelection"
        :get-row-id="selection.getRowId"
        :data="rows"
        :columns="columns"
        :loading="loading"
        :meta="{ class: { tr: row => (isBusy(row.original.id!) ? 'opacity-50 pointer-events-none' : '') } }"
      >
        <template #loading>
          <span class="text-muted">Loading menu items…</span>
        </template>
        <template #empty>
          <ListEmptyState
            noun="menu items"
            :filtered="isFiltered"
            create-label="New menu item"
            @create="openForm()"
            @clear="clearFilters()"
          />
        </template>

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

        <template #productName-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar
              :src="row.original.imageUrl"
              icon="i-lucide-image"
              :alt="row.original.productName"
              class="size-10 shrink-0 rounded-md"
            />
            <div class="min-w-0">
              <p class="font-medium text-highlighted">
                {{ row.original.productName }}
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
          {{ row.original.category?.categoryName ?? '—' }}
        </template>

        <template #price-cell="{ row }">
          <span class="tabular-nums">{{ formatPrice(row.original.price) }}</span>
        </template>

        <template #status-cell="{ row }">
          <StatusBadge :status="row.original.status" />
        </template>

        <template #actions-cell="{ row }">
          <UIcon
            v-if="isBusy(row.original.id!)"
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
        v-if="(data?.totalPages ?? 0) > 1"
        class="flex justify-end border-t border-default pt-4"
      >
        <UPagination
          v-model:page="page"
          :total="data?.totalElements ?? 0"
          :items-per-page="pageSize"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
