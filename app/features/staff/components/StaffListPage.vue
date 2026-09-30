<script setup lang="ts">
/**
 * Staff: everyone with access to the admin app or a branch (D49, D52). A table from `sm`, because
 * the question is "who can do what, where"; on phones a list of rows (D77 table → rows, D79): each
 * row is one large button that opens the person, with the actions menu beside it. Admins only.
 */
import type { DropdownMenuItem, SelectItem, TableColumn } from '@nuxt/ui'
import type { StaffMember } from '#shared/contracts/staff'
import { useAuth } from '~/features/auth'
import { useBranchOptions, useStaffList, useStaffMutations } from '../composables/useStaff'
import { describeAccess } from '../schemas/staff-form'
import StaffFormModal from './StaffFormModal.vue'
import TemporaryPasswordModal from './TemporaryPasswordModal.vue'

const { user } = useAuth()
const { isCompact } = useLayoutContext()

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  role: ANY as 'admin' | 'manager' | 'staff' | Any,
  branchId: ANY as string,
})

const { data, loading, refreshing, error, refresh } = useStaffList(query)
const { disable, resetPassword, isBusy } = useStaffMutations()
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
/** "Admin · Manager at Riverside": access as text on a phone row (at most two badges per row). */
const accessLine = (member: StaffMember) => describeAccess(member).join(' · ') || 'No access'

function rowActions(member: StaffMember): DropdownMenuItem[] {
  return [
    { label: 'Edit access', icon: 'i-lucide-shield', onSelect: () => openForm(member) },
    {
      label: 'Reset password',
      icon: 'i-lucide-key-round',
      disabled: isSelf(member),
      description: isSelf(member) ? 'Use Change password in your account menu' : undefined,
      onSelect: () => reset(member),
    },
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

const passwordModal = useOverlay().create(TemporaryPasswordModal)
async function reset(member: StaffMember) {
  const result = await resetPassword.execute(member)
  // Shown once: it's the only time the password can be read.
  if (result.ok) void passwordModal.open({ name: result.data.staff.name, email: result.data.staff.email, password: result.data.temporaryPassword, reset: true })
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
            class="w-full sm:w-64"
          />
          <USelect
            v-model="filters.role"
            :items="roleItems"
            aria-label="Role"
            class="min-w-0 flex-1 sm:w-36 sm:flex-none"
          />
          <USelect
            v-model="filters.branchId"
            :items="branchItems"
            aria-label="Branch"
            class="min-w-0 flex-1 sm:w-44 sm:flex-none"
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

      <!-- Phones: rows, one large target each and the actions beside it (page-patterns §2) -->
      <ul
        v-else-if="isCompact"
        aria-label="Staff"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="member in rows"
          :key="member.id"
          class="flex items-center gap-1 p-1"
          :class="isBusy(member.id) && 'opacity-50'"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="member.name"
            :disabled="isBusy(member.id)"
            class="min-w-0 flex-1 text-left"
            @click="openForm(member)"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="max-w-full break-words font-medium text-highlighted">
                {{ member.name }}
                <span
                  v-if="isSelf(member)"
                  class="font-normal text-muted"
                >(you)</span>
              </span>
              <span class="max-w-full truncate font-normal text-muted">{{ member.email }}</span>
              <span class="max-w-full font-normal text-muted">{{ accessLine(member) }}</span>
              <UBadge
                v-if="member.mustChangePassword"
                color="warning"
                variant="outline"
                icon="i-lucide-key-round"
                class="mt-1"
              >
                Temporary password
              </UBadge>
            </span>
          </UButton>
          <UIcon
            v-if="isBusy(member.id)"
            name="i-lucide-loader-circle"
            class="size-5 shrink-0 animate-spin text-muted"
            aria-label="Working…"
          />
          <UDropdownMenu
            v-else
            :items="rowActions(member)"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              :aria-label="`Actions for ${member.name}`"
            />
          </UDropdownMenu>
        </li>
      </ul>

      <!-- shrink-0: the page body scrolls, not a table squeezed above the pagination (landscape phones) -->
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        class="shrink-0"
        :meta="{ class: { tr: row => (isBusy(row.original.id) ? 'opacity-50 pointer-events-none' : '') } }"
      >
        <!-- The name opens the person: the record's one target, beside (not around) its actions -->
        <template #name-cell="{ row }">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="row.original.name"
            class="-mx-2.5 -my-1.5 max-w-full text-left"
            @click="openForm(row.original)"
          >
            <span class="flex min-w-0 flex-col">
              <span class="font-medium text-highlighted">
                {{ row.original.name }}
                <span
                  v-if="isSelf(row.original)"
                  class="font-normal text-muted"
                >(you)</span>
              </span>
              <span class="truncate font-normal text-muted">
                {{ row.original.email }}
              </span>
            </span>
          </UButton>
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
