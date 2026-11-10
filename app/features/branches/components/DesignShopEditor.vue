<script setup lang="ts">
/**
 * Design shop (D273, frames 1–3, 6A–6C, 9A–9C): a branch's saved layout with its real tables. The
 * library (Unplaced tables, table looks, furniture), the floor plan with its floors, Draw outline
 * and Draw wall, and the panel for what's selected. Every change goes through the editor's draft
 * (one undo step each) and is saved with Save layout (the page's navbar). Pieces arrive by dragging
 * from the library or with Place on map (then the move pad), so the editor works without dragging
 * on touch, with a keyboard and in the e2e tests.
 */
import { createReusableTemplate } from '@vueuse/core'
import type { DiningTable } from '#shared/contracts/branches'
import type { BuiltInLookId, Finish, Floor, InnerWall, ItemKind, LayoutTable, Point, TableLook } from '#shared/contracts/shop-layout'
import type { LayoutEditor } from '../composables/useLayoutEditor'
import type { ItemCategory } from '../designer/catalog'
import { FINISH_SWATCHES, findLook, ITEM_SPECS, itemFinish, NEW_TABLE_LOOK } from '../designer/catalog'
import { FINE_GRID_CM, GRID_CM, newLayoutId, normalizeRotation, outsideOutline, snap } from '../designer/geometry'
import { areaM2, edgeNames, shapeOf } from '../designer/outline'
import type { FloorShape } from '../designer/outline'
import { isMovable } from '../designer/plan'
import type { PlanGhost, PlanMode, PlanSelection } from '../designer/plan'
import { canAddFloor, newFloor } from '../designer/starters'
import type { Starter } from '../designer/starters'
import EdgePanel from './EdgePanel.vue'
import FloorPlanCanvas from './FloorPlanCanvas.vue'
import LayoutStarterPicker from './LayoutStarterPicker.vue'
import PickTableModal from './PickTableModal.vue'
import TableFormModal from './TableFormModal.vue'
import TableQrModal from './TableQrModal.vue'

const props = defineProps<{
  editor: LayoutEditor
  branchId: string
  /** Every table of the branch (the table list's query): for Edit table, View QR and names. */
  diningTables: readonly DiningTable[]
  looks: readonly TableLook[]
}>()

const emit = defineEmits<{ view3d: [] }>()

const draft = props.editor.draft
const layout = computed(() => draft.layout.value)
const tables = computed(() => props.editor.tables.value)
const floors = computed(() => layout.value.floors)
const floor = computed(() => floors.value.find(candidate => candidate.id === props.editor.floorId.value) ?? floors.value[0])
const floorIndex = computed(() => (floor.value ? floors.value.indexOf(floor.value) : -1))
const selection = props.editor.selection
const showBelow = ref(true)
const mode = ref<PlanMode>('select')
const canvas = useTemplateRef('canvas')
const libraryOpen = ref(false)
const detailsOpen = ref(false)
const confirm = useConfirm()

const [DefineLibrary, ReuseLibrary] = createReusableTemplate()
const [DefineDetails, ReuseDetails] = createReusableTemplate()

function selectFloor(id: string) {
  props.editor.showFloor(id)
  selection.value = null
}

// A floor without an outline (Blank) opens Draw outline.
watch(() => floor.value?.outline.length === 0, (empty) => {
  if (empty) mode.value = 'outline'
}, { immediate: true })

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
const LOOK_ICONS = { round: 'i-lucide-circle', rect: 'i-lucide-rectangle-horizontal', booth: 'i-lucide-sofa' } as const
const CATEGORIES: { key: ItemCategory, label: string }[] = [
  { key: 'chairs', label: 'Extra seating' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'structure', label: 'Structure' },
]
const catalog = CATEGORIES.map(category => ({ ...category, specs: Object.values(ITEM_SPECS).filter(spec => spec.category === category.key) }))

