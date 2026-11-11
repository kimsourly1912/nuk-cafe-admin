<script setup lang="ts">
/**
 * View in 3D (D273, frames 4–5, 6D, 9F; the owner's visual target): the layout as a building to
 * orbit, cut away and enter. It draws the layout being edited, so `unsaved` says when that is more
 * than what's saved. three.js loads only when this view opens; the floor and table lists show at
 * once and keep working if 3D can't. A lost graphics context (a phone that put the tab to sleep)
 * shows the same message, with Try again.
 */
import type { DiningTable } from '#shared/contracts/branches'
import type { ItemLook, LayoutTable, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { findLook } from '../designer/catalog'
import type { Viewpoint } from '../designer/geometry'
import type { BuildingViewer } from '../designer/scene/building-viewer'
import type { StageStats } from '../designer/scene/stage'
import BuildingNavigator from './BuildingNavigator.vue'
import TableQrModal from './TableQrModal.vue'

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
}>()

const emit = defineEmits<{
  showOnPlan: [tableId: string]
  designShop: []
}>()

const selectedTable = defineModel<string | null>('selectedTable', { default: null })

const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const labels = useTemplateRef<HTMLDivElement>('labels')
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')
/** The building's first frame is on screen: until then the loading state stays. */
const drawn = ref(false)
const mode = ref<'exterior' | 'cutaway' | 'inside'>('exterior')
const focusedFloor = ref<string | null>(null)
const insideFloor = ref<string | null>(null)
const viewpoint = ref<string | null>(null)
const viewpoints = ref<Viewpoint[]>([])
const stats = ref<StageStats | null>(null)
const listsOpen = ref(false)
let viewer: BuildingViewer | null = null

const selected = computed(() => {
  const placement = props.layout.placements.find(candidate => candidate.tableId === selectedTable.value)
  const table = props.tables.find(candidate => candidate.id === selectedTable.value)
  const floor = props.layout.floors.find(candidate => candidate.id === placement?.floorId)
  if (!placement || !table || !floor) return null
  const details = props.diningTables.find(candidate => candidate.id === table.id)
  return { table, floor, look: findLook(props.looks, placement.lookId), area: details?.area ?? null, qrUrl: details?.qrUrl ?? null }
})
const insideName = computed(() => props.layout.floors.find(floor => floor.id === insideFloor.value)?.name)

/** Starts the 3D view on a fresh canvas: when the view opens, and again from Try again. */
async function start() {
  viewer?.dispose()
  viewer = null
  status.value = 'loading'
  drawn.value = false
  stats.value = null
  mode.value = 'exterior'
  focusedFloor.value = null
  insideFloor.value = null
  // The canvas is drawn again after the unavailable message: wait for the new one.
  await nextTick()
  try {
    const { createBuildingViewer } = await import('../designer/scene/building-viewer')
    if (!canvas.value || !labels.value) return
    viewer = createBuildingViewer({
      canvas: canvas.value,
      labels: labels.value,
      dark: dark.value,
      onStats: value => (stats.value = value),
      onFirstFrame: () => (drawn.value = true),
      onContextLost: () => (status.value = 'unavailable'),
      onSelectTable: id => (selectedTable.value = id),
      onSelectFloor: id => void focusFloor(id),
    })
    viewer.setScene({ layout: props.layout, tables: props.tables, looks: props.looks, itemLooks: props.itemLooks })
    status.value = 'ready'
    // A table picked in Design shop, or before Try again.
    if (selectedTable.value) void reveal(selectedTable.value)
  }
  catch (error) {
    if (import.meta.dev) console.error('[shop designer] 3D view unavailable', error)
    status.value = 'unavailable'
  }
}

onMounted(start)

onBeforeUnmount(() => {
  viewer?.dispose()
  viewer = null
})

watch(() => [props.layout, props.tables, props.looks, props.itemLooks] as const, ([layout, tables, looks, itemLooks]) => viewer?.setScene({ layout, tables, looks, itemLooks }))
watch(dark, value => viewer?.setTheme(value))
watch(selectedTable, id => viewer?.selectTable(id))

async function setMode(next: 'exterior' | 'cutaway') {
  insideFloor.value = null
  mode.value = next
  await viewer?.setMode(next)
}

async function focusFloor(floorId: string) {
  focusedFloor.value = floorId
  if (mode.value === 'exterior') await setMode('cutaway')
  await viewer?.focusFloor(floorId)
}

async function enterFloor(floorId: string, pointId?: string) {
  listsOpen.value = false
  mode.value = 'inside'
  insideFloor.value = floorId
  focusedFloor.value = floorId
  viewpoints.value = viewer?.viewpoints(floorId) ?? []
  viewpoint.value = pointId ?? viewpoints.value[0]?.id ?? null
  await viewer?.enterFloor(floorId, viewpoint.value ?? undefined)
}

