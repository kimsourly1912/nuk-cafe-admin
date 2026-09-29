<script setup lang="ts">
/**
 * The branch's dining tables (D91, the owner's mockup): search by name or area, All / Active /
 * Archived tabs with counts, and a card per table with its QR code. A branch has few tables, so they
 * load together and the tab filters them itself. "New table" is the page's navbar action
 * (`openNew`, exposed); `N` opens it too.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DiningTable } from '#shared/contracts/branches'
import { useBranchTables, useTableMutations } from '../composables/useBranches'
import TableCard from './TableCard.vue'
import TableFormModal from './TableFormModal.vue'
import TableQrModal from './TableQrModal.vue'

const props = defineProps<{ branchId: string }>()

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

const { data, loading, refreshing, error, refresh } = useBranchTables(props.branchId)
const { archive, restore, rotate, isBusy } = useTableMutations()

const status = ref<string>('active')
const search = ref('')

const tables = computed(() => data.value ?? [])
const matching = computed(() => {
  const query = search.value.trim().toLowerCase()
  return query ? tables.value.filter(t => t.label.toLowerCase().includes(query) || t.area?.toLowerCase().includes(query)) : tables.value
})
const counts = computed(() => ({
  all: matching.value.length,
  active: matching.value.filter(t => t.status === 'active').length,
  archived: matching.value.filter(t => t.status === 'archived').length,
}))
const shown = computed(() => (status.value === ANY ? matching.value : matching.value.filter(t => t.status === status.value)))
const isFiltered = computed(() => !!search.value.trim() || status.value !== 'active')

const overlay = useOverlay()
const formModal = overlay.create(TableFormModal)
const qrModal = overlay.create(TableQrModal)

function openNew() {
  formModal.open({ branchId: props.branchId })
}
function openEdit(table: DiningTable) {
  formModal.open({ branchId: props.branchId, table })
}
async function viewQr(table: DiningTable) {
  if (table.qrUrl) qrModal.open({ table: { ...table, qrUrl: table.qrUrl } })
}
async function rotateQr(table: DiningTable) {
  const result = await rotate.execute({ table })
  // Show the new QR at once: it's the one to print now.
  if (result.ok && result.data.qrUrl) qrModal.open({ table: { ...result.data, qrUrl: result.data.qrUrl } })
}

function actions(table: DiningTable): DropdownMenuItem[] {
  if (table.status === 'archived') {
    return [{ label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute({ table }) }]
  }
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(table) },
    { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute({ table }) },
  ]
}

function clearFilters() {
  search.value = ''
  status.value = 'active'
}

usePageShortcuts({ n: () => openNew() })

defineExpose({ openNew, activeCount: computed(() => tables.value.filter(t => t.status === 'active').length) })
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">
        Dining tables
      </h2>
      <p class="text-sm text-muted">
        Create and manage the QR code on each table. Customers scan it to order for that table.
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <SearchInput
          v-model="search"
          placeholder="Search tables…"
          class="w-full sm:w-64"
        />
        <UIcon
          v-if="refreshing"
          name="i-lucide-loader-circle"
          class="size-4 shrink-0 animate-spin text-muted"
        />
      </div>
      <StatusTabs
        v-model="status"
        :tabs="TABS"
        :counts="data ? counts : null"
      />
    </div>

    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the tables"
      @retry="refresh()"
    />

    <ListSkeleton
      v-else-if="loading"
      label="Loading tables…"
      variant="card"
    />

    <ListEmptyState
      v-else-if="!shown.length"
      noun="tables"
      :filtered="isFiltered && tables.length > 0"
      create-label="New table"
      @create="openNew()"
      @clear="clearFilters()"
    />

    <div
      v-else
      class="@container"
    >
      <div class="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <TableCard
          v-for="table in shown"
          :key="table.id"
          :table="table"
          :actions="actions(table)"
          :busy="isBusy(table.id)"
          @view="viewQr(table)"
          @rotate="rotateQr(table)"
          @restore="restore.execute({ table })"
        />
      </div>
    </div>
  </div>
</template>
