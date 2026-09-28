<script setup lang="ts">
/**
 * The Add-ons library (D59): reusable groups of extras with default prices and selection rules. A
 * card per group; the whole library is loaded once (small, unpaginated), so search and the status
 * tabs work on it here. New groups are created in a modal, then edited in the editor, where each
 * change is saved at once (D67, D68). docs/plans/modifier-groups.md
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { useModifierGroupList, useModifierGroupMutations } from '../composables/useModifierGroups'
import ModifierGroupCard from './ModifierGroupCard.vue'
import ModifierGroupCreateModal from './ModifierGroupCreateModal.vue'
import ModifierGroupEditor from './ModifierGroupEditor.vue'

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: 'active' as string,
})

const { data, loading, refreshing, error, refresh } = useModifierGroupList()
const { archive, restore, isBusy } = useModifierGroupMutations()

const matching = computed(() => {
  const search = filters.search.trim().toLowerCase()
  return (data.value ?? []).filter(group => !search || group.name.toLowerCase().includes(search))
})
const rows = computed(() => matching.value.filter(group => filters.status === ANY || group.status === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  active: matching.value.filter(s => s.status === 'active').length,
  archived: matching.value.filter(s => s.status === 'archived').length,
})

const overlay = useOverlay()
const createModal = overlay.create(ModifierGroupCreateModal)
const editor = overlay.create(ModifierGroupEditor)

function openEditor(group: ModifierGroup) {
  editor.open({ group })
}

async function create() {
  // A new group opens in the editor, to reorder or refine its add-ons straight away.
  const created = await createModal.open().result
  if (created) openEditor(created)
}

function actions(group: ModifierGroup): DropdownMenuItem[] {
  if (group.status === 'archived') {
    return [
      { label: 'View', icon: 'i-lucide-eye', onSelect: () => openEditor(group) },
      { label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute({ group }) },
    ]
  }
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEditor(group) },
    { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute({ group }) },
  ]
}

usePageShortcuts({ n: () => create() })
</script>

<template>
  <UDashboardPanel id="modifier-groups">
    <template #header>
      <UDashboardNavbar title="Add-ons">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New add-on group"
            :kbds="['n']"
          >
            <UButton
              label="New add-on group"
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
            placeholder="Search add-ons…"
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
        Add-on groups are extras on top of an item, like milk or syrups, priced the same everywhere by default. A menu item picks the groups it offers and can set its own rules and prices.
      </p>

      <StatusTabs
        v-model="filters.status"
        :tabs="TABS"
        :counts="counts"
      />

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load add-on groups"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading add-on groups…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="add-on groups"
        :filtered="isFiltered"
        create-label="New add-on group"
        @create="create()"
        @clear="clearFilters()"
      />

      <div
        v-else
        class="space-y-3"
      >
        <ModifierGroupCard
          v-for="group in rows"
          :key="group.id"
          :group="group"
          :actions="actions(group)"
          :busy="isBusy(group.id)"
          @open="openEditor(group)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
