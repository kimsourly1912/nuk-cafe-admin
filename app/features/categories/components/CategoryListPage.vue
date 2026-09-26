<script setup lang="ts">
import type { DropdownMenuItem, SelectItem, TableColumn } from '@nuxt/ui'
import type { CategoryResponse } from '~/generated/api'
import { useCategoryList, useCategoryMutations } from '../composables/useCategories'
import CategoryFormModal from './CategoryFormModal.vue'

// --- Filters & pagination ---
const { page, pageSize, filters, query } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
  type: ANY as 'MAIN' | 'SUB' | Any,
})

const { data, status: fetchStatus, error, refresh } = useCategoryList(query)

const typeItems: SelectItem[] = [
  { label: 'All types', value: ANY },
  { label: 'Main', value: 'MAIN' },
  { label: 'Sub', value: 'SUB' },
]

// --- Table ---
const columns: TableColumn<CategoryResponse>[] = [
  { accessorKey: 'categoryName', header: 'Name' },
  { id: 'parent', header: 'Parent' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

function rowActions(category: CategoryResponse): DropdownMenuItem[] {
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(category) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => onDelete(category) },
  ]
}

// --- Actions ---
const formModal = useOverlay().create(CategoryFormModal)
const confirm = useConfirm()
const toast = useToast()
const { remove } = useCategoryMutations()

function openForm(category?: CategoryResponse) {
  formModal.open({ category })
}

async function onDelete(category: CategoryResponse) {
  const confirmed = await confirm({
    title: `Delete "${category.categoryName}"?`,
    description: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!confirmed) return

  try {
    await remove(category.id!)
    toast.add({ title: 'Category deleted', color: 'success' })
  }
  catch (e) {
    toast.add({ title: 'Could not delete category', description: getErrorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="categories">
    <template #header>
      <UDashboardNavbar title="Categories">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="New category"
            icon="i-lucide-plus"
            @click="openForm()"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <UInput
          v-model.lazy="filters.search"
          icon="i-lucide-search"
          placeholder="Search… (press Enter)"
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
      </UDashboardToolbar>
    </template>

    <template #body>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load categories"
        :description="getErrorMessage(error)"
        :actions="[{ label: 'Retry', onClick: () => refresh() }]"
      />

      <UTable
        v-else
        :data="data?.content ?? []"
        :columns="columns"
        :loading="fetchStatus === 'pending'"
        empty="No categories found."
      >
        <template #parent-cell="{ row }">
          {{ row.original.mainCategory?.categoryName ?? '—' }}
        </template>

        <template #status-cell="{ row }">
          <StatusBadge :status="row.original.status" />
        </template>

        <template #actions-cell="{ row }">
          <UDropdownMenu
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
