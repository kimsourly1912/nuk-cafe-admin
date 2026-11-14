<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import { NO_SCENE } from '#shared/contracts/shop-layout'
import type { ScenePreset } from '#shared/contracts/shop-layout'
import { SupportBanner } from '~/features/support'
import { useBranchSettings, useBranchTables } from '../composables/useBranches'
import { useLayoutEditor } from '../composables/useLayoutEditor'
import BuildingView3D from './BuildingView3D.vue'
import DesignShopEditor from './DesignShopEditor.vue'
import LayoutHistory from './LayoutHistory.vue'
import LayoutSaveAlerts from './LayoutSaveAlerts.vue'
import StudioToolbar from './StudioToolbar.vue'
import { STUDIO_SIDEBAR } from './studio'

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
/**
 * 2D mounts the first time it is shown, then stays mounted (`v-show`) so its pan, zoom and tools
 * survive 3D. Its sidebar splitter needs a real width to start: mounted hidden, it had none (D277).
 */
const designMounted = ref(view.value === 'design')
/**
 * 3D the same (ISS-041): mounted the first time it is shown, then kept, so switching back is
 * instant and keeps the camera. Hidden, it draws nothing and waits to rebuild until shown.
 */
const threeMounted = ref(view.value === '3d')
watch(view, (current) => {
  if (current === 'design') designMounted.value = true
  if (current === '3d') threeMounted.value = true
})
editor.load()
const layout = editor.draft.layout
const hasOutline = computed(() => layout.value.floors.some(floor => floor.outline.length >= 3))
const explore = useRuntimeConfig().public.explore
const publishes = computed(() => explore && hasPin.value && (layout.value.scene?.explore || editor.query.data.value?.scene?.explore))
const exitOpen = ref(false)
const title = computed(() => cafe.name.value ? `${cafe.name.value} Studio` : 'Studio')
/** The left sidebar on a wide screen (D277). Kept across 2D and 3D. Hiding it keeps the canvas as it is. */
const sidebarOpen = ref(true)
const sidebarWidth = ref<number>(STUDIO_SIDEBAR.initial)
/** The version history panel (ISS-027). */
const historyOpen = ref(false)
const saveStatus = computed(() => saving.value ? 'Saving…' : isDirty.value ? 'Unsaved changes' : ready.value ? 'Saved' : '')
const [DefineHeader, ReuseHeader] = createReusableTemplate<{ collapsible?: boolean }>()
const [DefineSave, ReuseSave] = createReusableTemplate()
// Undo and redo from the keyboard in both views (D277): they share the draft and the toolbar.
defineShortcuts({
  meta_z: () => editor.draft.undo(),
  meta_shift_z: () => editor.draft.redo(),
  meta_y: () => editor.draft.redo(),
})