const placedIds = computed(() => new Set(layout.value.placements.map(placement => placement.tableId)))
const unplaced = computed(() => tables.value.filter(table => !placedIds.value.has(table.id)))
const tablesOn = (id: string) => layout.value.placements.filter(placement => placement.floorId === id).length
const tableLabel = (id: string) => tables.value.find(table => table.id === id)?.label ?? props.diningTables.find(table => table.id === id)?.label

const selectedPlacement = computed(() => selection.value?.kind === 'table' ? layout.value.placements.find(placement => placement.tableId === selection.value!.id) : undefined)
const selectedTable = computed(() => selectedPlacement.value && tables.value.find(table => table.id === selectedPlacement.value!.tableId))
const selectedDiningTable = computed(() => selectedPlacement.value && props.diningTables.find(table => table.id === selectedPlacement.value!.tableId))
const selectedItem = computed(() => selection.value?.kind === 'item' ? floor.value?.items.find(item => item.id === selection.value!.id) : undefined)
const selectedWall = computed(() => selection.value?.kind === 'wall' ? floor.value?.walls.find(wall => wall.id === selection.value!.id) : undefined)
const selectedEdge = computed(() => {
  if (selection.value?.kind !== 'edge' || !floor.value) return undefined
  const index = Number(selection.value.id)
  return index < floor.value.edges.length ? index : undefined
})
const names = computed(() => (floor.value ? edgeNames(floor.value.outline) : []))
const selectedLook = computed(() => selectedPlacement.value && findLook(props.looks, selectedPlacement.value.lookId))
const lookUsers = computed(() => {
  const placement = selectedPlacement.value
  if (!placement) return []
  return layout.value.placements
    .filter(other => other.lookId === placement.lookId && other.tableId !== placement.tableId)
    .map(other => tableLabel(other.tableId))
    .filter(Boolean)
})
const lookItems = computed(() => props.looks.map(look => ({ label: look.name, value: look.id })))
const floorItems = computed(() => floors.value.map(candidate => ({ label: candidate.name, value: candidate.id })))
const outsideLabels = computed(() => {
  if (!floor.value || floor.value.outline.length < 3) return []
  const outside = outsideOutline(floor.value, layout.value.placements)
  return [
    ...layout.value.placements.filter(placement => outside.has(placement.tableId)).map(placement => ({ selection: { kind: 'table' as const, id: placement.tableId }, label: tableLabel(placement.tableId) ?? 'A table' })),
    ...floor.value.items.filter(item => outside.has(item.id)).map(item => ({ selection: { kind: 'item' as const, id: item.id }, label: ITEM_SPECS[item.kind].label })),
  ]
})
const unavailableLabels = computed(() => props.editor.unavailable.value.map(placement => tableLabel(placement.tableId) ?? 'A deleted table'))
const conflict = computed(() => props.editor.conflict.value)

// --- Changes, each one undo step ---

function changeFloor(apply: (floor: Floor) => void) {
  const id = floor.value?.id
  if (!id) return
  draft.change((next) => {
    const target = next.floors.find(candidate => candidate.id === id)
    if (target) apply(target)
  })
}

function placeTable(tableId: string, at: Point, lookId: BuiltInLookId = NEW_TABLE_LOOK) {
  const look = findLook(props.looks, lookId)
  const floorId = floor.value?.id
  if (!floorId) return
  draft.change((next) => {
    next.placements.push({ tableId, floorId, x: snap(at.x), y: snap(at.y), rotation: 0, width: look.defaultWidth, depth: look.defaultDepth, lookId: look.id })
  })
  selection.value = { kind: 'table', id: tableId }
}

function placeItem(kind: ItemKind, at: Point) {
  const spec = ITEM_SPECS[kind]
  const id = newLayoutId('item')
  changeFloor(target => target.items.push({ id, kind, x: snap(at.x), y: snap(at.y), rotation: 0, width: spec.width, depth: spec.depth, finishes: {} }))
  selection.value = { kind: 'item', id }
}

