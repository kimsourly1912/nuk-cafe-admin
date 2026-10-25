<script setup lang="ts">
/**
 * Accounts (`/platform/accounts`, step P1, D187): every registered account on the platform, newest
 * first, for the platform team: owners, staff, customers and super admins, never guests. A table
 * from `sm`; on phones a list of rows (page-patterns §2). The name opens the account's page, where
 * its actions are.
 */
import type { TableColumn } from '@nuxt/ui'
import type { AccountKind, PlatformAccountSummary } from '#shared/contracts/accounts'
import { accountPath, useAccountList } from '../composables/useAccounts'
import { accessLine, banLine } from '../schemas/account-form'
import { timeAgo } from '../schemas/cafe-form'

const { isCompact } = useLayoutContext()

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  kind: ANY as AccountKind | Any,
})

const { data, loading, refreshing, error, refresh } = useAccountList(query)
const rows = computed(() => data.value?.items ?? [])

watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const kindTabs = [
  { label: 'Owners', value: 'owner' },
  { label: 'Staff', value: 'staff' },
  { label: 'Customers', value: 'customer' },
  { label: 'Super admins', value: 'superadmin' },
  { label: 'Banned', value: 'banned' },
]

const columns: TableColumn<PlatformAccountSummary>[] = [
  { accessorKey: 'name', header: 'Account' },
  { id: 'access', header: 'Access' },
  { id: 'status', header: 'Status' },
  { id: 'created', header: 'Joined' },
]
</script>

<template>
  <UDashboardPanel id="accounts">
    <template #header>
      <UDashboardNavbar title="Accounts">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search name or email…"
            class="w-full sm:w-64"
          />
        </template>
      </UDashboardToolbar>
      <RefreshBar :active="refreshing" />
    </template>

    <template #body>
      <StatusTabs
        v-model="filters.kind"
        :tabs="kindTabs"
      />

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the accounts"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading accounts…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="accounts"
        :filtered="isFiltered"
        @clear="clearFilters()"
      />

      <!-- Phones: rows, one large target each (page-patterns §2) -->
      <ul
        v-else-if="isCompact"
        aria-label="Accounts"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="account in rows"
          :key="account.id"
          class="p-1"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :to="accountPath(account.id)"
            block
            class="justify-start text-left"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="flex max-w-full items-center gap-2">
                <span class="break-words font-medium text-highlighted">{{ account.name }}</span>
                <UBadge
                  v-if="account.ban"
                  color="error"
                  variant="subtle"
                >
                  Banned
                </UBadge>
              </span>
              <span class="max-w-full truncate font-normal text-muted">{{ account.email }}</span>
              <span class="max-w-full font-normal text-muted">{{ accessLine(account) }}</span>
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
        <!-- The name opens the account -->
        <template #name-cell="{ row }">
          <UButton
            color="neutral"
            variant="ghost"
            :to="accountPath(row.original.id)"
            class="-mx-2.5 -my-1.5 max-w-full text-left"
          >
            <span class="flex min-w-0 flex-col">
              <span class="font-medium text-highlighted">{{ row.original.name }}</span>
              <span class="truncate font-normal text-muted">{{ row.original.email }}</span>
            </span>
          </UButton>
        </template>

        <template #access-cell="{ row }">
          <span class="text-muted">{{ accessLine(row.original) }}</span>
        </template>

        <template #status-cell="{ row }">
          <UTooltip
            v-if="row.original.ban"
            :text="banLine(row.original.ban)"
          >
            <UBadge
              color="error"
              variant="subtle"
            >
              Banned
            </UBadge>
          </UTooltip>
          <UBadge
            v-else
            color="success"
            variant="subtle"
          >
            Active
          </UBadge>
        </template>

        <template #created-cell="{ row }">
          <span class="text-muted">{{ timeAgo(row.original.createdAt) }}</span>
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
