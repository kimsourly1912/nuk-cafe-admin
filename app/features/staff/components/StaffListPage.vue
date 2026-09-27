<script setup lang="ts">
/**
 * Staff: everyone with access to the admin app or a branch (D49, D52). A table, because the
 * question is "who can do what, where". Admins only.
 */
import type { DropdownMenuItem, SelectItem, TableColumn } from '@nuxt/ui'
import type { StaffMember } from '#shared/contracts/staff'
import { useAuth } from '~/features/auth'
import { useBranchOptions, useStaffList, useStaffMutations } from '../composables/useStaff'
import { describeAccess } from '../schemas/staff-form'
import StaffFormModal from './StaffFormModal.vue'

const { user } = useAuth()

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  role: ANY as 'admin' | 'manager' | 'staff' | Any,
  branchId: ANY as string,
})

const { data, loading, refreshing, error, refresh } = useStaffList(query)
const { disable, isBusy } = useStaffMutations()
const branches = useBranchOptions()

// Disabled people disappear at once, before the refreshed list arrives.
const rows = computed(() => (data.value?.items ?? []).filter(m => !disable.isRemoved(m.id)))

watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const roleItems: SelectItem[] = [
  { label: 'Any role', value: ANY },
  { label: 'Admin', value: 'admin' },
  { label: 'Manager', value: 'manager' },
  { label: 'Staff', value: 'staff' },
]
const branchItems = computed<SelectItem[]>(() => [
  { label: 'Any branch', value: ANY },
  ...(branches.data.value ?? []).map(b => ({ label: b.name, value: b.id })),
])

const columns: TableColumn<StaffMember>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'access', header: 'Access' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

const isSelf = (member: StaffMember) => member.id === user.value?.userId

function rowActions(member: StaffMember): DropdownMenuItem[] {
  return [
    { label: 'Edit access', icon: 'i-lucide-shield', onSelect: () => openForm(member) },
    {
      label: 'Disable',
      icon: 'i-lucide-user-x',
      color: 'error',
      disabled: isSelf(member),
      description: isSelf(member) ? 'You can\'t disable yourself' : undefined,
      onSelect: () => disable.execute(member),
    },
  ]
}

const formModal = useOverlay().create(StaffFormModal)
function openForm(member?: StaffMember) {
  formModal.open({ member })
}

usePageShortcuts({ n: () => openForm() })
</script>

<template>
  <UDashboardPanel id="staff">
    <template #header>
      <UDashboardNavbar title="Staff">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="Add staff member"
            :kbds="['n']"
          >
            <UButton
              label="Add staff member"
              icon="i-lucide-user-plus"
              @click="openForm()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search name or email…"
            class="w-64"
          />
          <USelect
            v-model="filters.role"
            :items="roleItems"
            aria-label="Role"
            class="w-36"
          />
          <USelect
            v-model="filters.branchId"
            :items="branchItems"
            aria-label="Branch"
            class="w-44"
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
        title="Could not load staff"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading staff…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="staff members"
        :filtered="isFiltered"
        create-label="Add staff member"
        @create="openForm()"
        @clear="clearFilters()"
      />

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :meta="{ class: { tr: row => (isBusy(row.original.id) ? 'opacity-50 pointer-events-none' : 'cursor-pointer') } }"
        @select="(_, row) => openForm(row.original)"
      >
        <template #name-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">
              {{ row.original.name }}
              <span
                v-if="isSelf(row.original)"
                class="font-normal text-muted"
              >(you)</span>
            </p>
            <p class="truncate text-muted">
              {{ row.original.email }}
            </p>
          </div>
        </template>

        <template #access-cell="{ row }">
          <div class="flex flex-wrap items-center gap-1">
            <UBadge
              v-for="label in describeAccess(row.original)"
              :key="label"
              :color="label === 'Admin' ? 'primary' : 'neutral'"
              variant="subtle"
            >
              {{ label }}
            </UBadge>
            <UBadge
              v-if="row.original.mustChangePassword"
              color="warning"
              variant="outline"
              icon="i-lucide-key-round"
            >
              Temporary password
            </UBadge>
          </div>
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
              @click.stop
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
