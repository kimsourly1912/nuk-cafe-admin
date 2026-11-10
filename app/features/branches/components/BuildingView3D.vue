<script setup lang="ts">
/**
 * View in 3D (D273, frames 4–5, 6D, 9F; the owner's visual target): the saved layout as a building
 * to orbit, cut away and enter. three.js loads only when this view opens; the floor and table lists
 * show at once and keep working if 3D can't.
 */
import type { LayoutTable, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import type { Viewpoint } from '../designer/geometry'
import type { BuildingViewer } from '../designer/scene/building-viewer'
import type { StageStats } from '../designer/scene/stage'
import BuildingNavigator from './BuildingNavigator.vue'

const props = defineProps<{
  layout: ShopLayout
  tables: readonly LayoutTable[]
  looks: readonly TableLook[]
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
  return placement && table && floor ? { table, floor } : null
})
const insideName = computed(() => props.layout.floors.find(floor => floor.id === insideFloor.value)?.name)

onMounted(async () => {
  try {
    const { createBuildingViewer } = await import('../designer/scene/building-viewer')
    if (!canvas.value || !labels.value) return
    viewer = createBuildingViewer({
      canvas: canvas.value,
      labels: labels.value,
      dark: dark.value,
      onStats: value => (stats.value = value),
      onContextLost: () => (status.value = 'unavailable'),
      onSelectTable: id => (selectedTable.value = id),
      onSelectFloor: id => void focusFloor(id),
    })
    viewer.setScene({ layout: props.layout, tables: props.tables, looks: props.looks })
    if (selectedTable.value) viewer.selectTable(selectedTable.value)
    status.value = 'ready'
  }
  catch (error) {
    if (import.meta.dev) console.error('[shop designer] 3D view unavailable', error)
    status.value = 'unavailable'
  }
})

onBeforeUnmount(() => {
  viewer?.dispose()
  viewer = null
})

watch(() => [props.layout, props.tables, props.looks] as const, ([layout, tables, looks]) => viewer?.setScene({ layout, tables, looks }))
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

const fit = () => viewer?.fit()
const zoom = (direction: 1 | -1) => viewer?.zoom(direction)

function selectFromList(tableId: string) {
  listsOpen.value = false
  const placement = props.layout.placements.find(candidate => candidate.tableId === tableId)
  if (insideFloor.value && placement && placement.floorId !== insideFloor.value) void enterFloor(placement.floorId)
  selectedTable.value = tableId
  viewer?.selectTable(tableId, { focus: true })
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
        <UButton
          label="Design shop"
          icon="i-lucide-layout-dashboard"
          color="neutral"
          variant="outline"
          @click="emit('designShop')"
        />
      </div>
      <template v-else>
        <canvas
          ref="canvas"
          class="block size-full touch-none"
          aria-hidden="true"
          data-testid="building-canvas"
        />
        <div
          ref="labels"
          class="pointer-events-none absolute inset-0"
        />

        <div
          v-if="status === 'loading'"
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

        <!-- The selected table: under Fit building on a wide screen, above the bottom bar on a phone. -->
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
                {{ selected.table.seats }} seats · {{ selected.floor.name }} floor
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
          <div class="mt-3 flex gap-2">
            <UTooltip text="Demo table: no QR code">
              <UButton
                label="View QR"
                icon="i-lucide-qr-code"
                size="sm"
                disabled
              />
            </UTooltip>
            <UButton
              label="Show on plan"
              color="neutral"
              variant="outline"
              size="sm"
              @click="emit('showOnPlan', selected.table.id)"
            />
          </div>
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
