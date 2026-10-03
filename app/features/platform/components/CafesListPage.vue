<script setup lang="ts">
/**
 * Cafes (`/platform`, D142): every cafe on the platform with its status and usage, for the platform
 * team. A table from `sm` (the question is "which cafe, how active, is it paused"); on phones a
 * list of rows (page-patterns §2). The name opens the cafe's page, where its actions are. New cafe
 * opens the form; the result shows the owner's temporary password once.
 */
import type { TableColumn } from '@nuxt/ui'
import type { TenantSummary } from '#shared/contracts/tenants'
import { useCafeCounts, useCafeList } from '../composables/useCafes'
import { lastOrderText, timeAgo, usageLine } from '../schemas/cafe-form'
import CafeFormModal from './CafeFormModal.vue'

const { isCompact } = useLayoutContext()

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as 'active' | 'suspended' | Any,
})

const { data, loading, refreshing, error, refresh } = useCafeList(query)
const counts = useCafeCounts()
const rows = computed(() => data.value?.items ?? [])

watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const statusTabs = [
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'suspended' },
]

const columns: TableColumn<TenantSummary>[] = [
  { accessorKey: 'name', header: 'Cafe' },
  { id: 'status', header: 'Status' },
  { id: 'usage', header: 'Usage' },
  { id: 'lastOrder', header: 'Last order' },
]

const cafePath = (cafe: TenantSummary) => `/platform/cafes/${cafe.id}`

const formModal = useOverlay().create(CafeFormModal)
const openForm = () => formModal.open()

usePageShortcuts({ n: openForm })
</script>

<template>
  <UDashboardPanel id="cafes">
    <template #header>
      <UDashboardNavbar title="Cafes">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New cafe"
            :kbds="['n']"
          >
            <UButton
              label="New cafe"
              icon="i-lucide-plus"
              @click="openForm()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <StatusTabs
            v-model="filters.status"
            :tabs="statusTabs"
            :counts="counts.data.value"
          />
        </template>
        <template #right>
          <SearchInput
            v-model="filters.search"
            placeholder="Search name or address…"
            class="w-full sm:w-64"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the cafes"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading cafes…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="cafes"
        :filtered="isFiltered"
        create-label="New cafe"
        @create="openForm()"
        @clear="clearFilters()"
      />

      <!-- Phones: rows, one large target each (page-patterns §2) -->
      <ul
        v-else-if="isCompact"
        aria-label="Cafes"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="cafe in rows"
          :key="cafe.id"
          class="p-1"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :to="cafePath(cafe)"
            :aria-label="cafe.name"
            block
            class="justify-start text-left"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="flex max-w-full items-center gap-2">
                <span class="break-words font-medium text-highlighted">{{ cafe.name }}</span>
                <UBadge
                  v-if="cafe.status === 'suspended'"
                  color="warning"
                  variant="subtle"
                >
                  Paused
                </UBadge>
              </span>
              <span class="max-w-full truncate font-normal text-muted">/c/{{ cafe.slug }}</span>
              <span class="max-w-full font-normal text-muted">{{ usageLine(cafe.usage) }}</span>
              <span class="max-w-full font-normal text-muted">{{ lastOrderText(cafe.usage.lastOrderAt) }}</span>
            </span>
          </UButton>
        </li>
      </ul>

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        class="shrink-0"
      >
        <!-- The name opens the cafe -->
        <template #name-cell="{ row }">
          <UButton
            color="neutral"
            variant="ghost"
            :to="cafePath(row.original)"
            :aria-label="row.original.name"
            class="-mx-2.5 -my-1.5 max-w-full text-left"
          >
            <span class="flex min-w-0 flex-col">
              <span class="font-medium text-highlighted">{{ row.original.name }}</span>
              <span class="truncate font-normal text-muted">/c/{{ row.original.slug }}</span>
            </span>
          </UButton>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'suspended' ? 'warning' : 'success'"
            variant="subtle"
          >
            {{ row.original.status === 'suspended' ? 'Paused' : 'Active' }}
          </UBadge>
        </template>

        <template #usage-cell="{ row }">
          <span class="text-muted">{{ usageLine(row.original.usage) }}</span>
        </template>

        <template #lastOrder-cell="{ row }">
          <span class="text-muted">{{ row.original.usage.lastOrderAt ? timeAgo(row.original.usage.lastOrderAt) : 'No orders yet' }}</span>
        </template>
      </UTable>

      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="data?.total ?? 0"
      />
    </template>
  </UDashboardPanel>
</template>
