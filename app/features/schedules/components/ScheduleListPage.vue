<script setup lang="ts">
import type { DropdownMenuItem, SelectItem, TableColumn } from '@nuxt/ui'
import type { ScheduleListResponse } from '~/generated/api'
import { confirmDeleteMany, isLinked, linkedReason, useScheduleList, useScheduleMutations } from '../composables/useSchedules'
import type { Day } from '../utils/days'
import { DAYS, formatDays, formatTimeRange } from '../utils/days'
import { shiftWeekly, viewerTimeZone, zoneLabel, zoneShift } from '../utils/timezone'
import ScheduleFormModal from './ScheduleFormModal.vue'

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
  dayOfWeek: ANY as Day | Any,
})

const { data, loading, refreshing, error, refresh } = useScheduleList(query)
const { remove, isBusy } = useScheduleMutations()

// Deleted rows disappear immediately, before the refreshed list arrives.
const rows = computed(() => (data.value?.content ?? []).filter(s => !remove.isRemoved(s.id!)))

// Deleting the last rows of the last page: step back to a page that exists.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const dayItems: SelectItem[] = [
  { label: 'Any day', value: ANY },
  ...DAYS.map(d => ({ label: d.label, value: d.value })),
]

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, s => s.id!, { resetOn: [query] })

async function removeSelected() {
  // Schedules in use can't be deleted yet (docs/plans/schedules.md S6): leave them out and say so.
  const linked = selection.selected.filter(isLinked)
  const deletable = selection.selected.filter(s => !isLinked(s))
  const result = await remove.executeMany(deletable, linked.length ? { confirm: confirmDeleteMany(deletable, linked.length) } : {})
  // Keep only the rows that still need attention selected: in use, failed, skipped (busy), not started.
  selection.select([
    ...linked.map(s => s.id!),
    ...result.failed.map(f => f.input.id!),
    ...result.skipped.map(s => s.id!),
    ...result.notStarted.map(s => s.id!),
  ])
}
const canDeleteSelected = computed(() => selection.selected.some(s => !isLinked(s)))

// --- Times: stored in each record's zone, shown in the viewer's (docs/plans/schedules.md S2) ---
const viewerZone = zoneLabel(viewerTimeZone())

/** Days and times in the viewer's zone. An unknown record zone is shown as stored, labelled. */
function localWeekly(schedule: ScheduleListResponse) {
  const stored = { days: schedule.days ?? [], startTime: schedule.startTime ?? '', endTime: schedule.endTime ?? '' }
  const shift = zoneShift(schedule.timezone)
  return shift === undefined ? { ...stored, zone: schedule.timezone } : { ...shiftWeekly(stored, shift), zone: undefined }
}
const local = computed(() => new Map(rows.value.map(s => [s.id, localWeekly(s)])))

// --- Table ---
const columns: TableColumn<ScheduleListResponse>[] = [
  { id: 'select' },
  { accessorKey: 'name', header: 'Name' },
  { id: 'days', header: 'Days' },
  { id: 'time', header: `Time (${viewerZone})` },
  { accessorKey: 'item_count', header: 'Menu items' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]

function rowActions(schedule: ScheduleListResponse): DropdownMenuItem[] {
  const linked = isLinked(schedule)
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(schedule) },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: linked,
      description: linked ? linkedReason(schedule.item_count!) : undefined,
      onSelect: () => remove.execute(schedule),
    },
  ]
}

const formModal = useOverlay().create(ScheduleFormModal)
function openForm(schedule?: ScheduleListResponse) {
  formModal.open({ schedule })
}

usePageShortcuts({ n: () => openForm() })
</script>

<template>
  <UDashboardPanel id="schedules">
    <template #header>
      <UDashboardNavbar title="Schedules">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New schedule"
            :kbds="['n']"
          >
            <UButton
              label="New schedule"
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
            placeholder="Search schedules…"
            class="w-64"
          />
          <USelect
            v-model="filters.status"
            :items="STATUS_FILTER_ITEMS"
            class="w-40"
          />
          <USelect
            v-model="filters.dayOfWeek"
            :items="dayItems"
            aria-label="Day"
            class="w-32"
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
              :disabled="!canDeleteSelected"
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
        title="Could not load schedules"
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
          <span class="text-muted">Loading schedules…</span>
        </template>
        <template #empty>
          <ListEmptyState
            noun="schedules"
            :filtered="isFiltered"
            create-label="New schedule"
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

        <template #name-cell="{ row }">
          <p class="font-medium text-highlighted">
            {{ row.original.name }}
          </p>
          <p
            v-if="row.original.description"
            class="max-w-xs truncate text-muted"
          >
            {{ row.original.description }}
          </p>
        </template>

        <template #days-cell="{ row }">
          {{ formatDays(local.get(row.original.id)?.days) }}
        </template>

        <template #time-cell="{ row }">
          <span class="whitespace-nowrap tabular-nums">
            {{ formatTimeRange(local.get(row.original.id)?.startTime, local.get(row.original.id)?.endTime) }}
          </span>
          <span
            v-if="local.get(row.original.id)?.zone"
            class="ml-1 text-xs text-muted"
          >{{ local.get(row.original.id)?.zone }}</span>
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
