<script setup lang="ts">
/**
 * The Options library (D58): reusable option sets that define the versions of menu items. A card
 * per set; the whole library is loaded once (small, unpaginated), so search and the status tabs
 * work on it here. New sets are created in a modal, then edited in the editor, where each change
 * is saved at once. docs/plans/option-sets.md
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { useOptionSetList, useOptionSetMutations } from '../composables/useOptionSets'
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

const matching = computed(() => {
  const search = filters.search.trim().toLowerCase()
  return (data.value ?? []).filter(set => !search || set.name.toLowerCase().includes(search))
})
const rows = computed(() => matching.value.filter(set => filters.status === ANY || set.status === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  active: matching.value.filter(s => s.status === 'active').length,
  archived: matching.value.filter(s => s.status === 'archived').length,
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
  if (set.status === 'archived') {
    return [
      { label: 'View', icon: 'i-lucide-eye', onSelect: () => openEditor(set) },
      { label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute({ set }) },
    ]
  }
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEditor(set) },
    { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute({ set }) },
  ]
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
            placeholder="Search option sets…"
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
        Option sets define an item's versions, like Size or Temperature. A menu item picks up to two, then sets a price for each version.
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
        class="space-y-3"
      >
        <OptionSetCard
          v-for="set in rows"
          :key="set.id"
          :set="set"
          :actions="actions(set)"
          :busy="isBusy(set.id)"
          @open="openEditor(set)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
