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
      <UDashboardNavbar :ui="{ root: 'h-auto min-h-(--ui-header-height) py-3' }">
        <template #left>
          <UDashboardSidebarCollapse />
          <div class="min-w-0">
            <h1 class="truncate text-xl font-semibold text-highlighted sm:text-2xl">
              Options
            </h1>
            <p class="line-clamp-2 text-sm text-muted sm:truncate">
              Create reusable choices like Size and Temperature
            </p>
          </div>
        </template>
        <template #right>
          <UTooltip
            text="New option set"
            :kbds="['n']"
          >
            <UButton
              icon="i-lucide-plus"
              size="lg"
              aria-label="New option set"
              class="min-h-11 min-w-11 justify-center"
              @click="create()"
            >
              <span class="hidden sm:inline">New option set</span>
            </UButton>
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <UAlert
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
          description="Options create menu-item versions. Prices are configured on each menu item."
        />

        <div class="flex items-center gap-2">
          <SearchInput
            v-model="filters.search"
            placeholder="Search option sets or values…"
            size="lg"
            class="w-full md:max-w-xl"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 shrink-0 animate-spin text-muted"
          />
        </div>

        <div class="-mx-4 overflow-x-auto border-b border-default px-4 sm:mx-0 sm:px-0">
          <StatusTabs
            v-model="filters.status"
            :tabs="TABS"
            :counts="counts"
            size="md"
          />
        </div>

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
