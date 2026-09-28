<script setup lang="ts">
/**
 * The Options library (D58, redesigned in D73): reusable option sets that define the versions of
 * menu items. A card per set; the whole library is loaded once (small, unpaginated), so search (set
 * and value names) and the status tabs work on it here. New sets are created in a modal, then
 * edited in the editor, where each change is saved at once. No bulk actions and no order of sets:
 * menu items pick sets by name. docs/plans/option-sets.md
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { useOptionSetList, useOptionSetMutations } from '../composables/useOptionSets'
import { searchOptionSet } from '../schemas/option-set-display'
import OptionSetCard from './OptionSetCard.vue'
import OptionSetCreateModal from './OptionSetCreateModal.vue'
import OptionSetEditor from './OptionSetEditor.vue'

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: 'active' as string,
})

const { data, loading, refreshing, error, refresh } = useOptionSetList()
const { archive, restore, isBusy } = useOptionSetMutations()

/** Sets matching the search, with the values that matched (for the card's "Matches" line). */
const matching = computed(() => (data.value ?? []).flatMap((set) => {
  const match = searchOptionSet(set, filters.search)
  return match ? [{ set, values: match.values }] : []
}))
const rows = computed(() => matching.value.filter(row => filters.status === ANY || row.set.status === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  active: matching.value.filter(row => row.set.status === 'active').length,
  archived: matching.value.filter(row => row.set.status === 'archived').length,
})

const overlay = useOverlay()
const createModal = overlay.create(OptionSetCreateModal)
const editor = overlay.create(OptionSetEditor)

function openEditor(set: OptionSet) {
  editor.open({ set })
}

async function create() {
  // A new set opens in the editor, to reorder or refine its values straight away.
  const created = await createModal.open().result
  if (created) openEditor(created)
}

function actions(set: OptionSet): DropdownMenuItem[] {
  // The card's own button opens the set; the menu only changes its status.
  return set.status === 'archived'
    ? [{ label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute({ set }) }]
    : [{ label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute({ set }) }]
}

usePageShortcuts({ n: () => create() })
</script>

<template>
  <UDashboardPanel id="option-sets">
    <template #header>
      <UDashboardNavbar title="Options">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New option set"
            :kbds="['n']"
          >
            <UButton
              label="New option set"
              icon="i-lucide-plus"
              @click="create()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search sets or values…"
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
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Create reusable choices like Size and Temperature. Options create menu-item versions; prices are configured on each menu item.
        </p>

        <StatusTabs
          v-model="filters.status"
          :tabs="TABS"
          :counts="counts"
        />

        <ApiErrorAlert
          v-if="error"
          :error="error"
          title="Could not load option sets"
          @retry="refresh()"
        />

        <ListSkeleton
          v-else-if="loading"
          label="Loading option sets…"
        />

        <ListEmptyState
          v-else-if="!rows.length"
          noun="option sets"
          :filtered="isFiltered"
          create-label="New option set"
          @create="create()"
          @clear="clearFilters()"
        />

        <div
          v-else
          class="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <OptionSetCard
            v-for="row in rows"
            :key="row.set.id"
            :set="row.set"
            :matches="row.values"
            :actions="actions(row.set)"
            :busy="isBusy(row.set.id)"
            @open="openEditor(row.set)"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
