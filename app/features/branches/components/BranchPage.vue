<script setup lang="ts">
/**
 * A branch (`/branches/[id]`, D91, the owner's mockups): **Settings** and **Dining tables** tabs
 * under the navbar. The navbar's action follows the tab: Save changes (from `lg`; below it the
 * bottom bar) or New table. Both tabs stay mounted, so switching keeps the settings draft; the tab
 * is local state (`?tab=tables` opens that one), so switching never asks about unsaved changes.
 */
import { useBranchOptions, useBranchSettings, useBranchTables } from '../composables/useBranches'
import BranchSettingsTab from './BranchSettingsTab.vue'
import BranchTablesTab from './BranchTablesTab.vue'

const props = defineProps<{ id: string }>()

const route = useRoute()
const { data: settings, error, refresh } = useBranchSettings(props.id)
const { data: tables } = useBranchTables(props.id)
const { data: branches } = useBranchOptions()

type Tab = 'settings' | 'tables'
const tab = ref<Tab>(route.query.tab === 'tables' ? 'tables' : 'settings')
const tabs = computed(() => [
  { label: 'Settings', value: 'settings', icon: 'i-lucide-settings' },
  {
    label: 'Dining tables',
    value: 'tables',
    icon: 'i-lucide-armchair',
    badge: tables.value ? { label: String(tables.value.filter(t => t.status === 'active').length), color: 'neutral' as const, variant: 'subtle' as const, size: 'sm' as const } : undefined,
  },
])

const settingsTab = useTemplateRef('settingsTab')
const tablesTab = useTemplateRef('tablesTab')
const several = computed(() => (branches.value?.length ?? 0) > 1)
const title = computed(() => settings.value?.name ?? 'Branch')
</script>

<template>
  <UDashboardPanel id="branch">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="several"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/branches"
            aria-label="All branches"
          />
        </template>
        <template #title>
          <span class="flex min-w-0 items-center gap-2">
            <UIcon
              name="i-lucide-map-pin"
              class="size-5 shrink-0 text-muted"
            />
            <span class="truncate">{{ title }}</span>
          </span>
        </template>
        <template #right>
          <UTooltip
            v-if="tab === 'settings' && settings"
            text="Save changes"
            :kbds="['meta', 'enter']"
          >
            <UButton
              label="Save changes"
              icon="i-lucide-save"
              class="hidden lg:inline-flex"
              :disabled="!settingsTab?.isDirty"
              :loading="settingsTab?.saving"
              @click="settingsTab?.save()"
            />
          </UTooltip>
          <UTooltip
            v-else-if="tab === 'tables'"
            text="New table"
            :kbds="['n']"
          >
            <UButton
              label="New table"
              icon="i-lucide-plus"
              @click="tablesTab?.openNew()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <UTabs
          v-model="tab"
          :items="tabs"
          :content="false"
          variant="link"
          aria-label="Branch sections"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the branch"
        @retry="refresh()"
      />
      <ListSkeleton
        v-else-if="!settings"
        label="Loading the branch…"
        variant="card"
      />
      <template v-else>
        <BranchSettingsTab
          v-show="tab === 'settings'"
          ref="settingsTab"
          :settings="settings"
          @saved="value => settings = value"
        />
        <BranchTablesTab
          v-show="tab === 'tables'"
          ref="tablesTab"
          :branch-id="id"
        />
      </template>
    </template>
  </UDashboardPanel>
</template>