function updateTable(tableId: string, change: Partial<{ floorId: string, x: number, y: number, rotation: number, width: number, depth: number, lookId: BuiltInLookId }>) {
  draft.change((next) => {
    const placement = next.placements.find(candidate => candidate.tableId === tableId)
    if (placement) Object.assign(placement, change)
  })
  if (change.floorId) props.editor.showFloor(change.floorId)
}

function updateItem(itemId: string, change: Partial<{ x: number, y: number, rotation: number, width: number, depth: number, finishes: Partial<Record<string, Finish>> }>) {
  draft.change((next) => {
    const item = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === itemId)
    if (item) Object.assign(item, change)
  })
}

function move(target: PlanSelection, position: Point) {
  if (target.kind === 'table') updateTable(target.id, position)
  else if (target.kind === 'item') updateItem(target.id, position)
}

function rotate(target: PlanSelection, rotation: number) {
  if (target.kind === 'table') updateTable(target.id, { rotation })
  else if (target.kind === 'item') updateItem(target.id, { rotation })
}

/** A table leaves the map (back to Unplaced, its QR untouched); furniture and walls are deleted. */
function remove(target: PlanSelection) {
  if (target.kind === 'edge') return
  draft.change((next) => {
    if (target.kind === 'table') next.placements = next.placements.filter(placement => placement.tableId !== target.id)
    for (const candidate of next.floors) {
      if (target.kind === 'item') candidate.items = candidate.items.filter(item => item.id !== target.id)
      if (target.kind === 'wall') candidate.walls = candidate.walls.filter(wall => wall.id !== target.id)
    }
  })
  selection.value = null
}

function updateShape(shape: FloorShape) {
  changeFloor((target) => {
    target.outline = shape.outline
    target.edges = shape.edges
  })
}

function addWall(wall: Omit<InnerWall, 'id'>) {
  changeFloor(target => target.walls.push({ id: newLayoutId('wall'), ...wall }))
}

const step = ref(GRID_CM)

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

// --- Floors (9B, 6B) ---

function addFloor() {
  if (!canAddFloor(layout.value)) return
  const created = newFloor(layout.value)
  draft.change(next => void next.floors.push(created))
  selectFloor(created.id)
}

const floorName = ref('')
watch(() => floor.value?.name, name => (floorName.value = name ?? ''), { immediate: true })
function renameFloor() {
  const name = floorName.value.trim()
  if (!name || name === floor.value?.name) {
    floorName.value = floor.value?.name ?? ''
    return
  }
  changeFloor(target => void (target.name = name))
}

function setHeight(value: number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value !== floor.value?.height) changeFloor(target => void (target.height = Math.round(value)))
}

function setRoof(hasRoof: boolean) {
  changeFloor(target => void (target.hasRoof = hasRoof))
}

async function removeFloor() {
  const target = floor.value
  if (!target || floors.value.length <= 1) return
  const labels = layout.value.placements.filter(placement => placement.floorId === target.id).map(placement => tableLabel(placement.tableId) ?? 'A table')
  const pieces = target.items.length
  const moved = labels.length
    ? `${listLabels(labels)} will move to Unplaced tables. ${labels.length === 1 ? 'Its QR code keeps' : 'Their QR codes keep'} working. `
    : ''
  const confirmed = await confirm({
    title: `Remove the ${target.name} floor?`,
    description: `${moved}Its outline, walls${pieces ? ` and ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} of furniture` : ''} are deleted. You can undo until you save the layout.`,
    confirmLabel: 'Remove floor',
    danger: true,
  })
  if (!confirmed) return
  const index = floors.value.indexOf(target)
  draft.change((next) => {
    next.floors = next.floors.filter(candidate => candidate.id !== target.id)
    next.placements = next.placements.filter(placement => placement.floorId !== target.id)
  })
  selectFloor(floors.value[Math.max(0, index - 1)]!.id)
}

function listLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

// --- Draw outline and Draw wall (3A, 9A) ---

/** The layout when the tool opened: Cancel puts this floor's shape and walls back, as one undo step. */
let toolStart: { floorId: string, shape: FloorShape, walls: InnerWall[] } | null = null

