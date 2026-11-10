<script setup lang="ts">
/**
 * Design shop (D273, frames 1–3, 9): the library of unplaced tables and furniture, the floor plan,
 * and the panel for what's selected. Every change goes through the draft (one undo step each); the
 * prototype saves nothing. Pieces arrive by dragging from the library or with Place on map (then the
 * move pad), so the editor works without dragging on touch, with a keyboard and in the e2e tests.
 */
import type { Finish, ItemKind, LayoutTable, Point, TableLook } from '#shared/contracts/shop-layout'
import type { LayoutDraft } from '../composables/useLayoutDraft'
import type { ItemCategory } from '../designer/catalog'
import { FINISH_SWATCHES, findLook, ITEM_SPECS, itemFinish, NEW_TABLE_LOOK } from '../designer/catalog'
import { FINE_GRID_CM, GRID_CM, newLayoutId, normalizeRotation, outsideOutline, snap } from '../designer/geometry'
import type { PlanGhost, PlanSelection } from './FloorPlanCanvas.vue'
import FloorPlanCanvas from './FloorPlanCanvas.vue'

const props = defineProps<{
  draft: LayoutDraft
  tables: readonly LayoutTable[]
  looks: readonly TableLook[]
}>()

const emit = defineEmits<{ view3d: [] }>()

const floorId = defineModel<string>('floorId', { required: true })
const selection = defineModel<PlanSelection | null>('selection', { required: true })

const layout = computed(() => props.draft.layout.value)
const floor = computed(() => layout.value.floors.find(candidate => candidate.id === floorId.value) ?? layout.value.floors[0]!)
const floorIndex = computed(() => layout.value.floors.indexOf(floor.value))
const showBelow = ref(true)
const canvas = useTemplateRef('canvas')

const ITEM_ICONS: Record<ItemKind, string> = {
  'cafe-chair': 'i-lucide-armchair',
  'bentwood-chair': 'i-lucide-armchair',
  'bar-stool': 'i-lucide-circle-dot',
  'dining-bench': 'i-lucide-rectangle-horizontal',
  'service-counter': 'i-lucide-store',
  'display-shelf': 'i-lucide-library',
  'planter': 'i-lucide-sprout',
  'plant': 'i-lucide-flower-2',
  'room-divider': 'i-lucide-columns-3',
  'stairs': 'i-lucide-chevrons-up',
}
const CATEGORIES: { key: ItemCategory, label: string }[] = [
  { key: 'chairs', label: 'Extra seating' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'structure', label: 'Structure' },
]
const catalog = CATEGORIES.map(category => ({ ...category, specs: Object.values(ITEM_SPECS).filter(spec => spec.category === category.key) }))

const placedIds = computed(() => new Set(layout.value.placements.map(placement => placement.tableId)))
const unplaced = computed(() => props.tables.filter(table => !placedIds.value.has(table.id)))
const tablesOn = (id: string) => layout.value.placements.filter(placement => placement.floorId === id).length

const selectedPlacement = computed(() => selection.value?.kind === 'table' ? layout.value.placements.find(placement => placement.tableId === selection.value!.id) : undefined)
const selectedTable = computed(() => selectedPlacement.value && props.tables.find(table => table.id === selectedPlacement.value!.tableId))
const selectedItem = computed(() => selection.value?.kind === 'item' ? floor.value.items.find(item => item.id === selection.value!.id) : undefined)
const selectedLook = computed(() => selectedPlacement.value && findLook(props.looks, selectedPlacement.value.lookId))
const lookUsers = computed(() => {
  const placement = selectedPlacement.value
  if (!placement) return []
  return layout.value.placements
    .filter(other => other.lookId === placement.lookId && other.tableId !== placement.tableId)
    .map(other => props.tables.find(table => table.id === other.tableId)?.label)
    .filter(Boolean)
})
const lookItems = computed(() => props.looks.map(look => ({ label: look.name, value: look.id })))
const floorItems = computed(() => layout.value.floors.map(candidate => ({ label: candidate.name, value: candidate.id })))
const outsideLabels = computed(() => {
  const outside = outsideOutline(floor.value, layout.value.placements)
  return [
    ...layout.value.placements.filter(placement => outside.has(placement.tableId)).map(placement => ({ selection: { kind: 'table' as const, id: placement.tableId }, label: props.tables.find(table => table.id === placement.tableId)?.label ?? '' })),
    ...floor.value.items.filter(item => outside.has(item.id)).map(item => ({ selection: { kind: 'item' as const, id: item.id }, label: ITEM_SPECS[item.kind].label })),
  ]
})