async function leaveFloor() {
  insideFloor.value = null
  mode.value = 'cutaway'
  await viewer?.leaveFloor()
}

const overlay = useOverlay()
const qrModal = overlay.create(TableQrModal)
function viewQr() {
  const table = props.diningTables.find(candidate => candidate.id === selected.value?.table.id)
  if (table?.qrUrl) qrModal.open({ table: { ...table, qrUrl: table.qrUrl } })
}

const fit = () => viewer?.fit()
const zoom = (direction: 1 | -1) => viewer?.zoom(direction)

/**
 * Brings a table into view: on another floor when inside one, and in the cutaway when the
 * exterior hides it (under a roof or another floor), where only its label would show.
 */
async function reveal(tableId: string) {
  const placement = props.layout.placements.find(candidate => candidate.tableId === tableId)
  if (!placement) return
  const index = props.layout.floors.findIndex(floor => floor.id === placement.floorId)
  const covered = index < props.layout.floors.length - 1 || !!props.layout.floors[index]?.hasRoof
  if (insideFloor.value) {
    if (placement.floorId !== insideFloor.value) await enterFloor(placement.floorId)
  }
  else if (mode.value === 'exterior' && covered) {
    await setMode('cutaway')
  }
  viewer?.selectTable(tableId, { focus: true })
}

function selectFromList(tableId: string) {
  listsOpen.value = false
  selectedTable.value = tableId
  void reveal(tableId)
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <aside
      aria-label="Navigate the building"
      class="hidden w-72 shrink-0 overflow-y-auto border-r border-default p-4 lg:block"
    >
      <BuildingNavigator
        :layout="layout"
        :tables="tables"
        :focused-floor="focusedFloor"
        :inside-floor="insideFloor"
        :selected-table="selectedTable"
        @focus-floor="focusFloor"
        @enter-floor="enterFloor"
        @select-table="selectFromList"
      />
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
        <div
          ref="labels"
          class="pointer-events-none absolute inset-0"
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
          <UButton
            v-if="mode !== 'inside'"
            label="Fit building"
            icon="i-lucide-maximize"
            color="neutral"
            variant="outline"
            class="bg-default"
            :ui="{ label: 'max-sm:sr-only' }"
            @click="fit"
          />
        </div>

        <div class="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <span
            v-if="stats"
            class="rounded-md bg-default/80 px-2 py-1 text-xs text-muted tabular-nums"
            data-testid="quality"
          >Quality {{ stats.quality }} · {{ stats.frameMs }} ms a frame</span>
          <span v-else />
          <div
            v-if="mode === 'inside'"
            class="flex flex-col items-center gap-2"
          >
            <UFieldGroup class="rounded-md bg-default">
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
            <span class="rounded-md bg-default/80 px-2 py-0.5 text-xs text-muted">Drag to look around</span>
          </div>
          <span
            v-else
            class="hidden rounded-md bg-default/80 px-2 py-1 text-xs text-muted sm:inline"
          >Drag to rotate · Scroll or pinch to zoom · Tap a table</span>
          <div class="flex flex-col gap-1">
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              class="bg-default"
              aria-label="Zoom in"
              @click="zoom(1)"
            />
            <UButton
              icon="i-lucide-minus"
              color="neutral"
              variant="outline"
              class="bg-default"
              aria-label="Zoom out"
              @click="zoom(-1)"
            />
          </div>
        </div>
      </template>

      <!-- The selected table: under Fit building on a wide screen, above the bottom bar on a phone.
           Shown without 3D too: the lists still find a table, its QR code and its place on the plan. -->
      <div
        v-if="selected"
        class="absolute inset-x-3 bottom-24 rounded-lg border border-default bg-default p-3 shadow-lg sm:inset-x-auto sm:top-16 sm:right-3 sm:bottom-auto sm:w-64"
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
            label="Show on plan"
            icon="i-lucide-layout-dashboard"
            color="neutral"
            variant="outline"
            size="sm"
            @click="emit('showOnPlan', selected.table.id)"
          />
        </div>
      </div>
    </main>

    <AppDrawer
      v-model:open="listsOpen"
      title="Floors and tables"
    >
      <template #body>
        <BuildingNavigator
          :layout="layout"
          :tables="tables"
          :focused-floor="focusedFloor"
          :inside-floor="insideFloor"
          :selected-table="selectedTable"
          @focus-floor="focusFloor"
          @enter-floor="enterFloor"
          @select-table="selectFromList"
        />
      </template>
    </AppDrawer>
  </div>
</template>
