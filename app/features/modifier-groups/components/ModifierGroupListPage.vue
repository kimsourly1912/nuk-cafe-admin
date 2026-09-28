<script setup lang="ts">
/**
 * The Add-ons library (D59, redesigned in D75): reusable groups of extras with default prices and
 * selection rules. A card per group; the whole library is loaded once (small, unpaginated), so
 * search (group and add-on names) and the status tabs work on it here. A group opens on its own
 * page (`/add-ons/:id`); new groups are created in a modal, then opened there. No bulk actions and
 * no order of groups: menu items pick groups by name. docs/plans/modifier-groups.md
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { useModifierGroupList, useModifierGroupMutations } from '../composables/useModifierGroups'
import { searchModifierGroup } from '../schemas/modifier-group-display'
import ModifierGroupCard from './ModifierGroupCard.vue'
import ModifierGroupCreateModal from './ModifierGroupCreateModal.vue'

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

/** Groups matching the search, with the add-ons that matched (for the card's "Matches" line). */
const matching = computed(() => (data.value ?? []).flatMap((group) => {
  const match = searchModifierGroup(group, filters.search)
  return match ? [{ group, addOns: match.addOns }] : []
}))
const rows = computed(() => matching.value.filter(row => filters.status === ANY || row.group.status === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  active: matching.value.filter(row => row.group.status === 'active').length,
  archived: matching.value.filter(row => row.group.status === 'archived').length,
})

const createModal = useOverlay().create(ModifierGroupCreateModal)

async function create() {
  // A new group opens on its page, to refine its add-ons straight away.
  const created = await createModal.open().result
  if (created) await navigateTo(`/add-ons/${created.id}`)
}

function actions(group: ModifierGroup): DropdownMenuItem[] {
  // The card's own button opens the group; the menu only changes its status.
  return group.status === 'archived'
    ? [{ label: 'Restore', icon: 'i-lucide-archive-restore', onSelect: () => restore.execute({ group }) }]
    : [{ label: 'Archive', icon: 'i-lucide-archive', onSelect: () => archive.execute({ group }) }]
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
            placeholder="Search groups or add-ons…"
            class="w-full sm:w-64"
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
        Create reusable extras like milk, syrups, and toppings. Default prices and selection rules can be overridden per menu item.
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

      <div
        v-else-if="!rows.length && !filters.search && filters.status === 'active' && counts?.archived"
        class="flex flex-col items-center gap-2 py-10 text-center"
      >
        <UIcon
          name="i-lucide-archive"
          class="size-10 text-dimmed"
        />
        <p class="font-medium text-highlighted">
          Every add-on group is archived
        </p>
        <p class="text-sm text-muted">
          Restore one from the Archived tab, or create a new group.
        </p>
        <div class="mt-2 flex flex-wrap justify-center gap-2">
          <UButton
            label="Show archived"
            color="neutral"
            variant="outline"
            @click="filters.status = 'archived'"
          />
          <UButton
            label="New add-on group"
            icon="i-lucide-plus"
            @click="create()"
          />
        </div>
      </div>

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
        class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <ModifierGroupCard
          v-for="row in rows"
          :key="row.group.id"
          :group="row.group"
          :matches="row.addOns"
          :actions="actions(row.group)"
          :busy="isBusy(row.group.id)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
