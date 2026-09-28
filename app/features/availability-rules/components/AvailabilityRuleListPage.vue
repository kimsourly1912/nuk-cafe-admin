<script setup lang="ts">
/**
 * The availability rules library (D63, redesigned as a weekly agenda in D76): when things can be
 * ordered. One full-width card per rule. The whole library is loaded once (it's small and
 * unpaginated), so search and the status tabs work on it here. No bulk actions and no order.
 * docs/plans/availability-rules.md
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { inUse, usageLabel, useAvailabilityRuleList, useAvailabilityRuleMutations } from '../composables/useAvailabilityRules'
import AvailabilityRuleCard from './AvailabilityRuleCard.vue'
import AvailabilityRuleFormModal from './AvailabilityRuleFormModal.vue'

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: 'active' as string,
})

const { data, loading, refreshing, error, refresh } = useAvailabilityRuleList()
const { archive, restore, isBusy } = useAvailabilityRuleMutations()

const matching = computed(() => {
  const search = filters.search.trim().toLowerCase()
  return (data.value ?? []).filter(rule => !search || rule.name.toLowerCase().includes(search))
})
const rows = computed(() => matching.value.filter(rule => filters.status === ANY || rule.status === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  active: matching.value.filter(r => r.status === 'active').length,
  archived: matching.value.filter(r => r.status === 'archived').length,
})

function actions(rule: AvailabilityRule): DropdownMenuItem[] {
  if (rule.status === 'archived') {
    return [{ label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute(rule) }]
  }
  const used = inUse(rule)
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(rule) },
    {
      label: 'Archive',
      icon: 'i-lucide-archive',
      disabled: used,
      description: used ? usageLabel(rule) : undefined,
      onSelect: () => archive.execute(rule),
    },
  ]
}

const formModal = useOverlay().create(AvailabilityRuleFormModal)
/** An archived rule opens read-only, with Restore (the server refuses edits until then). */
function openForm(rule?: AvailabilityRule) {
  formModal.open({ rule })
}

usePageShortcuts({ n: () => openForm() })
</script>

<template>
  <UDashboardPanel id="availability-rules">
    <template #header>
      <UDashboardNavbar title="Availability">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New rule"
            :kbds="['n']"
          >
            <UButton
              label="New rule"
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
            placeholder="Search availability rules…"
            class="w-64"
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
      <p class="text-sm text-muted">
        Control when menu items and categories can be ordered. Items without a rule are available whenever the cafe is open.
      </p>

      <StatusTabs
        v-model="filters.status"
        :tabs="TABS"
        :counts="counts"
      />

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load availability rules"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading availability rules…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="availability rules"
        :filtered="isFiltered"
        create-label="New rule"
        @create="openForm()"
        @clear="clearFilters()"
      />

      <div
        v-else
        class="space-y-3"
      >
        <AvailabilityRuleCard
          v-for="rule in rows"
          :key="rule.id"
          :rule="rule"
          :actions="actions(rule)"
          :busy="isBusy(rule.id)"
          @open="openForm(rule)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
