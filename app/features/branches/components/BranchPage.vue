<script setup lang="ts">
/**
 * A branch (`/admin/branches/[id]`, D91, the owner's mockups): **Settings** and **Dining tables** tabs
 * under the navbar. Dining tables has three views (D273): **Table list**, **Design shop** (the 2D
 * editor) and **View in 3D**; the last two use the page's full width. The navbar's action follows
 * the tab: Save changes (from `lg`; below it the bottom bar), New table, or Save layout. Both tabs
 * and the layout's draft stay alive, so switching keeps the settings and the layout drafts; the tab
 * and view are kept in the URL (`?tab=tables&view=design`, `useUrlTab`) without a route change, so
 * switching never asks about unsaved changes.
 */
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { useAddBranch } from '../composables/useAddBranch'
import { useBranchOptions } from '../composables/useBranchOptions'
import { useBranchSettings, useBranchTables } from '../composables/useBranches'
import { useLayoutEditor } from '../composables/useLayoutEditor'
import BranchSkeleton from './BranchSkeleton.vue'
import BranchSettingsTab from './BranchSettingsTab.vue'
import BranchTablesTab from './BranchTablesTab.vue'
import BuildingView3D from './BuildingView3D.vue'
import DesignShopEditor from './DesignShopEditor.vue'

const tenantPath = useTenantPath()

const props = defineProps<{ id: string }>()

const { data: settings, error, refresh } = useBranchSettings(props.id)
const { data: tables } = useBranchTables(props.id)
const { data: branches } = useBranchOptions()
const editor = useLayoutEditor(props.id)

type Tab = 'settings' | 'tables'
const tab = useUrlTab<Tab>(['settings', 'tables'])
const tabs = computed(() => [
  { label: 'Settings', value: 'settings' as const, icon: 'i-lucide-settings' },
  {
    label: 'Dining tables',
    value: 'tables' as const,
    icon: 'i-lucide-armchair',
    badge: tables.value ? { label: String(tables.value.filter(t => t.status === 'active').length), color: 'neutral' as const, variant: 'subtle' as const, size: 'sm' as const } : undefined,
  },
])

type View = 'list' | 'design' | '3d'
const view = useUrlTab<View>(['list', 'design', '3d'], 'view')
const VIEWS: { value: View, label: string, icon: string }[] = [
  { value: 'list', label: 'Table list', icon: 'i-lucide-list' },
  { value: 'design', label: 'Design shop', icon: 'i-lucide-layout-dashboard' },
  { value: '3d', label: 'View in 3D', icon: 'i-lucide-box' },
]
const designing = computed(() => tab.value === 'tables' && view.value !== 'list')
watch(designing, value => value && editor.load(), { immediate: true })
const layout = computed(() => editor.draft.layout.value)
const summary = computed(() => {
  const count = editor.tables.value.length
  if (!editor.query.data.value || !layout.value.floors.length) return ''
  const placed = layout.value.placements.length
  const floors = layout.value.floors.length
  return `${placed} of ${count} ${count === 1 ? 'table' : 'tables'} on the map · ${floors} ${floors === 1 ? 'floor' : 'floors'}`
})

/** One selected table for Design shop and View in 3D: picked in one, it is picked in the other. */
const selectedTable = computed<string | null>({
  get: () => (editor.selection.value?.kind === 'table' ? editor.selection.value.id : null),
  set: (id) => {
    if (id) editor.selection.value = { kind: 'table', id }
    else if (editor.selection.value?.kind === 'table') editor.selection.value = null
  },
})
function showOnPlan(tableId: string) {
  const placement = layout.value.placements.find(candidate => candidate.tableId === tableId)
  if (placement) editor.showFloor(placement.floorId)
  selectedTable.value = tableId
  view.value = 'design'
}

const settingsTab = useTemplateRef('settingsTab')
const tablesTab = useTemplateRef('tablesTab')
const several = computed(() => (branches.value?.length ?? 0) > 1)
// With one branch there is no list to add from (it opens this page): Add branch is here (D197).
const { addBranch } = useAddBranch()
const title = computed(() => settings.value?.name ?? 'Branch')
</script>