function exit() {
  if (isDirty.value) exitOpen.value = true
  else void navigateTo(backTo.value)
}
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
  <!-- The sidebar's header (D277): Back, the cafe's Studio and the branch, the color mode and Hide sidebar. -->
  <DefineHeader v-slot="{ collapsible }">
    <div class="flex shrink-0 items-center gap-2 border-b border-default p-2">
      <UTooltip text="Back to admin">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to admin"
          @click="exit()"
        />
      </UTooltip>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted">
          {{ title }}
        </p>
        <p class="truncate text-xs text-muted">
          {{ settings?.name }}
        </p>
      </div>
      <UColorModeButton />
      <UTooltip
        v-if="collapsible"
        text="Hide sidebar"
      >
        <UButton
          icon="i-lucide-panel-left-close"
          color="neutral"
          variant="ghost"
          aria-label="Hide sidebar"
          @click="sidebarOpen = false"
        />
      </UTooltip>
    </div>
  </DefineHeader>
  <!-- Saving (ISS-027, like Figma): the layout saves itself; Save layout saves at once; History
       restores a kept version. On the canvas in both views. Saving also updates Explore. -->
  <DefineSave>
    <div class="pointer-events-auto flex items-center gap-2 rounded-lg border border-default bg-default p-1 shadow-sm">
      <UTooltip text="Version history">
        <UButton
          icon="i-lucide-history"
          color="neutral"
          variant="ghost"
          aria-label="Version history"
          :disabled="!ready"
          @click="historyOpen = true"
        />
      </UTooltip>
      <span
        v-if="saveStatus"
        class="pl-2 text-xs text-muted max-sm:sr-only"
        role="status"
        :data-testid="isDirty ? 'layout-unsaved' : undefined"
      >{{ saveStatus }}</span>
      <UButton
        label="Save layout"
        :disabled="!ready || !isDirty"
        :loading="saving"
        @click="editor.save()"
      />
    </div>
  </DefineSave>

  <div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-default">
    <h1 class="sr-only">
      {{ title }}<template v-if="settings?.name">
        · {{ settings.name }}
      </template>
    </h1>
    <SupportBanner />
    <template v-if="error">
      <ReuseHeader />
      <ApiErrorAlert
        :error="error"
        title="Could not load the branch"
        class="m-3"
        @retry="refresh()"
      />
    </template>
    <template v-else>
      <LayoutSaveAlerts
        :editor="editor"
        :dining-tables="tables ?? []"
      />
      <LayoutHistory
        v-model:open="historyOpen"
        :editor="editor"
        :branch-id="props.id"
      />
      <p
        v-if="publishes && isDirty"
        class="border-b border-default px-3 py-1 text-xs text-muted"
        role="status"
      >
        Saving can update the customer-facing Explore layout.
      </p>
      <div
        v-if="designMounted"
        v-show="view === 'design'"
        class="min-h-0 flex-1"
      >
        <DesignShopEditor
          v-model:view="view"
          v-model:sidebar="sidebarOpen"
          v-model:sidebar-width="sidebarWidth"
          :editor="editor"
          :branch-id="id"
          :has-pin="hasPin"
          :dining-tables="tables ?? []"
          :looks="editor.looks.value"
          :active="view === 'design'"
        >
          <template #sidebar-header="{ collapsible }">
            <ReuseHeader :collapsible="collapsible" />
          </template>
          <template #actions>
            <ReuseSave />
          </template>
        </DesignShopEditor>
      </div>
      <div
        v-if="threeMounted"
        v-show="view === '3d'"
        class="flex min-h-0 flex-1 flex-col"
      >
        <template v-if="editor.error.value || !ready || !hasOutline">
          <ReuseHeader />
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
            v-else
            class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
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
        </template>
        <BuildingView3D
          v-else
          v-model:selected-table="selectedTable"
          v-model:selected-item="selectedItem"
          v-model:scene="scene"
          v-model:sidebar="sidebarOpen"
          :sidebar-width="sidebarWidth"
          :layout="layout"
          :tables="editor.tables.value"
          :looks="editor.looks.value"
          :item-looks="editor.itemLooks.value"
          :dining-tables="tables ?? []"
          :unsaved="isDirty"
          :branch-id="id"
          :active="view === '3d'"
          @show-on-plan="showOnPlan"
          @show-item-on-plan="showItemOnPlan"
          @design-shop="view = 'design'"
        >
          <template #sidebar-header="{ collapsible }">
            <ReuseHeader :collapsible="collapsible" />
          </template>
          <template #actions>
            <ReuseSave />
          </template>
          <template #toolbar="{ zoom, fit, canFit, fitLabel }">
            <StudioToolbar
              v-model:view="view"
              :fit-label="fitLabel"
              :can-fit="canFit"
              :can-undo="editor.draft.canUndo.value"
              :can-redo="editor.draft.canRedo.value"
              @zoom="zoom"
              @fit="fit"
              @undo="editor.draft.undo()"
              @redo="editor.draft.redo()"
            />
          </template>
        </BuildingView3D>
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
