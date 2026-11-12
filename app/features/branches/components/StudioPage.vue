<script setup lang="ts">
import { NO_SCENE } from '#shared/contracts/shop-layout'
import type { ScenePreset } from '#shared/contracts/shop-layout'
import { SupportBanner } from '~/features/support'
import { useBranchSettings, useBranchTables } from '../composables/useBranches'
import { useLayoutEditor } from '../composables/useLayoutEditor'
import BuildingView3D from './BuildingView3D.vue'
import DesignShopEditor from './DesignShopEditor.vue'
import LayoutSaveAlerts from './LayoutSaveAlerts.vue'

const props = defineProps<{ id: string }>()
const route = useRoute()
const router = useRouter()
const tenantPath = useTenantPath()
const cafe = useCafe()
const { data: settings, error, refresh } = useBranchSettings(props.id)
const { data: tables } = useBranchTables(props.id)
const hasPin = computed(() => settings.value?.latitude != null && settings.value?.longitude != null)
const editor = useLayoutEditor(props.id)
const { ready, isDirty, saving } = editor
const view = useUrlTab(['design', '3d'] as const, 'view')
editor.load()
const layout = editor.draft.layout
const hasOutline = computed(() => layout.value.floors.some(floor => floor.outline.length >= 3))
const explore = useRuntimeConfig().public.explore
const publishes = computed(() => explore && hasPin.value && (layout.value.scene?.explore || editor.query.data.value?.scene?.explore))
const exitOpen = ref(false)
function adminReturnPath() {
  const back = router.options.history.state.back
  if (typeof back !== 'string' || !back.startsWith(tenantPath('/admin'))) return tenantPath('/admin')
  const path = router.resolve(back).path
  const admin = tenantPath('/admin')
  const studio = tenantPath('/admin/studio')
  const inAdmin = path === admin || path.startsWith(`${admin}/`)
  return inAdmin && path !== studio && !path.startsWith(`${studio}/`) ? back : admin
}

const backTo = computed(() => route.query.from === 'tables'
  ? { path: tenantPath(`/admin/branches/${props.id}`), query: { tab: 'tables' } }
  : route.query.from === 'picker' ? tenantPath('/admin/studio') : adminReturnPath())

async function leave(save: boolean) {
  if (save) {
    const saved = await editor.save()
    if (!saved || isDirty.value) {
      exitOpen.value = false
      return
    }
  }
  else editor.discard()
  exitOpen.value = false
  await navigateTo(backTo.value)
}
/** One selected table for Design shop and View in 3D: picked in one, it is picked in the other. */
const selectedTable = computed<string | null>({
  get: () => (editor.selection.value?.kind === 'table' ? editor.selection.value.id : null),
  set: (id) => {
    if (id) {
      const placement = layout.value.placements.find(candidate => candidate.tableId === id)
      if (placement) editor.showFloor(placement.floorId)
      editor.selection.value = { kind: 'table', id }
    }
    else if (editor.selection.value?.kind === 'table') editor.selection.value = null
  },
})
function showOnPlan(tableId: string) {
  selectedTable.value = tableId
  view.value = 'design'
}