// Changes, each one undo step.
function placeTable(tableId: string, at: Point) {
  const look = findLook(props.looks, NEW_TABLE_LOOK)
  props.draft.change((draft) => {
    draft.placements.push({ tableId, floorId: floor.value.id, x: snap(at.x), y: snap(at.y), rotation: 0, width: look.defaultWidth, depth: look.defaultDepth, lookId: look.id })
  })
  selection.value = { kind: 'table', id: tableId }
}

function placeItem(kind: ItemKind, at: Point) {
  const spec = ITEM_SPECS[kind]
  const id = newLayoutId('item')
  props.draft.change((draft) => {
    draft.floors.find(candidate => candidate.id === floor.value.id)!.items.push({ id, kind, x: snap(at.x), y: snap(at.y), rotation: 0, width: spec.width, depth: spec.depth, finishes: {} })
  })
  selection.value = { kind: 'item', id }
}

function updateTable(tableId: string, change: Partial<{ floorId: string, x: number, y: number, rotation: number, width: number, depth: number, lookId: string }>) {
  props.draft.change((draft) => {
    const placement = draft.placements.find(candidate => candidate.tableId === tableId)
    if (placement) Object.assign(placement, change)
  })
  if (change.floorId) floorId.value = change.floorId
}

function updateItem(itemId: string, change: Partial<{ x: number, y: number, rotation: number, width: number, depth: number, finishes: Partial<Record<string, Finish>> }>) {
  props.draft.change((draft) => {
    const item = draft.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === itemId)
    if (item) Object.assign(item, change)
  })
}

function move(target: PlanSelection, position: Point) {
  if (target.kind === 'table') updateTable(target.id, position)
  else updateItem(target.id, position)
}

function rotate(target: PlanSelection, rotation: number) {
  if (target.kind === 'table') updateTable(target.id, { rotation })
  else updateItem(target.id, { rotation })
}

/** A table leaves the map (back to Unplaced, its QR untouched); furniture is deleted. */
function remove(target: PlanSelection) {
  props.draft.change((draft) => {
    if (target.kind === 'table') draft.placements = draft.placements.filter(placement => placement.tableId !== target.id)
    else for (const candidate of draft.floors) candidate.items = candidate.items.filter(item => item.id !== target.id)
  })
  selection.value = null
}

function nudge(dx: number, dy: number) {
  const target = selection.value
  const current = selectedPlacement.value ?? selectedItem.value
  if (!target || !current) return
  move(target, { x: current.x + dx * step.value, y: current.y + dy * step.value })
}

function turn(degrees: number) {
  const target = selection.value
  const current = selectedPlacement.value ?? selectedItem.value
  if (target && current) rotate(target, normalizeRotation(current.rotation + degrees))
}

const step = ref(GRID_CM)

function placeInMiddle(piece: { kind: 'table', tableId: string } | { kind: 'item', itemKind: ItemKind }) {
  // A drag that ended back on its card also clicks it: that drag already placed (or cancelled).
  if (performance.now() < suppressClickUntil) return
  const at = canvas.value?.viewCenter() ?? { x: 0, y: 0 }
  if (piece.kind === 'table') placeTable(piece.tableId, at)
  else placeItem(piece.itemKind, at)
  canvas.value?.focus()
}

// Dragging from the library: past a few pixels it's a drag (a ghost follows over the plan, drop
// places); a press that doesn't move is a click and places in the middle.
const ghost = ref<PlanGhost | null>(null)
let suppressClickUntil = 0
let libraryDrag: { piece: { kind: 'table', tableId: string } | { kind: 'item', itemKind: ItemKind }, start: Point, dragging: boolean } | null = null

