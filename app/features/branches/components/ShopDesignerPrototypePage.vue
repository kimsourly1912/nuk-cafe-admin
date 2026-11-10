<script setup lang="ts">
/**
 * The shop designer's step 1 prototype (D273): Design shop, View in 3D and the furniture studio on
 * one demo layout, so placing a table and finding it in the building feel like one experience.
 * Demo data only and nothing is saved; dev and staging only (`shopDesignerPrototype`). Step 2 moves
 * the editor and the 3D view into a branch's Dining tables tab with its real tables.
 */
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from '../designer/demo'
import { useLayoutDraft } from '../composables/useLayoutDraft'
import type { PlanSelection } from './FloorPlanCanvas.vue'
import BuildingView3D from './BuildingView3D.vue'
import DesignShopEditor from './DesignShopEditor.vue'
import FurnitureStudio from './FurnitureStudio.vue'

type View = 'design' | '3d' | 'studio'

const view = useUrlTab<View>(['design', '3d', 'studio'])
const tabs = [
  { label: 'Design shop', value: 'design' as const, icon: 'i-lucide-layout-dashboard' },
  { label: 'View in 3D', value: '3d' as const, icon: 'i-lucide-box' },
  { label: 'Furniture studio', value: 'studio' as const, icon: 'i-lucide-armchair' },
]

const draft = useLayoutDraft(demoLayout())
const floorId = ref(draft.layout.value.floors[0]!.id)
const selection = ref<PlanSelection | null>(null)
const selectedTable = computed({
  get: () => (selection.value?.kind === 'table' ? selection.value.id : null),
  set: (id: string | null) => (selection.value = id ? { kind: 'table', id } : null),
})

function showOnPlan(tableId: string) {
  const placement = draft.layout.value.placements.find(candidate => candidate.tableId === tableId)
  if (placement) floorId.value = placement.floorId
  selection.value = { kind: 'table', id: tableId }
  view.value = 'design'
}

function resetDemo() {
  draft.reset(demoLayout())
  selection.value = null
  floorId.value = draft.layout.value.floors[0]!.id
}
</script>

<template>
  <UDashboardPanel
    id="shop-designer"
    :ui="{ body: 'p-0 sm:p-0 overflow-hidden' }"
  >
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #title>
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate">Shop designer</span>
            <UBadge
              label="Prototype"
              color="warning"
              variant="subtle"
            />
          </span>
        </template>
        <template #right>
          <span class="hidden text-sm text-muted sm:inline">Demo data · nothing is saved</span>
          <UButton
            label="Reset demo"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            :disabled="!draft.canUndo.value"
            @click="resetDemo"
          />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar>
        <ToolbarTabs
          v-model="view"
          :items="tabs"
          aria-label="Shop designer views"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <DesignShopEditor
        v-if="view === 'design'"
        v-model:floor-id="floorId"
        v-model:selection="selection"
        :draft="draft"
        :tables="DEMO_TABLES"
        :looks="BUILT_IN_LOOKS"
        @view3d="view = '3d'"
      />
      <BuildingView3D
        v-else-if="view === '3d'"
        v-model:selected-table="selectedTable"
        :layout="draft.layout.value"
        :tables="DEMO_TABLES"
        :looks="BUILT_IN_LOOKS"
        @show-on-plan="showOnPlan"
        @design-shop="view = 'design'"
      />
      <FurnitureStudio v-else />
    </template>
  </UDashboardPanel>
</template>