/** One selected piece too (step 3e), the same way: picked in 3D, it is selected in Design shop. */
const selectedItem = computed<string | null>({
  get: () => (editor.selection.value?.kind === 'item' ? editor.selection.value.id : null),
  set: (id) => {
    if (id) {
      const floor = layout.value.floors.find(candidate => candidate.items.some(item => item.id === id))
      if (floor) editor.showFloor(floor.id)
      editor.selection.value = { kind: 'item', id }
    }
    else if (editor.selection.value?.kind === 'item') editor.selection.value = null
  },
})
/** The branch's scene (step 4a): part of the draft, so Save layout saves it with the layout. */
const scene = computed<ScenePreset>({
  get: () => (layout.value.scene ?? NO_SCENE).preset,
  set: preset => editor.setScene(preset),
})
function showItemOnPlan(itemId: string) {
  selectedItem.value = itemId
  view.value = 'design'
}
</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-default">
    <SupportBanner />
    <header class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-b border-default px-2 py-2 sm:gap-3 sm:px-4">
      <div class="flex min-w-0 items-center gap-1 sm:gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to admin"
          @click="isDirty ? exitOpen = true : navigateTo(backTo)"
        />
        <UIcon
          name="i-lucide-box"
          class="hidden size-5 shrink-0 text-primary sm:block"
        />
        <div class="min-w-0">
          <h1 class="truncate text-sm font-semibold text-highlighted">
            {{ cafe.name.value ? `${cafe.name.value} Studio` : 'Studio' }}
          </h1>
          <p class="truncate text-xs text-muted">
            {{ settings?.name }}
          </p>
        </div>
      </div>
      <UFieldGroup
        role="group"
        aria-label="Layout view"
      >
        <UButton
          label="2D"
          :variant="view === 'design' ? 'soft' : 'ghost'"
          :color="view === 'design' ? 'primary' : 'neutral'"
          :aria-pressed="view === 'design'"
          @click="view = 'design'"
        />
        <UButton
          label="3D"
          :variant="view === '3d' ? 'soft' : 'ghost'"
          :color="view === '3d' ? 'primary' : 'neutral'"
          :aria-pressed="view === '3d'"
          @click="view = '3d'"
        />
      </UFieldGroup>
      <div class="flex min-w-0 items-center justify-end gap-2">
        <span
          class="hidden text-xs text-muted sm:inline"
          role="status"
          :data-testid="isDirty ? 'layout-unsaved' : undefined"
        >{{ saving ? 'Saving…' : isDirty ? 'Unsaved changes' : ready ? 'Saved' : '' }}</span>
        <UColorModeButton class="hidden sm:inline-flex" />
        <UButton
          label="Save layout"
          :disabled="!ready || !isDirty"
          :loading="saving"
          @click="editor.save()"
        />
      </div>
    </header>
    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the branch"
      class="m-3"
      @retry="refresh()"
    />
    <template v-else>
      <LayoutSaveAlerts
        :editor="editor"
        :dining-tables="tables ?? []"
      />
      <p
        v-if="publishes && isDirty"
        class="border-b border-default px-3 py-1 text-xs text-muted"
        role="status"
      >
        Saving can update the customer-facing Explore layout.
      </p>
      <div
        v-show="view === 'design'"
        class="min-h-0 flex-1"
      >
        <DesignShopEditor
          :editor="editor"
          :branch-id="id"
          :has-pin="hasPin"
          :dining-tables="tables ?? []"
          :looks="editor.looks.value"
          :active="view === 'design'"
        />
      </div>
      <div
        v-if="view === '3d'"
        class="min-h-0 flex-1"
      >
        <div
          v-if="editor.error.value"
          class="p-4"
        >
          <ApiErrorAlert
            :error="editor.error.value"
            title="Could not load the shop layout"
            @retry="editor.retry()"
          />
        </div>
        <div
          v-else-if="!ready"
          class="p-4"
        >
          <ListSkeleton
            label="Loading the shop layout…"
            variant="card"
          />
        </div>
        <div
          v-else-if="!hasOutline"
          class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p class="font-semibold text-highlighted">
            No shop layout yet
          </p>
          <p class="text-sm text-muted">
            Draw the shop in 2D to see it here.
          </p>
          <UButton
            label="Edit in 2D"
            icon="i-lucide-layout-dashboard"
            @click="view = 'design'"
          />
        </div>
        <BuildingView3D
          v-else
          v-model:selected-table="selectedTable"
          v-model:selected-item="selectedItem"
          v-model:scene="scene"
          :layout="layout"
          :tables="editor.tables.value"
          :looks="editor.looks.value"
          :item-looks="editor.itemLooks.value"
          :dining-tables="tables ?? []"
          :unsaved="isDirty"
          :branch-id="id"
          @show-on-plan="showOnPlan"
          @show-item-on-plan="showItemOnPlan"
          @design-shop="view = 'design'"
        />
      </div>
    </template>
    <AppModal
      v-model:open="exitOpen"
      title="Unsaved changes"
      description="Save your layout before leaving Studio?"
    >
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Keep editing"
            color="neutral"
            variant="ghost"
            @click="exitOpen = false"
          />
          <UButton
            label="Discard and leave"
            color="error"
            variant="outline"
            :disabled="saving"
            @click="leave(false)"
          />
          <UButton
            label="Save and leave"
            :loading="saving"
            @click="leave(true)"
          />
        </div>
      </template>
    </AppModal>
  </div>
</template>