function startLibraryDrag(event: PointerEvent, piece: { kind: 'table', tableId: string } | { kind: 'item', itemKind: ItemKind }) {
  if (event.button !== 0) return
  libraryDrag = { piece, start: { x: event.clientX, y: event.clientY }, dragging: false }
  window.addEventListener('pointermove', onLibraryMove)
  window.addEventListener('pointerup', onLibraryUp, { once: true })
}

function onLibraryMove(event: PointerEvent) {
  if (!libraryDrag) return
  if (!libraryDrag.dragging && Math.hypot(event.clientX - libraryDrag.start.x, event.clientY - libraryDrag.start.y) < 6) return
  libraryDrag.dragging = true
  const at = canvas.value?.toPlan(event.clientX, event.clientY, true)
  const fine = event.shiftKey ? FINE_GRID_CM : GRID_CM
  ghost.value = at ? { ...libraryDrag.piece, x: snap(at.x, fine), y: snap(at.y, fine) } as PlanGhost : null
}

function onLibraryUp(event: PointerEvent) {
  window.removeEventListener('pointermove', onLibraryMove)
  const drag = libraryDrag
  const dropped = ghost.value
  libraryDrag = null
  ghost.value = null
  if (!drag) return
  // A press that didn't move is a click: the card's own button handles it, keyboard and pointer alike.
  if (!drag.dragging) return
  suppressClickUntil = performance.now() + 100
  event.preventDefault()
  if (!dropped) return
  if (drag.piece.kind === 'table') placeTable(drag.piece.tableId, dropped)
  else placeItem(drag.piece.itemKind, dropped)
}

onBeforeUnmount(() => window.removeEventListener('pointermove', onLibraryMove))

defineShortcuts({
  meta_z: () => props.draft.undo(),
  meta_shift_z: () => props.draft.redo(),
  meta_y: () => props.draft.redo(),
})

const position = computed(() => {
  const current = selectedPlacement.value ?? selectedItem.value
  return current ? `x ${(current.x / 100).toFixed(2)} m · y ${(current.y / 100).toFixed(2)} m` : ''
})

function setNumber(value: number | null | undefined, apply: (value: number) => void) {
  if (typeof value === 'number' && Number.isFinite(value)) apply(Math.round(value))
}

