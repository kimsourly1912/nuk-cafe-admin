<script setup lang="ts">
/**
 * Schedules as a list of cards: the week as day pills and the time on a 24-hour bar, because the
 * question here is "when is this on?", not comparing columns. docs/plans/list-ui-refresh.md
 */
import type { DropdownMenuItem, SelectItem } from '@nuxt/ui'
import type { Schedule } from '#shared/contracts/menu'
import { confirmDeleteMany, isLinked, linkedLabel, useScheduleList, useScheduleMutations, useScheduleStatusCounts } from '../composables/useSchedules'
import type { Day } from '../utils/days'
import { DAYS } from '../utils/days'
import { describeZone } from '../utils/timezone'
import ScheduleCard from './ScheduleCard.vue'
import ScheduleFormModal from './ScheduleFormModal.vue'

// --- Filters & pagination (kept in the URL) ---
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
  day: ANY as Day | Any,
})

const { data, loading, refreshing, error, refresh } = useScheduleList(query)
const { remove, isBusy } = useScheduleMutations()
const counts = useScheduleStatusCounts(() => ({ search: query.value.search, day: query.value.day }))

// Deleted rows disappear immediately, before the refreshed list arrives.
const rows = computed(() => (data.value?.items ?? []).filter(s => !remove.isRemoved(s.id)))

// Deleting the last rows of the last page: step back to a page that exists.
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const dayItems: SelectItem[] = [
  { label: 'Any day', value: ANY },
  ...DAYS.map(d => ({ label: d.label, value: d.value })),
]

// --- Selection & bulk actions ---
const selection = useTableSelection(rows, s => s.id, { resetOn: [query] })

async function removeSelected() {
  // Schedules in use can't be deleted yet (docs/plans/schedules.md S6): leave them out and say so.
  const linked = selection.selected.filter(isLinked)
  const deletable = selection.selected.filter(s => !isLinked(s))
  const result = await remove.executeMany(deletable, linked.length ? { confirm: confirmDeleteMany(deletable, linked.length) } : {})
  // Keep only the rows that still need attention selected: in use, failed, skipped (busy), not started.
  selection.select([
    ...linked.map(s => s.id),
    ...result.failed.map(f => f.input.id),
    ...result.skipped.map(s => s.id),
    ...result.notStarted.map(s => s.id),
  ])
}
const canDeleteSelected = computed(() => selection.selected.some(s => !isLinked(s)))

// --- Times: local wall time at the cafe, shown as stored (D41) ---
const cafeZone = useRuntimeConfig().public.cafeTimeZone

function rowActions(schedule: Schedule): DropdownMenuItem[] {
  const linked = isLinked(schedule)
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(schedule) },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: linked,
      description: linked ? linkedLabel(schedule.productCount) : undefined,
      onSelect: () => remove.execute(schedule),
    },
  ]
}

const formModal = useOverlay().create(ScheduleFormModal)
function openForm(schedule?: Schedule) {
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
            v-model="filters.day"
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
          <span class="text-xs text-muted">Cafe time: {{ describeZone(cafeZone) }}</span>
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
          v-if="rows.length"
          :model-value="selection.someSelected ? 'indeterminate' : selection.allSelected"
          :label="selection.allSelected ? 'Unselect all' : 'Select all'"
          aria-label="Select all"
          @update:model-value="value => selection.toggleAll(!!value)"
        />
      </div>

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load schedules"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading schedules…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="schedules"
        :filtered="isFiltered"
        create-label="New schedule"
        @create="openForm()"
        @clear="clearFilters()"
      />

      <div
        v-else
        class="space-y-3"
      >
        <ScheduleCard
          v-for="schedule in rows"
          :key="schedule.id"
          :schedule="schedule"
          :cafe-zone="cafeZone"
          :actions="rowActions(schedule)"
          :selected="selection.isSelected(schedule)"
          :busy="isBusy(schedule.id)"
          @open="openForm(schedule)"
          @select="value => selection.toggle(schedule, value)"
        />
      </div>

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
  </UDashboardPanel>
</template>
