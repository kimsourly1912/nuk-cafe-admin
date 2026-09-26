<script setup lang="ts">
import type { DropdownMenuItem, SelectItem, TableColumn } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'
import { useCategoryList, useCategoryMutations } from '../composables/useCategories'
import CategoryFormModal from './CategoryFormModal.vue'

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
  type: ANY as 'MAIN' | 'SUB' | Any,
})

const { data, loading, refreshing, error, refresh } = useCategoryList(query)
const { remove, isBusy } = useCategoryMutations()

// Deleted rows disappear immediately, before the refreshed list arrives.
const rows = computed(() => (data.value?.content ?? []).filter(c => !remove.isRemoved(c.id!)))

// Deleting the last rows of the last page: step back to a page that exists.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const typeItems: SelectItem[] = [
  { label: 'All types', value: ANY },
  { label: 'Main', value: 'MAIN' },
  { label: 'Sub', value: 'SUB' },
]

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, c => c.id!, { resetOn: [query] })

async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  // Keep only the rows that still need attention selected: failed, skipped (busy) and not started.
  selection.select([
    ...result.failed.map(f => f.input.id!),
    ...result.skipped.map(c => c.id!),
    ...result.notStarted.map(c => c.id!),
  ])
}

// --- Table ---
const columns: TableColumn<CategoryResponse>[] = [
  { id: 'select' },
  { accessorKey: 'categoryName', header: 'Name' },
  { id: 'parent', header: 'Parent' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

function rowActions(category: CategoryResponse): DropdownMenuItem[] {
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(category) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove.execute(category) },
  ]
}

const formModal = useOverlay().create(CategoryFormModal)
function openForm(category?: CategoryResponse) {
  formModal.open({ category })
}

usePageShortcuts({ n: () => openForm() })
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
            class="w-64"
          />
          <USelect
            v-model="filters.status"
            :items="STATUS_FILTER_ITEMS"
            class="w-40"
          />
          <USelect
            v-model="filters.type"
            :items="typeItems"
            class="w-36"
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
        title="Could not load categories"
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
          <span class="text-muted">Loading categories…</span>
        </template>
        <template #empty>
          <ListEmptyState
            noun="categories"
            :filtered="isFiltered"
            create-label="New category"
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

        <template #parent-cell="{ row }">
          {{ row.original.mainCategory?.categoryName ?? '—' }}
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
