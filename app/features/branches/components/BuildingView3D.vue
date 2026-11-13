<script setup lang="ts">
/**
 * View in 3D (D273, frames 4–5, 6D, 9F; the owner's visual target): the layout as a building to
 * orbit, cut away and enter. It draws the layout being edited, so `unsaved` says when that is more
 * than what's saved. three.js loads only when this view opens; the floor and table lists show at
 * once and keep working if 3D can't. A lost graphics context (a phone that put the tab to sleep)
 * shows the same message, with Try again.
 */
import type { DiningTable } from '#shared/contracts/branches'
import { isFigureKind, isItemLookKind } from '#shared/contracts/shop-layout'
import type { ItemLook, LayoutTable, ScenePreset, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { createReusableTemplate, useClipboard } from '@vueuse/core'
import { findItemLook, findLook, ITEM_SPECS, pieceHeight, SCENE_CARDS, sceneCard } from '../designer/catalog'
import { formatReport, summarizeFrames } from '../designer/benchmark'
import type { BuildingNavigation, BuildingViewer } from '../designer/scene/building-viewer'
import type { StageStats } from '../designer/scene/stage'
import BuildingNavigator from './BuildingNavigator.vue'
import TableQrModal from './TableQrModal.vue'
import { STUDIO_SIDEBAR } from './studio'

const props = defineProps<{
  layout: ShopLayout
  tables: readonly LayoutTable[]
  looks: readonly TableLook[]
  /** The cafe's chair and fixture looks (step 3d): pieces with one take its finishes. */
  itemLooks?: readonly ItemLook[]
  /** The branch's tables with their QR codes, for the table card's View QR. */
  diningTables: readonly DiningTable[]
  /** The layout shown has changes that aren't saved yet. */
  unsaved?: boolean
  /** Seeds the surroundings, so everyone who opens this branch sees the same street (step 3h). */
  branchId: string
  /** The sidebar's width in px, as last resized in 2D (D277). */
  sidebarWidth?: number
}>()

const emit = defineEmits<{
  showOnPlan: [tableId: string]
  /** A piece's Show on plan (step 3e). */
  showItemOnPlan: [itemId: string]
  designShop: []
}>()

const selectedTable = defineModel<string | null>('selectedTable', { default: null })
/** A piece picked in 3D or selected in Design shop (step 3e). One of the two at a time. */
const selectedItem = defineModel<string | null>('selectedItem', { default: null })
/** The branch's scene in the draft (step 4a): choosing one here is a layout change, saved with it. */
const scene = defineModel<ScenePreset>('scene', { default: 'none' })
/** The left sidebar on a wide screen (Studio owns it, so 2D keeps the same choice, D277). */
const sidebarOpen = defineModel<boolean>('sidebar', { default: true })
defineSlots<{
  /** Studio's header at the top of the sidebar. `collapsible`: it may offer Hide sidebar. */
  'sidebar-header'?: (props: { collapsible: boolean }) => unknown
  /** Studio's actions at the view's top right (Save layout). */
  'actions'?: () => unknown
  /** Studio's toolbar at the bottom, given this viewer's zoom and fit. */
  'toolbar'?: (props: { zoom: (direction: 1 | -1) => void, fit: () => Promise<void>, canFit: boolean, fitLabel: string }) => unknown
}>()

const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const labels = useTemplateRef<HTMLDivElement>('labels')
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')
/** The building's first frame is on screen: until then the loading state stays. */
const drawn = ref(false)
const navigation = shallowRef<BuildingNavigation>({ mode: 'exterior' })
const mode = computed(() => navigation.value.mode)
const focusedFloor = ref<string | null>(null)
const insideFloor = computed(() => navigation.value.mode === 'inside' ? navigation.value.floorId : null)
const viewpoint = computed(() => navigation.value.mode === 'inside' ? navigation.value.viewpointId : null)
const viewpoints = computed(() => navigation.value.mode === 'inside' ? navigation.value.viewpoints : [])
const canEnter = computed(() => status.value === 'ready' && drawn.value)
const stats = ref<StageStats | null>(null)
const listsOpen = ref(false)
const navigatorSection = ref<'floors' | 'tables'>('floors')
/** People and pets (step 3g): this viewer's own choice, never saved. */
const hasFigures = computed(() => props.layout.floors.some(floor => floor.items.some(item => isFigureKind(item.kind))))
const showFigures = ref(true)
const animate = ref(true)
/** Animate starts off on a device measured slow, unless the person already chose. */
let animateChosen = false
/**
 * The surroundings (step 3h, D274) behind the scenes flag until the Neighborhood lane passes on a
 * real phone and desktop. The scene is the branch's (saved with the layout, step 4a); Show
 * surroundings, Show people and pets and Animate are this viewer's own, never saved.
 */
const scenesEnabled = useRuntimeConfig().public.shopDesignerScenes
const showSurroundings = ref(true)
const shownScene = computed<ScenePreset>(() => (scenesEnabled && showSurroundings.value ? scene.value : 'none'))
const sceneOpen = ref(false)
const { isCompact, isExpanded } = useLayoutContext()
const [DefineScenePanel, ReuseScenePanel] = createReusableTemplate()
const [DefineProperties, ReuseProperties] = createReusableTemplate()
const sceneItems = SCENE_CARDS.map(card => ({ value: card.preset, label: card.label, description: card.description, photo: card.photo }))
const route = useRoute()
const benchMode = computed(() => scenesEnabled && route.query.bench === 'orbit')
const benchPhase = ref<string | null>(null)
const benchReport = ref('')
const copyReport = useClipboard({ source: benchReport, copiedDuring: 2000 })
let openedAt = 0
let firstFrameMs: number | null = null
let viewer: BuildingViewer | null = null
let modeChange: Promise<void> | undefined
let revealRequest = 0
let startup = 0

const selected = computed(() => {
  const placement = props.layout.placements.find(candidate => candidate.tableId === selectedTable.value)
  const table = props.tables.find(candidate => candidate.id === selectedTable.value)
  const floor = props.layout.floors.find(candidate => candidate.id === placement?.floorId)
  if (!placement || !table || !floor) return null
  const details = props.diningTables.find(candidate => candidate.id === table.id)
  return { table, floor, placement, look: findLook(props.looks, placement.lookId), area: details?.area ?? null, qrUrl: details?.qrUrl ?? null }
})
/** The selected piece's card: its name, what it is, its size and floor, its picture. */
const selectedPiece = computed(() => {
  const id = selectedItem.value
  const floor = id ? props.layout.floors.find(candidate => candidate.items.some(item => item.id === id)) : undefined
  const item = floor?.items.find(candidate => candidate.id === id)
  if (!floor || !item) return null
  const spec = ITEM_SPECS[item.kind]
  const found = findItemLook(props.itemLooks ?? [], item.lookId)
  const look = found && found.kind === item.kind ? found : undefined
  const what = isFigureKind(item.kind) ? 'Decoration' : item.kind === 'stairs' ? 'Structure' : look ? spec.label : 'Furniture'
  const size = isFigureKind(item.kind)
    ? null
    : spec.footprint === 'round' && item.width === item.depth
      ? `Ø ${item.width} cm`
      : `${item.width} × ${item.depth}${isItemLookKind(item.kind) ? ` × ${pieceHeight(item)}` : ''} cm`
  return {
    item,
    floor,
    name: item.name ?? look?.name ?? spec.label,
    details: [what, size, isItemLookKind(item.kind) && spec.footprint === 'round' ? `${pieceHeight(item)} cm high` : null, `${floor.name} floor`].filter(Boolean).join(' · '),
    photo: look?.photo?.url ?? spec.photo,
  }
})
const insideName = computed(() => props.layout.floors.find(floor => floor.id === insideFloor.value)?.name)

function stopViewer() {
  startup++
  const previous = viewer
  viewer = null
  previous?.dispose()
  modeChange = undefined
  navigation.value = { mode: 'exterior' }
  focusedFloor.value = null
  drawn.value = false
  stats.value = null
}

function graphicsUnavailable() {
  stopViewer()
  status.value = 'unavailable'
}

/** Starts the 3D view on a fresh canvas: when the view opens, and again from Try again. */
async function start() {
  stopViewer()
  openedAt = performance.now()
  firstFrameMs = null
  const request = startup
  status.value = 'loading'
  // The canvas is drawn again after the unavailable message: wait for the new one.
  await nextTick()
  try {
    const { createBuildingViewer } = await import('../designer/scene/building-viewer')
    if (request !== startup || !canvas.value || !labels.value) return
    viewer = createBuildingViewer({
      canvas: canvas.value,
      labels: labels.value,
      dark: dark.value,
      onStats: (value) => {
        stats.value = value
        if (value.quality === 'low' && !animateChosen) animate.value = false
      },
      onFirstFrame: () => {
        drawn.value = true
        firstFrameMs ??= performance.now() - openedAt
      },
      onContextLost: graphicsUnavailable,
      onNavigationChange: next => (navigation.value = next),
      onSelectTable: id => (selectedTable.value = id),
      onSelectItem: id => (selectedItem.value = id),
      onSelectFloor: id => void focusFloor(id),
    })
    viewer.setPlayback({ figures: showFigures.value, animate: animate.value })
    if (scenesEnabled) viewer.setSurroundings(shownScene.value, props.branchId)
    viewer.setScene({ layout: props.layout, tables: props.tables, looks: props.looks, itemLooks: props.itemLooks })
    status.value = 'ready'
    // A table or piece picked in Design shop, or before Try again.
    if (selectedTable.value) void reveal({ kind: 'table', id: selectedTable.value })
    else if (selectedItem.value) void reveal({ kind: 'item', id: selectedItem.value })
  }
  catch (error) {
    if (request !== startup) return
    if (import.meta.dev) console.error('[shop designer] 3D view unavailable', error)
    graphicsUnavailable()
  }
}

onMounted(start)

onBeforeUnmount(stopViewer)

watch(() => [props.layout, props.tables, props.looks, props.itemLooks] as const, ([layout, tables, looks, itemLooks]) => {
  viewer?.setScene({ layout, tables, looks, itemLooks })
})
watch(dark, value => viewer?.setTheme(value))
watch([showFigures, animate], ([figures, animateValue]) => viewer?.setPlayback({ figures, animate: animateValue }))

watch(shownScene, value => viewer?.setSurroundings(value, props.branchId))

/** Runs the benchmark and shows its report, to copy into a message (step 3h). */
async function runBenchmark() {
  const current = viewer
  if (!current || benchPhase.value) return
  benchReport.value = ''
  benchPhase.value = 'Starting'
  const result = await current.benchmark(phase => (benchPhase.value = phase))
  benchPhase.value = null
  if (!result || current !== viewer) {
    benchReport.value = 'The benchmark stopped before it finished (the view changed). Run it again.'
    return
  }
  const { runs, details } = result
  benchReport.value = formatReport({
    runs: runs.map(summarizeFrames),
    all: summarizeFrames(runs.flat()),
    quality: stats.value?.quality ?? 'not measured',
    pixelRatio: details.pixelRatio,
    canvas: { width: details.width, height: details.height },
    renderer: details,
    surroundings: sceneCard(shownScene.value).label,
    firstFrameMs,
    userAgent: navigator.userAgent,
  })
}

function chooseAnimate(value: boolean) {
  animateChosen = true
  animate.value = value
}
watch(selectedTable, id => viewer?.selectTable(id))
watch(selectedItem, id => viewer?.selectItem(id))

function setMode(next: 'exterior' | 'cutaway') {
  modeChange = viewer?.setMode(next)
  return modeChange
}

async function focusFloor(floorId: string) {
  focusedFloor.value = floorId
  const current = viewer
  const transition = mode.value === 'exterior' ? setMode('cutaway') : modeChange
  await transition
  if (current === viewer && transition === modeChange && focusedFloor.value === floorId) await current?.focusFloor(floorId)
}

function enterFloor(floorId: string, pointId?: string) {
  if (!canEnter.value) return
  navigatorSection.value = 'tables'
  listsOpen.value = false
  focusedFloor.value = floorId
  modeChange = viewer?.enterFloor(floorId, pointId)
  return modeChange
}

function leaveFloor() {
  modeChange = viewer?.leaveFloor()
}

const overlay = useOverlay()
const qrModal = overlay.create(TableQrModal)
function viewQr() {
  const table = props.diningTables.find(candidate => candidate.id === selected.value?.table.id)
  if (table?.qrUrl) qrModal.open({ table: { ...table, qrUrl: table.qrUrl } })
}

async function fit() {
  const current = viewer
  const transition = modeChange
  await transition
  if (viewer === current && transition === modeChange) await current?.fit()
}
const zoom = (direction: 1 | -1) => viewer?.zoom(direction)

/**
 * Brings a table or a piece into view: on another floor when inside one, and in the cutaway when
 * the exterior hides it (under a roof or another floor), where only its label would show.
 */
async function reveal(target: { kind: 'table' | 'item', id: string }) {
  const request = ++revealRequest
  const current = viewer
  const floorId = target.kind === 'table'
    ? props.layout.placements.find(candidate => candidate.tableId === target.id)?.floorId
    : props.layout.floors.find(floor => floor.items.some(item => item.id === target.id))?.id
  if (!floorId) return
  const index = props.layout.floors.findIndex(floor => floor.id === floorId)
  const covered = index < props.layout.floors.length - 1 || !!props.layout.floors[index]?.hasRoof
  if (insideFloor.value && floorId !== insideFloor.value) enterFloor(floorId)
  else if (mode.value === 'exterior' && covered) setMode('cutaway')
  const transition = modeChange
  await transition
  const still = target.kind === 'table' ? selectedTable.value === target.id : selectedItem.value === target.id
  if (request === revealRequest && current === viewer && transition === modeChange && still) {
    if (target.kind === 'table') current?.selectTable(target.id, { focus: true })
    else current?.selectItem(target.id, { focus: true })
  }
}

function selectFromList(tableId: string) {
  listsOpen.value = false
  selectedTable.value = tableId
  void reveal({ kind: 'table', id: tableId })
}
</script>

<template>
  <!-- The Scene panel (step 4a): the branch's scene, then this viewer's own playback. -->
  <DefineScenePanel>
    <div class="flex flex-col gap-5">
      <URadioGroup
        v-model="scene"
        :items="sceneItems"
        variant="card"
        legend="Surroundings"
        :ui="{ fieldset: 'gap-2', legend: 'mb-1 text-sm font-semibold text-highlighted', item: 'items-start', wrapper: 'min-w-0' }"
        data-testid="scene-cards"
      >
        <template #label="{ item }">
          <img
            :src="item.photo"
            alt=""
            class="mb-2 block aspect-4/3 w-full rounded-md bg-muted object-cover"
          >
          <span class="font-medium text-highlighted">{{ item.label }}</span>
        </template>
      </URadioGroup>
      <p class="text-xs text-muted">
        Saved with the layout: everyone who opens this branch sees it.
      </p>
      <div class="flex flex-col gap-3 border-t border-default pt-4">
        <p class="text-sm font-semibold text-highlighted">
          On this device
        </p>
        <USwitch
          v-model="showSurroundings"
          label="Show surroundings"
          :disabled="scene === 'none'"
        />
        <USwitch
          v-model="showFigures"
          label="Show people and pets"
        />
        <USwitch
          :model-value="animate"
          label="Animate"
          :disabled="!showFigures"
          @update:model-value="chooseAnimate"
        />
      </div>
    </div>
  </DefineScenePanel>

  <DefineProperties>
    <!-- The selected table: at the top right on a wide screen, above the toolbar on a phone.
         Shown without 3D too: the lists still find a table, its QR code and its place on the plan. -->
    <div
      v-if="selected"
      class="p-3"
      data-testid="table-card"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-lg font-semibold text-highlighted">
            {{ selected.table.label }}
          </p>
          <p class="text-sm text-muted">
            {{ [selected.area, `${selected.table.seats} ${selected.table.seats === 1 ? 'seat' : 'seats'}`, `${selected.floor.name} floor`].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Clear selection"
          @click="selectedTable = null"
        />
      </div>
      <p class="mt-2 text-sm tabular-nums text-muted">
        {{ selected.placement.width }} × {{ selected.placement.depth }} cm · {{ selected.placement.rotation }}°
      </p>
      <!-- A custom look's photo of the real piece (step 3b). -->
      <div
        v-if="selected.look.photo"
        class="mt-3 flex items-center gap-2"
      >
        <img
          :src="selected.look.photo.url"
          :alt="`Photo of ${selected.look.name}`"
          class="aspect-4/3 w-14 shrink-0 rounded-md bg-muted object-cover"
          data-testid="table-card-photo"
        >
        <span class="min-w-0 text-sm break-words text-toned">{{ selected.look.name }}</span>
      </div>
      <div class="mt-3 flex gap-2">
        <UButton
          label="View QR"
          icon="i-lucide-qr-code"
          size="sm"
          :disabled="!selected.qrUrl"
          @click="viewQr"
        />
        <UButton
          label="Edit in 2D"
          icon="i-lucide-layout-dashboard"
          color="neutral"
          variant="outline"
          size="sm"
          @click="emit('showOnPlan', selected.table.id)"
        />
      </div>
    </div>

    <!-- A selected piece (step 3e): picked in 3D or in Design shop. Where the table card goes. -->
    <div
      v-else-if="selectedPiece"
      class="p-3"
      data-testid="piece-card"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex min-w-0 items-start gap-2">
          <img
            v-if="selectedPiece.photo"
            :src="selectedPiece.photo"
            :alt="`Picture of ${selectedPiece.name}`"
            class="aspect-4/3 w-14 shrink-0 rounded-md bg-muted object-cover"
          >
          <div class="min-w-0">
            <p class="text-lg font-semibold break-words text-highlighted">
              {{ selectedPiece.name }}
            </p>
            <p class="text-sm text-muted">
              {{ selectedPiece.details }}
            </p>
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Clear selection"
          @click="selectedItem = null"
        />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton
          label="Edit in 2D"
          icon="i-lucide-layout-dashboard"
          color="neutral"
          variant="outline"
          size="sm"
          @click="emit('showItemOnPlan', selectedPiece.item.id)"
        />
      </div>
    </div>
  </DefineProperties>

  <div class="flex h-full min-h-0">
    <aside
      v-if="sidebarOpen"
      aria-label="Navigate the building"
      class="hidden shrink-0 flex-col border-r border-default bg-default lg:flex"
      :style="{ width: `${sidebarWidth ?? STUDIO_SIDEBAR.initial}px` }"
    >
      <slot
        name="sidebar-header"
        :collapsible="true"
      />
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <UFieldGroup
          class="mb-3"
          aria-label="Building panels"
        >
          <UButton
            label="Floors"
            icon="i-lucide-layers"
            :variant="navigatorSection === 'floors' ? 'soft' : 'ghost'"
            :aria-pressed="navigatorSection === 'floors'"
            @click="navigatorSection = 'floors'"
          />
          <UButton
            label="Tables"
            icon="i-lucide-table-2"
            :variant="navigatorSection === 'tables' ? 'soft' : 'ghost'"
            :aria-pressed="navigatorSection === 'tables'"
            @click="navigatorSection = 'tables'"
          />
        </UFieldGroup>
        <BuildingNavigator
          :section="navigatorSection"
          :layout="layout"
          :tables="tables"
          :focused-floor="focusedFloor"
          :inside-floor="insideFloor"
          :selected-table="selectedTable"
          :can-enter="canEnter"
          @focus-floor="focusFloor"
          @enter-floor="enterFloor"
          @select-table="selectFromList"
        />
      </div>
    </aside>

    <main
      aria-label="3D view"
      class="relative min-w-0 flex-1 overflow-hidden bg-muted"
    >
      <div
        v-if="status === 'unavailable'"
        class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        role="status"
      >
        <UIcon
          name="i-lucide-box"
          class="size-8 text-muted"
        />
        <p class="text-base font-semibold text-highlighted">
          3D view is not available here
        </p>
        <p class="max-w-sm text-sm text-muted">
          This browser or device can’t show 3D graphics. Your layout and tables are fine; you can keep working with the lists or the floor plan.
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <UButton
            label="Floors and tables"
            icon="i-lucide-list"
            color="neutral"
            variant="outline"
            class="lg:hidden"
            @click="listsOpen = true"
          />
          <UButton
            label="Try again"
            icon="i-lucide-rotate-cw"
            @click="start"
          />
          <UButton
            label="Design shop"
            icon="i-lucide-layout-dashboard"
            color="neutral"
            variant="outline"
            @click="emit('designShop')"
          />
        </div>
      </div>
      <template v-else>
        <canvas
          ref="canvas"
          class="block size-full touch-none"
          aria-hidden="true"
          data-testid="building-canvas"
          :data-drawn="drawn"
        />
        <!-- Its own stacking context: CSS2DRenderer gives each label a z-index by distance, which
             otherwise drew floor names over the cards and controls laid on top of the view. -->
        <div
          ref="labels"
          class="pointer-events-none absolute inset-0 isolate"
        />

        <div
          v-if="status === 'loading' || !drawn"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted"
          role="status"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-cuboid"
            class="size-10 animate-pulse text-dimmed"
          />
          <p class="text-sm font-semibold text-highlighted">
            Loading the 3D view…
          </p>
          <p class="max-w-56 text-center text-xs text-muted">
            The floor and table lists already work.
          </p>
        </div>

        <div class="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              label="Floors and tables"
              icon="i-lucide-list"
              color="neutral"
              variant="outline"
              class="bg-default lg:hidden"
              @click="listsOpen = true"
            />
            <UTooltip
              v-if="isExpanded && !sidebarOpen"
              text="Show sidebar"
            >
              <UButton
                icon="i-lucide-panel-left-open"
                color="neutral"
                variant="outline"
                class="bg-default"
                aria-label="Show sidebar"
                @click="sidebarOpen = true"
              />
            </UTooltip>
            <UButton
              v-if="mode === 'inside'"
              label="Back to building"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="outline"
              class="bg-default"
              @click="leaveFloor"
            />
            <UFieldGroup
              v-else
              class="rounded-md bg-default"
            >
              <UButton
                label="Exterior"
                icon="i-lucide-house"
                :color="mode === 'exterior' ? 'primary' : 'neutral'"
                :variant="mode === 'exterior' ? 'soft' : 'outline'"
                :aria-pressed="mode === 'exterior'"
                @click="setMode('exterior')"
              />
              <UButton
                label="Cutaway"
                icon="i-lucide-scissors"
                :color="mode === 'cutaway' ? 'primary' : 'neutral'"
                :variant="mode === 'cutaway' ? 'soft' : 'outline'"
                :aria-pressed="mode === 'cutaway'"
                @click="setMode('cutaway')"
              />
            </UFieldGroup>
            <span
              v-if="insideName"
              class="rounded-md bg-default/80 px-2 py-1 text-sm font-medium text-highlighted"
            >{{ insideName }} floor</span>
            <UBadge
              v-if="unsaved"
              label="Unsaved changes shown"
              icon="i-lucide-pencil-line"
              color="warning"
              variant="subtle"
              class="bg-default"
              data-testid="building-unsaved"
            />
          </div>
          <div class="flex shrink-0 items-start gap-2">
            <UButton
              v-if="scenesEnabled"
              label="Scene"
              icon="i-lucide-trees"
              color="neutral"
              :variant="sceneOpen ? 'soft' : 'outline'"
              class="bg-default"
              :aria-expanded="sceneOpen"
              :ui="{ label: 'max-sm:sr-only' }"
              data-testid="scene-button"
              @click="sceneOpen = !sceneOpen"
            />
            <UPopover
              v-else-if="hasFigures"
              :content="{ align: 'end' }"
            >
              <UButton
                label="People and pets"
                icon="i-lucide-person-standing"
                color="neutral"
                variant="outline"
                class="bg-default"
                :ui="{ label: 'max-sm:sr-only' }"
                data-testid="figure-playback"
              />
              <template #content>
                <div class="flex flex-col gap-3 p-3">
                  <USwitch
                    v-model="showFigures"
                    label="Show people and pets"
                  />
                  <USwitch
                    :model-value="animate"
                    label="Animate"
                    :disabled="!showFigures"
                    @update:model-value="chooseAnimate"
                  />
                </div>
              </template>
            </UPopover>
            <slot name="actions" />
          </div>
        </div>

        <!-- The benchmark (step 3h, ?bench=orbit while the scenes flag is on): internal. -->
        <div
          v-if="benchMode"
          class="absolute bottom-16 left-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-md border border-default bg-default p-3 text-sm shadow-md"
          data-testid="benchmark"
        >
          <p class="font-semibold text-highlighted">
            Benchmark (internal)
          </p>
          <p class="text-xs text-muted">
            A 5 s warm-up, then three 20 s orbits. Keep this tab in front and don't touch the view.
          </p>
          <UButton
            :label="benchPhase ?? 'Run benchmark'"
            :loading="!!benchPhase"
            :disabled="!canEnter || !!benchPhase"
            icon="i-lucide-gauge"
            class="self-start"
            @click="runBenchmark"
          />
          <template v-if="benchReport">
            <pre
              class="max-h-48 overflow-auto rounded-md bg-elevated p-2 text-xs whitespace-pre-wrap"
              data-testid="benchmark-report"
            >{{ benchReport }}</pre>
            <UButton
              :label="copyReport.copied.value ? 'Copied' : 'Copy report'"
              icon="i-lucide-copy"
              color="neutral"
              variant="outline"
              size="sm"
              class="self-start"
              @click="copyReport.copy()"
            />
          </template>
        </div>

        <div class="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-center gap-2 sm:bottom-3">
          <UFieldGroup
            v-if="mode === 'inside'"
            class="pointer-events-auto rounded-md bg-default"
          >
            <UButton
              v-for="point in viewpoints"
              :key="point.id"
              :label="point.label"
              :color="point.id === viewpoint ? 'primary' : 'neutral'"
              :variant="point.id === viewpoint ? 'soft' : 'outline'"
              :aria-pressed="point.id === viewpoint"
              @click="enterFloor(insideFloor!, point.id)"
            />
          </UFieldGroup>
          <div class="flex flex-wrap justify-center gap-2 text-xs text-muted">
            <span
              v-if="stats"
              class="rounded-md bg-default/80 px-2 py-1 tabular-nums"
              data-testid="quality"
            >Quality {{ stats.quality }} · {{ stats.frameMs }} ms a frame</span>
            <span
              v-if="mode === 'inside'"
              class="rounded-md bg-default/80 px-2 py-1"
            >Drag to look around</span>
            <span
              v-else
              class="hidden rounded-md bg-default/80 px-2 py-1 sm:inline"
            >Drag to rotate · Scroll or pinch to zoom · Tap a table</span>
          </div>
          <slot
            name="toolbar"
            :zoom="zoom"
            :fit="fit"
            :can-fit="mode !== 'inside'"
            :fit-label="shownScene === 'none' ? 'Fit building' : 'Fit scene'"
          />
        </div>
      </template>

      <div
        v-if="!isExpanded && (selected || selectedPiece)"
        class="absolute inset-x-3 bottom-36 rounded-lg border border-default bg-default shadow-lg sm:inset-x-auto sm:top-16 sm:right-3 sm:bottom-auto sm:w-64"
      >
        <ReuseProperties />
      </div>
    </main>

    <aside
      v-if="scenesEnabled && sceneOpen && isExpanded"
      aria-label="Scene"
      class="w-60 shrink-0 overflow-y-auto border-l border-default bg-default p-3 xl:w-72"
    >
      <div class="mb-4 flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold text-highlighted">
          Scene
        </h2>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Close scene panel"
          @click="sceneOpen = false"
        />
      </div>
      <ReuseScenePanel />
      <ReuseProperties />
    </aside>
    <aside
      v-else-if="isExpanded"
      aria-label="Properties"
      class="w-60 shrink-0 overflow-y-auto border-l border-default bg-default xl:w-72"
    >
      <h2 class="border-b border-default p-3 text-sm font-semibold text-highlighted">
        Properties
      </h2>
      <ReuseProperties />
      <p
        v-if="!selected && !selectedPiece"
        class="p-3 text-sm text-muted"
      >
        Select a table or piece in the scene to inspect it.
      </p>
    </aside>
    <AppSlideover
      v-if="scenesEnabled"
      :open="sceneOpen && !isExpanded && !isCompact"
      title="Scene"
      @update:open="sceneOpen = $event"
    >
      <template #body>
        <ReuseScenePanel />
      </template>
    </AppSlideover>

    <AppDrawer
      v-if="scenesEnabled && isCompact"
      v-model:open="sceneOpen"
      title="Scene"
    >
      <template #body>
        <ReuseScenePanel />
      </template>
    </AppDrawer>

    <AppDrawer
      v-model:open="listsOpen"
      title="Floors and tables"
    >
      <template #body>
        <slot
          name="sidebar-header"
          :collapsible="false"
        />
        <BuildingNavigator
          :layout="layout"
          :tables="tables"
          :focused-floor="focusedFloor"
          :inside-floor="insideFloor"
          :selected-table="selectedTable"
          :can-enter="canEnter"
          @focus-floor="focusFloor"
          @enter-floor="enterFloor"
          @select-table="selectFromList"
        />
      </template>
    </AppDrawer>
  </div>
</template>