function startTool(next: PlanMode) {
  if (mode.value === next) return finishTool()
  const current = floor.value
  toolStart = current ? { floorId: current.id, shape: shapeOf(current), walls: current.walls } : null
  mode.value = next
  selection.value = null
}

function finishTool() {
  toolStart = null
  mode.value = 'select'
}

function cancelTool() {
  const start = toolStart
  const current = floors.value.find(candidate => candidate.id === start?.floorId)
  const changed = (now: unknown, then: unknown) => JSON.stringify(now) !== JSON.stringify(then)
  if (start && current && (changed(current.outline, start.shape.outline) || changed(current.edges, start.shape.edges) || changed(current.walls, start.walls))) {
    draft.change((next) => {
      const target = next.floors.find(candidate => candidate.id === start.floorId)
      if (!target) return
      target.outline = structuredClone(toRaw(start.shape.outline))
      target.edges = structuredClone(toRaw(start.shape.edges))
      target.walls = structuredClone(toRaw(start.walls))
    })
  }
  finishTool()
}

// --- Tables from the library ---

const overlay = useOverlay()
const formModal = overlay.create(TableFormModal)
const qrModal = overlay.create(TableQrModal)
const pickModal = overlay.create(PickTableModal)

/** New table (the branch's own form): saved at once; it then waits in Unplaced tables. */
async function newTable(): Promise<LayoutTable | undefined> {
  const created = await formModal.open({ branchId: props.branchId }).result
  if (!created) return undefined
  await props.editor.query.refresh()
  return tables.value.find(table => table.id === created.id)
}

/** A look from the library: which real table is it? Then it's placed with that look. */
async function placeLook(lookId: BuiltInLookId, at: Point) {
  const look = findLook(props.looks, lookId)
  const choice = await pickModal.open({ lookName: look.name, tables: unplaced.value }).result
  if (!choice) return
  const tableId = choice === 'new' ? (await newTable())?.id : choice
  if (tableId && !placedIds.value.has(tableId)) placeTable(tableId, at, lookId)
}

function editTable() {
  const table = selectedDiningTable.value
  if (table) formModal.open({ branchId: props.branchId, table })
}

function viewQr() {
  const table = selectedDiningTable.value
  if (table?.qrUrl) qrModal.open({ table: { ...table, qrUrl: table.qrUrl } })
}

type LibraryPiece = { kind: 'table', tableId: string } | { kind: 'look', lookId: BuiltInLookId } | { kind: 'item', itemKind: ItemKind }

function place(piece: LibraryPiece, at: Point) {
  if (piece.kind === 'table') placeTable(piece.tableId, at)
  else if (piece.kind === 'look') void placeLook(piece.lookId, at)
  else placeItem(piece.itemKind, at)
}

function placeInMiddle(piece: LibraryPiece) {
  // A drag that ended back on its card also clicks it: that drag already placed (or cancelled).
  if (performance.now() < suppressClickUntil) return
  libraryOpen.value = false
  mode.value = 'select'
  place(piece, canvas.value?.viewCenter() ?? { x: 0, y: 0 })
  canvas.value?.focus()
}

// Dragging from the library: past a few pixels it's a drag (a ghost follows over the plan, drop
// places); a press that doesn't move is a click and places in the middle.
const ghost = ref<PlanGhost | null>(null)
let suppressClickUntil = 0
let libraryDrag: { piece: LibraryPiece, start: Point, dragging: boolean } | null = null

function startLibraryDrag(event: PointerEvent, piece: LibraryPiece) {
  if (event.button !== 0) return
  libraryDrag = { piece, start: { x: event.clientX, y: event.clientY }, dragging: false }
  window.addEventListener('pointermove', onLibraryMove)
  window.addEventListener('pointerup', onLibraryUp, { once: true })
}

function ghostOf(piece: LibraryPiece, at: Point): PlanGhost {
  if (piece.kind === 'item') return { kind: 'item', itemKind: piece.itemKind, ...at }
  if (piece.kind === 'look') return { kind: 'table', tableId: null, lookId: piece.lookId, ...at }
  return { kind: 'table', tableId: piece.tableId, lookId: NEW_TABLE_LOOK, ...at }
}