<template>
  <UDashboardPanel
    id="branch"
    :class="!designing && 'page-narrow'"
    :ui="designing ? { body: 'p-0 sm:p-0 overflow-hidden' } : undefined"
  >
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="several"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="tenantPath('/admin/branches')"
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
          <UButton
            v-if="branches?.length === 1 && settings && !designing"
            label="Add branch"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            :ui="{ label: 'max-sm:sr-only' }"
            @click="addBranch(settings.timezone)"
          />
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
          <template v-else-if="designing">
            <span
              v-if="editor.isDirty.value"
              class="hidden items-center gap-1.5 text-sm text-muted sm:inline-flex"
              data-testid="layout-unsaved"
            >
              <span class="size-2 rounded-full bg-warning" />
              Unsaved changes
            </span>
            <UButton
              label="Save layout"
              icon="i-lucide-save"
              :disabled="!editor.isDirty.value"
              :loading="editor.saving.value"
              @click="editor.save()"
            />
          </template>
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
        <ToolbarTabs
          v-model="tab"
          :items="tabs"
          aria-label="Branch sections"
        />
        <div
          v-if="tab === 'tables'"
          class="flex shrink-0 items-center gap-3"
        >
          <span
            v-if="summary"
            class="hidden text-sm text-muted xl:inline"
          >{{ summary }}</span>
          <UFieldGroup
            size="sm"
            role="group"
            aria-label="Dining tables views"
          >
            <UButton
              v-for="option in VIEWS"
              :key="option.value"
              :label="option.label"
              :icon="option.icon"
              :color="view === option.value ? 'primary' : 'neutral'"
              :variant="view === option.value ? 'soft' : 'outline'"
              :aria-pressed="view === option.value"
              :ui="{ label: 'max-md:sr-only' }"
              @click="view = option.value"
            />
          </UFieldGroup>
        </div>
      </UDashboardToolbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the branch"
        @retry="refresh()"
      />
      <BranchSkeleton v-else-if="!settings" />
      <template v-else>
        <BranchSettingsTab
          v-show="tab === 'settings'"
          ref="settingsTab"
          :settings="settings"
          @saved="value => settings = value"
        />
        <BranchTablesTab
          v-show="tab === 'tables' && view === 'list'"
          ref="tablesTab"
          :branch-id="id"
        />
        <DesignShopEditor
          v-if="tab === 'tables' && view === 'design'"
          :editor="editor"
          :branch-id="id"
          :dining-tables="tables ?? []"
          :looks="BUILT_IN_LOOKS"
          @view3d="view = '3d'"
        />
        <template v-else-if="tab === 'tables' && view === '3d'">
          <div
            v-if="editor.query.error.value && !editor.query.data.value"
            class="p-4"
          >
            <ApiErrorAlert
              :error="editor.query.error.value"
              title="Could not load the shop layout"
              @retry="editor.query.refresh()"
            />
          </div>
          <div
            v-else-if="!editor.query.data.value"
            class="p-4"
          >
            <ListSkeleton
              label="Loading the shop layout…"
              variant="card"
            />
          </div>
          <div
            v-else-if="!layout.floors.length"
            class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <UIcon
              name="i-lucide-box"
              class="size-8 text-muted"
            />
            <p class="font-semibold text-highlighted">
              No shop layout yet
            </p>
            <p class="max-w-sm text-sm text-muted">
              Draw the shop in Design shop and place its tables; then explore it here as a building.
            </p>
            <UButton
              label="Design shop"
              icon="i-lucide-layout-dashboard"
              @click="view = 'design'"
            />
          </div>
          <BuildingView3D
            v-else
            v-model:selected-table="selectedTable"
            :layout="layout"
            :tables="editor.tables.value"
            :looks="BUILT_IN_LOOKS"
            :dining-tables="tables ?? []"
            :unsaved="editor.isDirty.value"
            @show-on-plan="showOnPlan"
            @design-shop="view = 'design'"
          />
        </template>
      </template>
    </template>
  </UDashboardPanel>
</template>