const swatch = (finish: Finish) => FINISH_SWATCHES[finish]
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- Library -->
    <aside
      aria-label="Library"
      class="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-default p-4 lg:flex"
    >
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-highlighted">
            Unplaced tables
          </h2>
          <UBadge
            :label="String(unplaced.length)"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
        <p class="text-xs text-muted">
          Real tables with a QR code that are not on the map yet.
        </p>
        <p
          v-if="!unplaced.length"
          class="text-sm text-muted"
        >
          Every table is on the map.
        </p>
        <div
          v-for="table in unplaced"
          :key="table.id"
          class="flex items-center gap-2 rounded-md border border-default py-1.5 pr-1.5 pl-1"
          :data-testid="`unplaced-${table.label}`"
        >
          <span
            class="flex cursor-grab touch-none items-center"
            aria-hidden="true"
            @pointerdown="startLibraryDrag($event, { kind: 'table', tableId: table.id })"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-4 text-dimmed"
            />
            <span class="ml-1 inline-flex h-6 w-11 items-center justify-center rounded-md border border-primary bg-primary/10 text-xs font-semibold text-highlighted">{{ table.label }}</span>
          </span>
          <span class="flex-1 text-sm text-muted">{{ table.seats }} seats</span>
          <UButton
            label="Place on map"
            size="xs"
            variant="ghost"
            @click="placeInMiddle({ kind: 'table', tableId: table.id })"
          />
        </div>
      </section>

      <USeparator />

      <section
        v-for="category in catalog"
        :key="category.key"
        class="flex flex-col gap-2"
      >
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          {{ category.label }}
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="spec in category.specs"
            :key="spec.kind"
            type="button"
            class="flex touch-none flex-col items-start gap-1 rounded-md border border-default p-2 text-left text-sm text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :data-testid="`catalog-${spec.kind}`"
            @pointerdown="startLibraryDrag($event, { kind: 'item', itemKind: spec.kind })"
            @click="placeInMiddle({ kind: 'item', itemKind: spec.kind })"
          >
            <UIcon
              :name="ITEM_ICONS[spec.kind]"
              class="size-5 text-muted"
            />
            <span>{{ spec.label }}</span>
            <span class="text-xs text-muted">{{ spec.footprint === 'round' ? `Ø ${spec.width} cm` : `${spec.width} × ${spec.depth}` }}</span>
          </button>
        </div>
      </section>
      <p class="text-xs text-muted">
        Drag onto the plan, or click to place it in the middle. A table’s chairs come from its seats.
      </p>
    </aside>

    <!-- The plan -->
    <main
      aria-label="Floor plan"
      class="relative min-w-0 flex-1 bg-muted"
    >
      <FloorPlanCanvas
        ref="canvas"
        :layout="layout"
        :floor-id="floor.id"
        :tables="tables"
        :looks="looks"
        :selection="selection"
        :ghost="ghost"
        :show-below="showBelow"
        @select="selection = $event"
        @move="move"
        @rotate="rotate"
        @remove="remove"
      />

      <div class="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div class="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-default bg-default p-1 shadow-sm">
          <UFieldGroup>
            <UButton
              v-for="candidate in layout.floors"
              :key="candidate.id"
              :label="candidate.name"
              :color="candidate.id === floor.id ? 'primary' : 'neutral'"
              :variant="candidate.id === floor.id ? 'soft' : 'ghost'"
              size="sm"
              :aria-pressed="candidate.id === floor.id"
              @click="floorId = candidate.id"
            >
              <template #trailing>
                <UBadge
                  :label="String(tablesOn(candidate.id))"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </template>
            </UButton>
          </UFieldGroup>
          <USwitch
            v-if="floorIndex > 0"
            v-model="showBelow"
            label="Floor below"
            size="sm"
            class="px-1"
          />
        </div>
        <div class="pointer-events-auto flex items-center gap-1 rounded-lg border border-default bg-default p-1 shadow-sm">
          <UTooltip
            text="Undo"
            :kbds="['meta', 'z']"
          >
            <UButton
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Undo"
              :disabled="!draft.canUndo.value"
              @click="draft.undo()"
            />
          </UTooltip>
          <UTooltip
            text="Redo"
            :kbds="['meta', 'shift', 'z']"
          >
            <UButton
              icon="i-lucide-redo-2"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Redo"
              :disabled="!draft.canRedo.value"
              @click="draft.redo()"
            />
          </UTooltip>
          <USeparator
            orientation="vertical"
            class="h-5"
          />
          <UButton
            icon="i-lucide-zoom-out"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Zoom out"
            @click="canvas?.zoom(-1)"
          />
          <UButton
            icon="i-lucide-zoom-in"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Zoom in"
            @click="canvas?.zoom(1)"
          />
          <UButton
            icon="i-lucide-scan"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Fit to screen"
            @click="canvas?.fit()"
          />
          <USeparator
            orientation="vertical"
            class="h-5"
          />
          <UButton
            label="View in 3D"
            icon="i-lucide-box"
            variant="soft"
            size="sm"
            @click="emit('view3d')"
          />
        </div>
      </div>

      <UAlert
        v-if="outsideLabels.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        class="absolute inset-x-3 top-16 w-auto max-w-xl"
        :title="`${outsideLabels.map(entry => entry.label).join(', ')} ${outsideLabels.length === 1 ? 'is' : 'are'} outside the ${floor.name} floor.`"
        description="Saving still works. Move it back in or remove it from the map."
        :actions="[{ label: 'Show', color: 'neutral', variant: 'outline', onClick: () => { selection = outsideLabels[0]!.selection } }]"
      />

      <!-- The move pad: no dragging needed (2C). -->
      <div
        v-if="selection"
        class="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-default bg-default p-2 shadow-md"
        role="group"
        aria-label="Move the selection"
      >
        <div class="grid grid-cols-3 gap-1">
          <span />
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="outline"
            :aria-label="`Move up ${step} cm`"
            @click="nudge(0, -1)"
          />
          <span />
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="outline"
            :aria-label="`Move left ${step} cm`"
            @click="nudge(-1, 0)"
          />
          <UButton
            icon="i-lucide-rotate-cw"
            variant="soft"
            aria-label="Turn 90°"
            @click="turn(90)"
          />
          <UButton
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="outline"
            :aria-label="`Move right ${step} cm`"
            @click="nudge(1, 0)"
          />
          <span />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="outline"
            :aria-label="`Move down ${step} cm`"
            @click="nudge(0, 1)"
          />
          <span />
        </div>
        <div class="flex flex-col gap-2 text-xs text-muted">
          <UFieldGroup size="xs">
            <UButton
              label="25 cm"
              :color="step === GRID_CM ? 'primary' : 'neutral'"
              :variant="step === GRID_CM ? 'soft' : 'outline'"
              :aria-pressed="step === GRID_CM"
              @click="step = GRID_CM"
            />
            <UButton
              label="5 cm"
              :color="step === FINE_GRID_CM ? 'primary' : 'neutral'"
              :variant="step === FINE_GRID_CM ? 'soft' : 'outline'"
              :aria-pressed="step === FINE_GRID_CM"
              @click="step = FINE_GRID_CM"
            />
          </UFieldGroup>
          <span class="tabular-nums">{{ position }}</span>
          <UButton
            label="Done"
            size="xs"
            @click="selection = null"
          />
        </div>
      </div>
      <p
        v-else
        class="absolute right-3 bottom-3 hidden rounded-md border border-default bg-default px-2 py-1 text-xs text-muted shadow-sm sm:block"
      >
        Drag empty space to pan · Scroll or pinch to zoom · R turns the selection
      </p>
    </main>

    <!-- What's selected -->
    <aside
      v-if="selectedPlacement && selectedTable && selectedLook"
      aria-label="Selected table"
      class="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-default p-4 md:flex"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-qr-code"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            {{ selectedTable.label }}
          </p>
          <p class="text-xs text-muted">
            Dining table · {{ floor.name }} floor
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null"
        />
      </div>
      <div class="flex items-center gap-3 rounded-md border border-default bg-elevated/50 px-3 py-2">
        <div class="flex-1">
          <p class="text-xs text-muted">
            Seats
          </p>
          <p class="font-semibold text-highlighted">
            {{ selectedTable.seats }}
          </p>
        </div>
        <UTooltip text="Step 2 opens the real table form">
          <UButton
            label="Edit table"
            color="neutral"
            variant="outline"
            size="sm"
            disabled
          />
        </UTooltip>
      </div>
      <p class="text-xs text-muted">
        Label and seats belong to the table. Everything below belongs to the layout.
      </p>
      <USeparator label="On the map" />
      <UFormField label="Floor">
        <USelect
          :model-value="selectedPlacement.floorId"
          :items="floorItems"
          class="w-full"
          @update:model-value="value => updateTable(selectedPlacement!.tableId, { floorId: String(value) })"
        />
      </UFormField>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Width (cm)">
          <UInputNumber
            :model-value="selectedPlacement.width"
            :min="40"
            :max="600"
            :step="5"
            @update:model-value="value => setNumber(value, width => updateTable(selectedPlacement!.tableId, { width, ...(selectedLook!.shape === 'round' ? { depth: width } : {}) }))"
          />
        </UFormField>
        <UFormField label="Depth (cm)">
          <UInputNumber
            :model-value="selectedPlacement.depth"
            :min="40"
            :max="600"
            :step="5"
            :disabled="selectedLook.shape === 'round'"
            @update:model-value="value => setNumber(value, depth => updateTable(selectedPlacement!.tableId, { depth }))"
          />
        </UFormField>
      </div>
      <UFormField label="Rotation (°)">
        <div class="flex gap-2">
          <UInputNumber
            :model-value="selectedPlacement.rotation"
            :min="0"
            :max="359"
            :step="15"
            class="flex-1"
            @update:model-value="value => setNumber(value, rotation => updateTable(selectedPlacement!.tableId, { rotation: normalizeRotation(rotation) }))"
          />
          <UButton
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            aria-label="Turn 90° left"
            @click="turn(-90)"
          />
          <UButton
            icon="i-lucide-rotate-cw"
            color="neutral"
            variant="outline"
            aria-label="Turn 90° right"
            @click="turn(90)"
          />
        </div>
      </UFormField>
      <UFormField
        label="Look"
        :help="lookUsers.length ? `Also used by ${lookUsers.join(', ')}. Editing a look changes every table that uses it.` : 'Only this table uses it.'"
      >
        <USelect
          :model-value="selectedPlacement.lookId"
          :items="lookItems"
          class="w-full"
          @update:model-value="value => { const look = findLook(looks, String(value)); updateTable(selectedPlacement!.tableId, { lookId: look.id, width: look.defaultWidth, depth: look.defaultDepth }) }"
        />
      </UFormField>
      <div class="mt-auto flex flex-col gap-2">
        <UTooltip text="Demo table: no QR code">
          <UButton
            label="View QR"
            icon="i-lucide-qr-code"
            color="neutral"
            variant="outline"
            block
            disabled
          />
        </UTooltip>
        <UButton
          label="Remove from map"
          icon="i-lucide-map-pin-off"
          color="neutral"
          variant="outline"
          block
          @click="remove(selection!)"
        />
        <p class="text-xs text-muted">
          {{ selectedTable.label }} moves to Unplaced tables. Its QR code keeps working.
        </p>
      </div>
    </aside>

    <aside
      v-else-if="selectedItem"
      aria-label="Selected furniture"
      class="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-default p-4 md:flex"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
          <UIcon
            :name="ITEM_ICONS[selectedItem.kind]"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            {{ ITEM_SPECS[selectedItem.kind].label }}
          </p>
          <p class="text-xs text-muted">
            {{ selectedItem.kind === 'stairs' ? 'Structure' : 'Furniture' }} · no QR code
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Width (cm)">
          <UInputNumber
            :model-value="selectedItem.width"
            :min="10"
            :max="2000"
            :step="5"
            @update:model-value="value => setNumber(value, width => updateItem(selectedItem!.id, { width, ...(ITEM_SPECS[selectedItem!.kind].footprint === 'round' ? { depth: width } : {}) }))"
          />
        </UFormField>
        <UFormField label="Depth (cm)">
          <UInputNumber
            :model-value="selectedItem.depth"
            :min="10"
            :max="2000"
            :step="5"
            :disabled="ITEM_SPECS[selectedItem.kind].footprint === 'round'"
            @update:model-value="value => setNumber(value, depth => updateItem(selectedItem!.id, { depth }))"
          />
        </UFormField>
      </div>
      <UFormField label="Rotation (°)">
        <div class="flex gap-2">
          <UInputNumber
            :model-value="selectedItem.rotation"
            :min="0"
            :max="359"
            :step="15"
            class="flex-1"
            @update:model-value="value => setNumber(value, rotation => updateItem(selectedItem!.id, { rotation: normalizeRotation(rotation) }))"
          />
          <UButton
            icon="i-lucide-rotate-cw"
            color="neutral"
            variant="outline"
            aria-label="Turn 90° right"
            @click="turn(90)"
          />
        </div>
      </UFormField>
      <div
        v-for="slot in ITEM_SPECS[selectedItem.kind].slots"
        :key="slot.key"
        class="flex flex-col gap-2"
      >
        <p class="text-sm font-medium text-highlighted">
          {{ slot.label }}
          <span class="font-normal text-muted">· {{ swatch(itemFinish(selectedItem.kind, selectedItem.finishes, slot.key)).label }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="option in slot.options"
            :key="option"
            type="button"
            class="size-8 rounded-full border border-default ring-offset-2 ring-offset-(--ui-bg) focus-visible:outline-2 focus-visible:outline-primary aria-pressed:ring-2 aria-pressed:ring-primary"
            :style="{ background: swatch(option).color }"
            :aria-label="swatch(option).label"
            :aria-pressed="itemFinish(selectedItem.kind, selectedItem.finishes, slot.key) === option"
            @click="updateItem(selectedItem!.id, { finishes: { ...selectedItem!.finishes, [slot.key]: option } })"
          />
        </div>
      </div>
      <UButton
        class="mt-auto"
        label="Delete"
        icon="i-lucide-trash-2"
        color="error"
        variant="outline"
        block
        @click="remove(selection!)"
      />
    </aside>
  </div>
</template>