function onLibraryMove(event: PointerEvent) {
  if (!libraryDrag) return
  if (!libraryDrag.dragging && Math.hypot(event.clientX - libraryDrag.start.x, event.clientY - libraryDrag.start.y) < 6) return
  libraryDrag.dragging = true
  const at = canvas.value?.toPlan(event.clientX, event.clientY, true)
  const fine = event.shiftKey ? FINE_GRID_CM : GRID_CM
  ghost.value = at ? ghostOf(libraryDrag.piece, { x: snap(at.x, fine), y: snap(at.y, fine) }) : null
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
  mode.value = 'select'
  place(drag.piece, dropped)
}

onBeforeUnmount(() => window.removeEventListener('pointermove', onLibraryMove))

defineShortcuts({
  meta_z: () => draft.undo(),
  meta_shift_z: () => draft.redo(),
  meta_y: () => draft.redo(),
})

const position = computed(() => {
  const current = selectedPlacement.value ?? selectedItem.value
  return current ? `x ${(current.x / 100).toFixed(2)} m · y ${(current.y / 100).toFixed(2)} m` : ''
})

function setNumber(value: number | null | undefined, apply: (value: number) => void) {
  if (typeof value === 'number' && Number.isFinite(value)) apply(Math.round(value))
}

const wallLength = (wall: InnerWall) => Math.round(Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y))
const swatch = (finish: Finish) => FINISH_SWATCHES[finish]

function chooseStarter(starter: Starter) {
  props.editor.begin(starter.layout())
}
</script>

<template>
  <!-- The library (lg and up beside the plan; below, in a slide-over). -->
  <DefineLibrary>
    <div class="flex flex-col gap-5">
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
          {{ tables.length ? 'Every table is on the map.' : 'This branch has no tables yet.' }}
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
            <span class="ml-1 inline-flex h-6 min-w-11 items-center justify-center rounded-md border border-primary bg-primary/10 px-1 text-xs font-semibold text-highlighted">{{ table.label }}</span>
          </span>
          <span class="flex-1 text-sm text-muted">{{ table.seats }} seats</span>
          <UButton
            label="Place on map"
            size="xs"
            variant="ghost"
            @click="placeInMiddle({ kind: 'table', tableId: table.id })"
          />
        </div>
        <UButton
          label="New table"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          class="self-start"
          @click="newTable()"
        />
      </section>

      <USeparator />

      <section class="flex flex-col gap-2">
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Table looks · chairs follow the table’s seats
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="look in looks"
            :key="look.id"
            type="button"
            class="flex touch-none flex-col items-start gap-1 rounded-md border border-default p-2 text-left text-sm text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :data-testid="`look-${look.id}`"
            @pointerdown="startLibraryDrag($event, { kind: 'look', lookId: look.id })"
            @click="placeInMiddle({ kind: 'look', lookId: look.id })"
          >
            <UIcon
              :name="LOOK_ICONS[look.shape]"
              class="size-5 text-primary"
            />
            <span>{{ look.name }}</span>
            <span class="text-xs text-muted">{{ look.shape === 'round' ? `Ø ${look.defaultWidth} cm` : `${look.defaultWidth} × ${look.defaultDepth}` }}</span>
          </button>
        </div>
      </section>

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
        Drag onto the plan, or click to place it in the middle. Doors and windows go on an edge: click one on the plan.
      </p>
    </div>
  </DefineLibrary>

  <!-- What's selected (md and up beside the plan; below, in a slide-over). -->
  <DefineDetails>
    <div
      v-if="selectedPlacement && selectedLook"
      class="flex flex-col gap-4"
      data-testid="selected-table"
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
            {{ tableLabel(selectedPlacement.tableId) ?? 'A deleted table' }}
          </p>
          <p class="text-xs text-muted">
            Dining table · {{ floor?.name }} floor
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null; detailsOpen = false"
        />
      </div>
      <div class="flex items-center gap-3 rounded-md border border-default bg-elevated/50 px-3 py-2">
        <div class="flex-1">
          <p class="text-xs text-muted">
            Seats
          </p>
          <p class="font-semibold text-highlighted">
            {{ selectedTable?.seats ?? '–' }}
          </p>
        </div>
        <UButton
          label="Edit table"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="!selectedDiningTable || selectedDiningTable.status !== 'active'"
          @click="editTable()"
        />
      </div>
      <p class="text-xs text-muted">
        Label and seats belong to the table and save right away. Everything below saves with the layout.
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
        <UButton
          label="View QR"
          icon="i-lucide-qr-code"
          color="neutral"
          variant="outline"
          block
          :disabled="!selectedDiningTable?.qrUrl"
          @click="viewQr()"
        />
        <UButton
          label="Remove from map"
          icon="i-lucide-map-pin-off"
          color="neutral"
          variant="outline"
          block
          @click="remove(selection!)"
        />
        <p class="text-xs text-muted">
          {{ tableLabel(selectedPlacement.tableId) ?? 'The table' }} moves to Unplaced tables. Its QR code keeps working.
        </p>
      </div>
    </div>

    <div
      v-else-if="selectedItem"
      class="flex flex-col gap-4"
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
          @click="selection = null; detailsOpen = false"
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
    </div>

    <div
      v-else-if="selectedWall"
      class="flex flex-col gap-4"
      data-testid="selected-wall"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
          <UIcon
            name="i-lucide-brick-wall"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            Inside wall
          </p>
          <p class="text-xs text-muted tabular-nums">
            {{ wallLength(selectedWall) }} cm
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null; detailsOpen = false"
        />
      </div>
      <p class="text-sm text-muted">
        Inside walls make a stair kiosk or a kitchen. The outline makes the outer walls.
      </p>
      <UButton
        label="Delete wall"
        icon="i-lucide-trash-2"
        color="error"
        variant="outline"
        block
        @click="remove(selection!)"
      />
    </div>

    <EdgePanel
      v-else-if="floor && selectedEdge !== undefined"
      :shape="shapeOf(floor)"
      :index="selectedEdge"
      :name="names[selectedEdge] ?? 'Edge'"
      @change="updateShape"
      @close="selection = null; detailsOpen = false"
    />
  </DefineDetails>

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
  <LayoutStarterPicker
    v-else-if="!floor"
    :table-count="tables.length"
    @choose="chooseStarter"
  />

  <div
    v-else
    class="flex h-full min-h-0"
  >
    <aside
      aria-label="Library"
      class="hidden w-72 shrink-0 overflow-y-auto border-r border-default p-4 lg:block"
    >
      <ReuseLibrary />
    </aside>
    <AppSlideover
      v-model:open="libraryOpen"
      title="Library"
      side="left"
      class="lg:hidden"
    >
      <template #body>
        <ReuseLibrary />
      </template>
    </AppSlideover>

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
        :mode="mode"
        @select="selection = $event"
        @move="move"
        @rotate="rotate"
        @remove="remove"
        @shape="updateShape"
        @add-wall="addWall"
      />

      <div class="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <!-- A tool's bar replaces the floor bar while it's open (3A, 9A). -->
        <div
          v-if="mode !== 'select'"
          class="pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default bg-default p-1 pl-3 shadow-sm"
          data-testid="tool-bar"
        >
          <span class="text-sm font-semibold text-highlighted">
            {{ mode === 'outline' ? 'Draw outline' : 'Draw wall' }}
            <span class="font-normal text-muted">· {{ floor.name }} floor<template v-if="mode === 'outline' && floor.outline.length >= 3"> · {{ areaM2(floor.outline) }} m²</template></span>
          </span>
          <span class="flex items-center gap-1">
            <USwitch
              v-if="floorIndex > 0"
              v-model="showBelow"
              label="Show floor below"
              size="sm"
              class="px-1"
            />
            <UButton
              v-if="floor.outline.length >= 3"
              label="Cancel"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="cancelTool()"
            />
            <UButton
              label="Done"
              size="sm"
              :disabled="floor.outline.length < 3"
              @click="finishTool()"
            />
          </span>
        </div>

        <div
          v-else
          class="flex flex-wrap items-start justify-between gap-2"
        >
          <div class="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-default bg-default p-1 shadow-sm">
            <UButton
              icon="i-lucide-library"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Library"
              class="lg:hidden"
              @click="libraryOpen = true"
            />
            <UFieldGroup>
              <UButton
                v-for="candidate in floors"
                :key="candidate.id"
                :label="candidate.name"
                :color="candidate.id === floor.id ? 'primary' : 'neutral'"
                :variant="candidate.id === floor.id ? 'soft' : 'ghost'"
                size="sm"
                :aria-pressed="candidate.id === floor.id"
                :data-testid="`floor-tab-${candidate.name}`"
                @click="selectFloor(candidate.id)"
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
            <!-- The floor menu (9B). -->
            <UPopover :content="{ align: 'start' }">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`${floor.name} floor options`"
                data-testid="floor-menu"
              />
              <template #content>
                <div
                  class="flex w-72 flex-col gap-3 p-3"
                  data-testid="floor-menu-panel"
                >
                  <UFormField label="Rename floor">
                    <UInput
                      v-model="floorName"
                      :maxlength="30"
                      class="w-full"
                      @blur="renameFloor()"
                      @keydown.enter="renameFloor()"
                    />
                  </UFormField>
                  <UFormField
                    label="Floor height (cm)"
                    help="The wall height in 3D."
                  >
                    <UInputNumber
                      :model-value="floor.height"
                      :min="200"
                      :max="800"
                      :step="10"
                      @update:model-value="setHeight"
                    />
                  </UFormField>
                  <USwitch
                    :model-value="floor.hasRoof"
                    label="Roof over this floor"
                    description="Off: open to the sky, like a rooftop patio."
                    @update:model-value="setRoof"
                  />
                  <USeparator />
                  <UButton
                    label="Remove floor…"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    :disabled="floors.length <= 1"
                    @click="removeFloor()"
                  />
                </div>
              </template>
            </UPopover>
            <UTooltip :text="canAddFloor(layout) ? 'A new floor on top, with this outline' : 'A layout has at most 10 floors'">
              <UButton
                label="Add floor"
                icon="i-lucide-plus"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="!canAddFloor(layout)"
                :ui="{ label: 'max-sm:sr-only' }"
                @click="addFloor()"
              />
            </UTooltip>
            <USwitch
              v-if="floorIndex > 0"
              v-model="showBelow"
              label="Floor below"
              size="sm"
              class="px-1"
            />
          </div>
          <div class="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-default bg-default p-1 shadow-sm">
            <UButton
              label="Draw outline"
              icon="i-lucide-pen-tool"
              color="neutral"
              variant="ghost"
              size="sm"
              :ui="{ label: 'max-xl:sr-only' }"
              @click="startTool('outline')"
            />
            <UButton
              label="Draw wall"
              icon="i-lucide-brick-wall"
              color="neutral"
              variant="ghost"
              size="sm"
              :ui="{ label: 'max-xl:sr-only' }"
              @click="startTool('wall')"
            />
            <USeparator
              orientation="vertical"
              class="h-5"
            />
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
              :ui="{ label: 'max-sm:sr-only' }"
              @click="emit('view3d')"
            />
          </div>
        </div>

        <!-- Someone else saved (6A): the draft stays until the owner chooses. -->
        <UAlert
          v-if="conflict"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          class="pointer-events-auto max-w-xl"
          title="This layout was changed somewhere else"
          :description="conflict.latest?.updatedAt ? `Saved ${formatTimeAgo(conflict.latest.updatedAt)}. Your draft is kept here until you choose.` : 'Your draft is kept here until you choose.'"
          :actions="[
            { label: 'Load latest', color: 'neutral', variant: 'outline', onClick: () => editor.loadLatest() },
            { label: 'Overwrite with mine', color: 'error', variant: 'outline', onClick: () => editor.overwrite() },
          ]"
          data-testid="layout-conflict"
        />
        <UAlert
          v-if="editor.problem.value"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          class="pointer-events-auto max-w-xl"
          title="Not saved"
          :description="editor.problem.value"
          close
          @update:open="editor.dismissProblem()"
        />
        <UAlert
          v-if="unavailableLabels.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          class="pointer-events-auto max-w-xl"
          :title="`${listLabels(unavailableLabels)} ${unavailableLabels.length === 1 ? 'is' : 'are'} no longer an active table here.`"
          description="Archived or deleted since this layout was opened. Remove it from the map to save."
          :actions="[{ label: 'Remove from map', color: 'neutral', variant: 'outline', onClick: () => editor.removeUnavailable() }]"
          data-testid="layout-unavailable"
        />
        <UAlert
          v-if="outsideLabels.length && mode === 'select'"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          class="pointer-events-auto max-w-xl"
          :title="`${outsideLabels.map(entry => entry.label).join(', ')} ${outsideLabels.length === 1 ? 'is' : 'are'} outside the ${floor.name} floor.`"
          description="Saving still works. Move it back in or remove it from the map."
          :actions="[{ label: 'Show', color: 'neutral', variant: 'outline', onClick: () => { selection = outsideLabels[0]!.selection } }]"
        />
      </div>

      <!-- How the tool works (3A, 9A). -->
      <div
        v-if="mode !== 'select'"
        class="absolute right-3 bottom-3 flex max-w-60 flex-col gap-1 rounded-lg border border-default bg-default px-3 py-2 text-xs text-toned shadow-sm"
      >
        <template v-if="mode === 'outline' && floor.outline.length === 0">
          <span>Click on the grid to add corners.</span>
          <span>Click the first corner, double-click or press Enter to close the shape.</span>
        </template>
        <template v-else-if="mode === 'outline'">
          <span>Drag a corner to move it; it keeps right angles unless you hold Alt.</span>
          <span>Click a round handle to add a corner. Click a corner, then Delete to remove it.</span>
          <span>Click an edge to make it a wall, railing or open, or to add doors and windows.</span>
        </template>
        <template v-else>
          <span>Click where the wall starts, then where it ends.</span>
          <span>Walls carry on from the last end; Escape or a double-click stops.</span>
        </template>
      </div>

      <!-- The move pad: no dragging needed (2C). -->
      <div
        v-if="mode === 'select' && isMovable(selection)"
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
          <div class="flex gap-1">
            <UButton
              label="Details"
              size="xs"
              color="neutral"
              variant="outline"
              class="md:hidden"
              @click="detailsOpen = true"
            />
            <UButton
              label="Done"
              size="xs"
              @click="selection = null"
            />
          </div>
        </div>
      </div>
      <UButton
        v-else-if="mode !== 'wall' && selection"
        label="Details"
        color="neutral"
        variant="outline"
        class="absolute bottom-3 left-3 shadow-sm md:hidden"
        @click="detailsOpen = true"
      />
      <p
        v-else-if="mode === 'select'"
        class="absolute right-3 bottom-3 hidden rounded-md border border-default bg-default px-2 py-1 text-xs text-muted shadow-sm sm:block"
      >
        Drag empty space to pan · Scroll or pinch to zoom · R turns the selection
      </p>
    </main>

    <aside
      v-if="mode !== 'wall' && (selectedPlacement || selectedItem || selectedWall || selectedEdge !== undefined)"
      aria-label="Selected"
      class="hidden w-80 shrink-0 overflow-y-auto border-l border-default p-4 md:block"
    >
      <ReuseDetails />
    </aside>
    <AppSlideover
      v-model:open="detailsOpen"
      title="Details"
      class="md:hidden"
    >
      <template #body>
        <ReuseDetails />
      </template>
    </AppSlideover>
  </div>
</template>
