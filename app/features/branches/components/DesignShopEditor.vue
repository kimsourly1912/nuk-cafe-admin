<script setup lang="ts">
/**
 * Design shop (D273, frames 1–3, 6A–6C, 9A–9C): a branch's saved layout with its real tables. The
 * library (Unplaced tables, table looks, furniture), the floor plan with its floors, Draw outline
 * and Draw wall, and the panel for what's selected. Every change goes through the editor's draft
 * (one undo step each) and is saved with Save layout (the page's navbar). Pieces arrive by dragging
 * from the library or with Place on map (then the move pad), so the editor works without dragging
 * on touch, with a keyboard and in the e2e tests.
 */
import { createReusableTemplate, useElementSize } from '@vueuse/core'
import type { DiningTable } from '#shared/contracts/branches'
import { edgeLength, heightRangeMessage, ITEM_HEIGHTS, isFigureKind, isItemLookKind, LAYOUT_MAX_EXTENT_CM } from '#shared/contracts/shop-layout'
import type { CustomItemLook, CustomLook, Finish, Floor, InnerWall, ItemKind, ItemLook, LayoutItem, LayoutTable, Point, TableLook } from '#shared/contracts/shop-layout'
import type { LayoutEditor } from '../composables/useLayoutEditor'
import type { ItemCategory, LookCategory } from '../designer/catalog'
import { CATEGORIES, FINISH_SWATCHES, LOOK_CATEGORIES, findItemLook, findLook, ITEM_SPECS, itemFinish, NEW_TABLE_LOOK, pieceFinishes, pieceHeight } from '../designer/catalog'
import { besideOf, FINE_GRID_CM, GRID_CM, newLayoutId, normalizeRotation, placementExtent, snap } from '../designer/geometry'
import type { Sized } from '../designer/geometry'
import { addOpening, areaM2, edgeNames, openingFits, setEdgeKind, setEdgeLength, shapeOf } from '../designer/outline'
import type { FloorShape } from '../designer/outline'
import type { PlanGhost, PlanMode, PlanSelection } from '../designer/plan'
import { canAddFloor, newFloor } from '../designer/starters'
import type { Starter } from '../designer/starters'
import EdgePanel from './EdgePanel.vue'
import ExploreLayoutSettings from './ExploreLayoutSettings.vue'
import ItemLookFormModal from './ItemLookFormModal.vue'
import type { ItemLookSource } from './ItemLookFormModal.vue'
import FloorPlanCanvas from './FloorPlanCanvas.vue'
import LayoutStarterPicker from './LayoutStarterPicker.vue'
import LookFormModal from './LookFormModal.vue'
import PickTableModal from './PickTableModal.vue'
import TableFormModal from './TableFormModal.vue'
import TableQrModal from './TableQrModal.vue'

const props = defineProps<{
  editor: LayoutEditor
  branchId: string
  active: boolean
  hasPin: boolean
  /** Every table of the branch (the table list's query): for Edit table, View QR and names. */
  diningTables: readonly DiningTable[]
  looks: readonly TableLook[]
}>()



const exploreEnabled = useRuntimeConfig().public.explore
const exploreOpen = ref(false)
const draft = props.editor.draft
const layout = computed(() => draft.layout.value)
const tables = computed(() => props.editor.tables.value)
const floors = computed(() => layout.value.floors)
const floor = computed(() => floors.value.find(candidate => candidate.id === props.editor.floorId.value) ?? floors.value[0])
const floorIndex = computed(() => (floor.value ? floors.value.indexOf(floor.value) : -1))
const selection = props.editor.selection
const showBelow = ref(true)
const mode = ref<PlanMode>('select')
const canvas = useTemplateRef<InstanceType<typeof FloorPlanCanvas>>('canvas')
const { isCompact, isExpanded } = useLayoutContext()
const panels = [
  { value: 'floors', label: 'Floors', icon: 'i-lucide-layers' },
  { value: 'tables', label: 'Tables', icon: 'i-lucide-table-2' },
  { value: 'assets', label: 'Assets', icon: 'i-lucide-box' },
  { value: 'properties', label: 'Properties', icon: 'i-lucide-sliders-horizontal' },
] as const
type Panel = typeof panels[number]['value']
const panel = ref<Exclude<Panel, 'properties'>>('floors')
const panelOpen = ref<Panel | null>(null)
const detailsOpen = computed({
  get: () => panelOpen.value === 'properties',
  set: open => panelOpen.value = open ? 'properties' : null,
})
const focusMode = ref(false)
const search = ref('')
const assetTab = ref<'objects' | 'finishes'>('objects')
const panelTitle = computed(() => panels.find(option => option.value === (panelOpen.value ?? panel.value))?.label ?? 'Floors')
const matches = (label: string) => label.toLowerCase().includes(search.value.trim().toLowerCase())

function showPanel(next: Panel) {
  if (next !== 'properties' && next !== panel.value) {
    panel.value = next
    search.value = ''
  }
  if (!isExpanded.value) panelOpen.value = panelOpen.value === next ? null : next
  else focusMode.value = false
}

watch(() => props.active, (active) => {
  if (!active) {
    exploreOpen.value = false
    panelOpen.value = null
    pending.value = null
    if (mode.value === 'outline' || mode.value === 'wall') finishTool()
  }
})
const confirm = useConfirm()
const tenantPath = useTenantPath()

const [DefineLibrary, ReuseLibrary] = createReusableTemplate()
const [DefineDetails, ReuseDetails] = createReusableTemplate()
const [DefineMovePad, ReuseMovePad] = createReusableTemplate()

function selectPlaced(target: PlanSelection, floorId: string) {
  if (floor.value?.id !== floorId) selectFloor(floorId)
  selection.value = target
  panelOpen.value = null
}

function selectFloor(id: string) {
  if (id === floor.value?.id) return
  pending.value = null
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
  'armchair': 'i-lucide-armchair',
  'sofa': 'i-lucide-sofa',
  'coffee-table': 'i-lucide-table-2',
  'coffee-station': 'i-lucide-coffee',
  'pastry-case': 'i-lucide-croissant',
  'menu-board': 'i-lucide-presentation',
  'pendant-lamp': 'i-lucide-lamp-ceiling',
  'floor-lamp': 'i-lucide-lamp-floor',
  'water-jar': 'i-lucide-amphora',
  'parasol': 'i-lucide-umbrella',
  'bicycle': 'i-lucide-bike',
  'stairs': 'i-lucide-chevrons-up',
  'person': 'i-lucide-person-standing',
  'girl': 'i-lucide-person-standing',
  'boy': 'i-lucide-person-standing',
  'old-man': 'i-lucide-person-standing',
  'barista': 'i-lucide-coffee',
  'seated-person': 'i-lucide-armchair',
  'lazing-person': 'i-lucide-bed',
  'cat': 'i-lucide-cat',
  'dog': 'i-lucide-dog',
}
const LOOK_ICONS = { round: 'i-lucide-circle', rect: 'i-lucide-rectangle-horizontal', booth: 'i-lucide-sofa' } as const
const catalog = CATEGORIES.map(category => ({ ...category, specs: Object.values(ITEM_SPECS).filter(spec => spec.category === category.key) }))
const isLookCategory = (key: ItemCategory): key is LookCategory => LOOK_CATEGORIES.some(category => category.key === key)
/** The cafe's own chair and fixture looks (step 3d), by category: shown after the built-in pieces. */
const itemLooks = computed(() => props.editor.itemLooks.value)
const itemLooksIn = (category: ItemCategory) => itemLooks.value.filter(look => ITEM_SPECS[look.kind].category === category)

const placedIds = computed(() => new Set(layout.value.placements.map(placement => placement.tableId)))
const unplaced = computed(() => tables.value.filter(table => !placedIds.value.has(table.id)))
const tablesOn = (id: string) => layout.value.placements.filter(placement => placement.floorId === id)
const placedTables = computed(() => layout.value.placements.flatMap((placement) => {
  const table = tables.value.find(table => table.id === placement.tableId)
  const on = floors.value.find(floor => floor.id === placement.floorId)
  return table && on && matches(table.label) ? [{ ...table, floorId: on.id, floorName: on.name }] : []
}))
const tableLabel = (id: string) => tables.value.find(table => table.id === id)?.label ?? props.diningTables.find(table => table.id === id)?.label

const selectedPlacement = computed(() => selection.value?.kind === 'table' ? layout.value.placements.find(placement => placement.tableId === selection.value!.id && placement.floorId === floor.value?.id) : undefined)
const selectedTable = computed(() => selectedPlacement.value && tables.value.find(table => table.id === selectedPlacement.value!.tableId))
const selectedDiningTable = computed(() => selectedPlacement.value && props.diningTables.find(table => table.id === selectedPlacement.value!.tableId))
const selectedItem = computed(() => selection.value?.kind === 'item' ? floor.value?.items.find(item => item.id === selection.value!.id) : undefined)
const selectedWall = computed(() => selection.value?.kind === 'wall' ? floor.value?.walls.find(wall => wall.id === selection.value!.id) : undefined)
const selectedEdge = computed(() => {
  if (selection.value?.kind !== 'edge' || !floor.value) return undefined
  const index = Number(selection.value.id)
  return index < floor.value.edges.length ? index : undefined
})
watch([selection, selectedPlacement, selectedItem, selectedWall, selectedEdge], ([current, table, item, wall, edge]) => {
  if (!current) return
  if ({ table, item, wall, edge }[current.kind] === undefined) {
    selection.value = null
    detailsOpen.value = false
  }
}, { immediate: true })

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
const placementAlerts = computed(() => {
  const warnings = canvas.value?.warnings
  const current = floor.value
  if (!warnings?.size || !current) return []
  const pieces = [
    ...layout.value.placements.filter(placement => placement.floorId === current.id).map(placement => ({ selection: { kind: 'table' as const, id: placement.tableId }, label: tableLabel(placement.tableId) ?? 'A table' })),
    ...current.items.map(item => ({ selection: { kind: 'item' as const, id: item.id }, label: ITEM_SPECS[item.kind].label })),
  ]
  return pieces.filter(piece => warnings.has(piece.selection.id))
})

// --- Changes, each one undo step ---

function changeFloor(apply: (floor: Floor) => void) {
  const id = floor.value?.id
  if (!id) return
  draft.change((next) => {
    const target = next.floors.find(candidate => candidate.id === id)
    if (target) apply(target)
  })
}

function placeTable(tableId: string, at: Point, lookId: string = NEW_TABLE_LOOK) {
  const look = findLook(props.looks, lookId)
  const floorId = floor.value?.id
  if (!floorId) return
  draft.change((next) => {
    next.placements.push({ tableId, floorId, x: at.x, y: at.y, rotation: 0, width: look.defaultWidth, depth: look.defaultDepth, lookId: look.id })
  })
  selection.value = { kind: 'table', id: tableId }
}

/** A piece from the library: a built-in one, or with `lookId` one of the cafe's looks (its kind and size). */
function placeItem(kind: ItemKind, at: Point, lookId?: string) {
  const look = findItemLook(itemLooks.value, lookId)
  const size = look ?? { defaultWidth: ITEM_SPECS[kind].width, defaultDepth: ITEM_SPECS[kind].depth }
  const id = newLayoutId('item')
  // A look's height comes with it (step 3e); a built-in piece has the kind's, so it saves none.
  const item: LayoutItem = { id, kind: look?.kind ?? kind, x: at.x, y: at.y, rotation: 0, width: size.defaultWidth, depth: size.defaultDepth, finishes: {}, ...(look && { lookId: look.id, height: look.defaultHeight }) }
  changeFloor(target => target.items.push(item))
  selection.value = { kind: 'item', id }
}

function updateTable(tableId: string, change: Partial<{ floorId: string, x: number, y: number, rotation: number, width: number, depth: number, lookId: string }>) {
  draft.change((next) => {
    const placement = next.placements.find(candidate => candidate.tableId === tableId)
    if (placement) Object.assign(placement, change)
  })
  if (change.floorId) props.editor.showFloor(change.floorId)
}

function updateItem(itemId: string, change: Partial<{ x: number, y: number, rotation: number, width: number, depth: number, height: number, finishes: Partial<Record<string, Finish>> }>) {
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

/** A corner handle on the plan: the new size and the centre that keeps the opposite corner. */
function resize(target: PlanSelection, size: Omit<Sized, 'rotation'>) {
  if (target.kind === 'table') updateTable(target.id, size)
  else if (target.kind === 'item') updateItem(target.id, size)
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

// --- Typing a length on the plan's label (3A) ---

/** The edge whose length is being typed, where its label is on screen, and what's typed so far. */
const lengthEdit = ref<{ index: number, at: Point, value: number | undefined } | null>(null)
const lengthInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('lengthInput')
const EDGE_KINDS = [
  { value: 'wall', label: 'Wall' },
  { value: 'railing', label: 'Railing' },
  { value: 'open', label: 'Open' },
] as const
const EDGE_LENGTH_MIN_CM = 10
const EDGE_LENGTH_MAX_CM = 10_000

function editLength(index: number, at: Point) {
  const current = floor.value
  if (!current) return
  lengthEdit.value = { index, at, value: Math.round(edgeLength(current.outline, index)) }
  void nextTick(() => {
    lengthInput.value?.inputRef?.focus()
    lengthInput.value?.inputRef?.select()
  })
}

/** Enter or leaving the field sets the length (one undo step); Escape leaves it as it was. */
function applyLength() {
  const edit = lengthEdit.value
  lengthEdit.value = null
  const current = floor.value
  if (!edit || !current || typeof edit.value !== 'number' || !Number.isFinite(edit.value)) return
  const length = Math.min(EDGE_LENGTH_MAX_CM, Math.max(EDGE_LENGTH_MIN_CM, Math.round(edit.value)))
  if (length === Math.round(edgeLength(current.outline, edit.index))) return
  updateShape(setEdgeLength(shapeOf(current), edit.index, length))
}

watch(() => [mode.value, floor.value?.id], () => {
  lengthEdit.value = null
})

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
  pending.value = null
  if (mode.value === next) return finishTool()
  if (next === 'select' || next === 'hand') {
    finishTool()
    mode.value = next
    return
  }
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
async function placeLook(lookId: string, at: Point) {
  const look = findLook(props.looks, lookId)
  const choice = await pickModal.open({ lookName: look.name, tables: unplaced.value }).result
  if (!choice) return
  const tableId = choice === 'new' ? (await newTable())?.id : choice
  if (tableId && !placedIds.value.has(tableId)) placeTable(tableId, at, lookId)
}

/**
 * Duplicate look (2B): the same look, size and turn for another real table, beside this one. It
 * asks which table, as a look from the library does; it never copies this table or its QR code.
 */
async function duplicateLook(tableId: string) {
  const source = layout.value.placements.find(placement => placement.tableId === tableId)
  if (!source) return
  const choice = await pickModal.open({ lookName: findLook(props.looks, source.lookId).name, tables: unplaced.value }).result
  if (!choice) return
  const copyId = choice === 'new' ? (await newTable())?.id : choice
  // The dialog waited: read the original again (an undo may have taken it off the map meanwhile).
  const original = layout.value.placements.find(placement => placement.tableId === tableId)
  if (!copyId || !original || placedIds.value.has(copyId)) return
  const extent = placementExtent(original, findLook(props.looks, original.lookId))
  const at = besideOf(original, extent.width, extent.depth)
  const { floorId, rotation, width, depth, lookId } = original
  draft.change(next => next.placements.push({ tableId: copyId, floorId, ...at, rotation, width, depth, lookId }))
  props.editor.showFloor(floorId)
  selection.value = { kind: 'table', id: copyId }
}

/** Duplicate (furniture): a copy with the same size, turn and finishes, beside it. */
function duplicateItem(itemId: string) {
  const item = floor.value?.items.find(candidate => candidate.id === itemId)
  if (!item) return
  const id = newLayoutId('item')
  const at = besideOf(item, item.width, item.depth)
  changeFloor(target => target.items.push({ ...structuredClone(toRaw(item)), id, ...at }))
  selection.value = { kind: 'item', id }
}

// --- The cafe's own chair and fixture looks (step 3d) ---

const itemLookModal = overlay.create(ItemLookFormModal)
const isCustomItem = (look: ItemLook): look is CustomItemLook => 'version' in look
const selectedItemLook = computed(() => (selectedItem.value ? findItemLook(itemLooks.value, selectedItem.value.lookId) : undefined))
const finishSlots = computed(() => selectedItem.value && !selectedItemLook.value ? ITEM_SPECS[selectedItem.value.kind].slots : [])
/** The piece's look choices: its own finishes, or one of the cafe's looks of its kind. */
const OWN_FINISHES = 'own'
const itemLookItems = computed(() => {
  const item = selectedItem.value
  if (!item) return []
  return [{ label: 'Own finishes', value: OWN_FINISHES }, ...itemLooks.value.filter(look => look.kind === item.kind).map(look => ({ label: look.name, value: look.id }))]
})
const itemLookUsers = computed(() => {
  const item = selectedItem.value
  if (!item?.lookId) return 0
  return floors.value.flatMap(candidate => candidate.items).filter(other => other.lookId === item.lookId && other.id !== item.id).length
})

/**
 * Gives a piece one of the cafe's looks (its size becomes the look's, like a table's) or its own
 * finishes again, keeping how it looked: one source of finishes at a time.
 */
function setItemLook(itemId: string, lookId: string) {
  const look = lookId === OWN_FINISHES ? undefined : findItemLook(itemLooks.value, lookId)
  draft.change((next) => {
    const item = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === itemId)
    if (!item) return
    if (look) {
      Object.assign(item, { lookId: look.id, finishes: {}, width: look.defaultWidth, depth: look.defaultDepth, height: look.defaultHeight })
      return
    }
    item.finishes = { ...pieceFinishes(item, itemLooks.value) }
    delete item.lookId
  })
}

/** A new chair or fixture look; with `forItem`, that piece gets it at once (at its own size). */
async function newItemLook(options: { category?: LookCategory, from?: ItemLookSource, forItem?: string } = {}) {
  const { category, from, forItem } = options
  const saved = await itemLookModal.open({ category, from }).result
  if (!saved || !forItem) return
  draft.change((next) => {
    const item = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === forItem)
    if (item && item.kind === saved.kind) Object.assign(item, { lookId: saved.id, finishes: {} })
  })
}

function saveItemAsLook(item: LayoutItem) {
  if (!isItemLookKind(item.kind)) return
  void newItemLook({ from: { kind: item.kind, finishes: pieceFinishes(item, itemLooks.value), width: item.width, depth: item.depth, height: pieceHeight(item) }, forItem: item.id })
}

function editItemLook(look: ItemLook) {
  if (isCustomItem(look)) itemLookModal.open({ look })
}

// --- The cafe's own looks (step 3a) ---

const lookModal = overlay.create(LookFormModal)
const isCustom = (look: TableLook): look is CustomLook => 'version' in look

/** A new look, starting from `from`; with `forTable`, that table gets it at once. */
async function newLook(from?: TableLook, forTable?: string) {
  const saved = await lookModal.open({ from }).result
  if (!saved || !forTable) return
  // The look's own size is for new tables: this one keeps the size it has.
  updateTable(forTable, { lookId: saved.id, ...(saved.shape === 'round' && { depth: layout.value.placements.find(placement => placement.tableId === forTable)?.width }) })
}

function editLook(look: CustomLook) {
  lookModal.open({ look })
}

function editTable() {
  const table = selectedDiningTable.value
  if (table) formModal.open({ branchId: props.branchId, table })
}

function viewQr() {
  const table = selectedDiningTable.value
  if (table?.qrUrl) qrModal.open({ table: { ...table, qrUrl: table.qrUrl } })
}

type LibraryPiece = { kind: 'table', tableId: string } | { kind: 'look', lookId: string } | { kind: 'item', itemKind: ItemKind, lookId?: string }

function place(piece: LibraryPiece, at: Point) {
  if (piece.kind === 'table') placeTable(piece.tableId, at)
  else if (piece.kind === 'look') void placeLook(piece.lookId, at)
  else placeItem(piece.itemKind, at, piece.lookId)
}

const pending = shallowRef<LibraryPiece | null>(null)

function beginPlacement(piece: LibraryPiece) {
  // A drag that ended back on its card also clicks it.
  if (performance.now() < suppressClickUntil) return
  panelOpen.value = null
  mode.value = 'select'
  pending.value = piece
  nextTick(() => canvas.value?.focus())
}

function placePending(at?: Point) {
  const piece = pending.value
  if (!piece) return
  const point = at ?? canvas.value?.viewCenter() ?? { x: 0, y: 0 }
  pending.value = null
  place(piece, { x: snap(point.x), y: snap(point.y) })
}

function applyLook(tableId: string, lookId: string) {
  const look = findLook(props.looks, lookId)
  updateTable(tableId, { lookId: look.id, width: look.defaultWidth, depth: look.defaultDepth })
}

function chooseLook(lookId: string) {
  if (performance.now() < suppressClickUntil) return
  const placement = selectedPlacement.value
  if (placement) applyLook(placement.tableId, lookId)
  else beginPlacement({ kind: 'look', lookId })
}

// Dragging from the library: past a few pixels it's a drag (a ghost follows over the plan, drop
// places); a press that doesn't move is a click and places in the middle.
const ghost = ref<PlanGhost | null>(null)
let suppressClickUntil = 0
let libraryDrag: { pointerId: number, piece: LibraryPiece, start: Point, dragging: boolean } | null = null

function startLibraryDrag(event: PointerEvent, piece: LibraryPiece) {
  if (!isExpanded.value || event.button !== 0 || libraryDrag) return
  libraryDrag = { pointerId: event.pointerId, piece, start: { x: event.clientX, y: event.clientY }, dragging: false }
  window.addEventListener('pointermove', onLibraryMove)
  window.addEventListener('pointerup', onLibraryUp)
  window.addEventListener('pointercancel', onLibraryCancel)
}

function ghostOf(piece: LibraryPiece, at: Point): PlanGhost {
  if (piece.kind === 'item') {
    const look = findItemLook(itemLooks.value, piece.lookId)
    const spec = ITEM_SPECS[piece.itemKind]
    return { kind: 'item', itemKind: piece.itemKind, width: look?.defaultWidth ?? spec.width, depth: look?.defaultDepth ?? spec.depth, ...at }
  }
  if (piece.kind === 'look') return { kind: 'table', tableId: null, lookId: piece.lookId, ...at }
  return { kind: 'table', tableId: piece.tableId, lookId: NEW_TABLE_LOOK, ...at }
}

function onLibraryMove(event: PointerEvent) {
  if (libraryDrag?.pointerId !== event.pointerId) return
  if (!libraryDrag.dragging && Math.hypot(event.clientX - libraryDrag.start.x, event.clientY - libraryDrag.start.y) < 6) return
  libraryDrag.dragging = true
  const at = canvas.value?.toPlan(event.clientX, event.clientY, true)
  const fine = event.shiftKey ? FINE_GRID_CM : GRID_CM
  ghost.value = at ? ghostOf(libraryDrag.piece, { x: snap(at.x, fine), y: snap(at.y, fine) }) : null
}

function clearLibraryDrag() {
  window.removeEventListener('pointermove', onLibraryMove)
  window.removeEventListener('pointerup', onLibraryUp)
  window.removeEventListener('pointercancel', onLibraryCancel)
  libraryDrag = null
  ghost.value = null
}

function onLibraryCancel(event: PointerEvent) {
  if (libraryDrag?.pointerId === event.pointerId) clearLibraryDrag()
}

function onLibraryUp(event: PointerEvent) {
  const drag = libraryDrag
  if (drag?.pointerId !== event.pointerId) return
  const dropped = ghost.value
  clearLibraryDrag()
  // A press that didn't move is a click: the card's own button handles it, keyboard and pointer alike.
  if (!drag.dragging) return
  suppressClickUntil = performance.now() + 100
  event.preventDefault()
  if (!dropped || !canvas.value?.toPlan(event.clientX, event.clientY, true)) return
  mode.value = 'select'
  pending.value = null
  place(drag.piece, dropped)
}

onBeforeUnmount(clearLibraryDrag)

defineShortcuts({
  meta_z: () => props.active && draft.undo(),
  meta_shift_z: () => props.active && draft.redo(),
  meta_y: () => props.active && draft.redo(),
})

// --- Quick actions beside the selection (2B) ---

const planArea = useTemplateRef<HTMLElement>('planArea')
const quickBar = useTemplateRef<HTMLElement>('quickBar')
const { width: planWidth, height: planHeight } = useElementSize(planArea)
const { width: barWidth, height: barHeight } = useElementSize(quickBar)

/**
 * Below the selection, or above it where there's no room, kept inside the plan. None while the
 * selection is moved, turned or resized, or is off screen.
 */
const quickBarStyle = computed((): { left: string, top: string } | undefined => {
  const box = canvas.value?.selectionBox
  const area = { width: planWidth.value, height: planHeight.value }
  if (!box || box.right < 0 || box.bottom < 0 || box.left > area.width || box.top > area.height) return undefined
  // Clear of the corner handles' reach (16 px), and 8 px inside the plan's edges.
  const clear = 20
  const gap = 8
  const within = (value: number, size: number, room: number) => Math.min(Math.max(gap, value), Math.max(gap, room - size - gap))
  const below = box.bottom + clear
  const top = below + barHeight.value <= area.height - gap ? below : box.top - clear - barHeight.value
  return {
    left: `${within((box.left + box.right) / 2 - barWidth.value / 2, barWidth.value, area.width)}px`,
    top: `${within(top, barHeight.value, area.height)}px`,
  }
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

const drawTools = [
  { label: 'Draw outline', icon: 'i-lucide-pen-tool', onSelect: () => startTool('outline') },
  { label: 'Draw wall', icon: 'i-lucide-brick-wall', onSelect: () => startTool('wall') },
]
const pendingLabel = computed(() => {
  const piece = pending.value
  if (!piece) return ''
  if (piece.kind === 'table') return tableLabel(piece.tableId) ?? 'the table'
  if (piece.kind === 'look') return findLook(props.looks, piece.lookId).name
  return findItemLook(itemLooks.value, piece.lookId)?.name ?? ITEM_SPECS[piece.itemKind].label
})
</script>

<template>
  <ExploreLayoutSettings
    v-if="exploreEnabled"
    v-model:open="exploreOpen"
    :layout="layout"
    :has-pin="hasPin"
    @change="scene => draft.change(layout => { layout.scene = scene })"
  />
  <!-- The library (lg and up beside the plan; below, in a slide-over). -->
  <DefineLibrary>
    <div v-if="panel === 'floors'" class="flex flex-col gap-2">
      <div v-for="candidate in floors" :key="candidate.id">
        <UButton
          :label="candidate.name"
          :color="candidate.id === floor?.id ? 'primary' : 'neutral'"
          :variant="candidate.id === floor?.id ? 'soft' : 'ghost'"
          :aria-pressed="candidate.id === floor?.id"
          :data-testid="`floor-tab-${candidate.name}`"
          icon="i-lucide-layers"
          block
          class="justify-start"
          @click="selectFloor(candidate.id); panelOpen = null"
        >
          <template #trailing>
            <span class="ml-auto text-xs text-muted">{{ tablesOn(candidate.id).length }} tables</span>
          </template>
        </UButton>
        <div v-if="candidate.id === floor?.id" class="mt-1 ml-3 flex flex-col gap-1 border-l border-default pl-2">
          <UButton
            v-for="table in tablesOn(candidate.id)"
            :key="table.tableId"
            :label="tableLabel(table.tableId) ?? 'Unavailable table'"
            icon="i-lucide-table-2"
            :color="selection?.kind === 'table' && selection.id === table.tableId ? 'primary' : 'neutral'"
            variant="ghost"
            @click="selectPlaced({ kind: 'table', id: table.tableId }, candidate.id)"
          />
          <UButton
            v-for="item in candidate.items"
            :key="item.id"
            :label="ITEM_SPECS[item.kind].label"
            :icon="ITEM_ICONS[item.kind]"
            :color="selection?.kind === 'item' && selection.id === item.id ? 'primary' : 'neutral'"
            variant="ghost"
            @click="selectPlaced({ kind: 'item', id: item.id }, candidate.id)"
          />
          <UButton
            v-for="(wall, index) in candidate.walls"
            :key="wall.id"
            :label="`Interior wall ${index + 1}`"
            icon="i-lucide-brick-wall"
            :color="selection?.kind === 'wall' && selection.id === wall.id ? 'primary' : 'neutral'"
            variant="ghost"
            @click="selectPlaced({ kind: 'wall', id: wall.id }, candidate.id)"
          />
        </div>
      </div>
      <UButton
        label="Add floor"
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        :disabled="!canAddFloor(layout)"
        @click="addFloor(); panelOpen = null"
      />
    </div>
    <div v-else class="flex flex-col gap-4">
      <SearchInput
        v-model="search"
        :placeholder="panel === 'tables' ? 'Search tables…' : 'Search assets…'"
      />
      <UFieldGroup
        v-if="panel === 'assets'"
        aria-label="Asset types"
      >
        <UButton
          label="Objects"
          :variant="assetTab === 'objects' ? 'soft' : 'ghost'"
          :aria-pressed="assetTab === 'objects'"
          @click="assetTab = 'objects'; search = ''"
        />
        <UButton
          label="Finishes"
          :variant="assetTab === 'finishes' ? 'soft' : 'ghost'"
          :aria-pressed="assetTab === 'finishes'"
          @click="assetTab = 'finishes'; search = ''"
        />
      </UFieldGroup>
      <section v-if="panel === 'tables'" class="flex flex-col gap-2">
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
          v-if="!unplaced.some(table => matches(table.label))"
          class="text-sm text-muted"
        >
          {{ search ? 'No unplaced tables match.' : tables.length ? 'Every table is on the map.' : 'This branch has no tables yet.' }}
        </p>
        <div
          v-for="table in unplaced.filter(table => matches(table.label))"
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
            @click="beginPlacement({ kind: 'table', tableId: table.id })"
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

      <section v-if="panel === 'tables'" class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold text-highlighted">On plan</h2>
        <UButton
          v-for="table in placedTables"
          :key="table.id"
          :label="table.label"
          icon="i-lucide-table-2"
          :color="selection?.kind === 'table' && selection.id === table.id ? 'primary' : 'neutral'"
          variant="ghost"
          @click="selectPlaced({ kind: 'table', id: table.id }, table.floorId)"
        >
          <template #trailing>
            <span class="ml-auto text-xs text-muted">{{ table.floorName }}</span>
          </template>
        </UButton>
        <p v-if="!placedTables.length" class="text-sm text-muted">No placed tables match.</p>
      </section>

      <section v-if="panel === 'assets' && assetTab === 'finishes'" class="flex flex-col gap-3">
        <p v-if="!finishSlots.length" class="text-sm text-muted">Select a piece with editable finishes to apply one here.</p>
        <div v-for="slot in finishSlots" :key="slot.key" class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold text-highlighted">{{ slot.label }}</h2>
          <UButton
            v-for="finish in slot.options.filter(option => matches(swatch(option).label))"
            :key="finish"
            :label="swatch(finish).label"
            color="neutral"
            variant="outline"
            :aria-pressed="itemFinish(selectedItem!.kind, selectedItem!.finishes, slot.key) === finish"
            @click="updateItem(selectedItem!.id, { finishes: { ...selectedItem!.finishes, [slot.key]: finish } })"
          >
            <template #leading>
              <span class="size-4 rounded-full border border-default" :style="{ background: swatch(finish).color }" />
            </template>
          </UButton>
        </div>
      </section>

      <section v-if="panel === 'assets' && assetTab === 'objects' && (!search || looks.some(look => matches(look.name)))" class="flex flex-col gap-2">
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Table looks · chairs follow the table’s seats
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <div
            v-for="look in looks.filter(look => matches(look.name))"
            :key="look.id"
            class="relative"
          >
            <button
              type="button"
              class="flex size-full touch-none flex-col items-start gap-1 rounded-md border border-default p-2 text-left text-sm text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :data-testid="isCustom(look) ? `look-custom-${look.name}` : `look-${look.id}`"
              @pointerdown="startLibraryDrag($event, { kind: 'look', lookId: look.id })"
              @click="chooseLook(look.id)"
            >
              <!-- A custom look's photo of the real piece (step 3b); the plan and 3D keep the simple shape. -->
              <img
                v-if="look.photo"
                :src="look.photo.url"
                alt=""
                draggable="false"
                class="aspect-4/3 w-full rounded-sm bg-muted object-cover"
                data-testid="look-photo"
              >
              <UIcon
                v-else
                :name="LOOK_ICONS[look.shape]"
                class="size-5 text-primary"
              />
              <span class="break-words">{{ look.name }}</span>
              <span class="text-xs text-muted">{{ look.shape === 'round' ? `Ø ${look.defaultWidth} cm` : `${look.defaultWidth} × ${look.defaultDepth}` }}</span>
            </button>
            <UButton
              v-if="isCustom(look)"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              class="absolute top-1 right-1"
              :class="look.photo && 'bg-default/80'"
              :aria-label="`Edit the look ${look.name}`"
              @click="editLook(look)"
            />
          </div>
        </div>
        <UButton
          label="New look"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          class="self-start"
          @click="newLook()"
        />
      </section>

      <section
        v-for="category in (panel === 'assets' && assetTab === 'objects' ? catalog.filter(category => category.specs.some(spec => matches(spec.label)) || itemLooksIn(category.key).some(look => matches(look.name))) : [])"
        :key="category.key"
        class="flex flex-col gap-2"
      >
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          {{ category.library }}
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="spec in category.specs.filter(spec => matches(spec.label))"
            :key="spec.kind"
            type="button"
            class="flex touch-none flex-col items-start gap-1 rounded-md border border-default p-2 text-left text-sm text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :data-testid="`catalog-${spec.kind}`"
            @pointerdown="startLibraryDrag($event, { kind: 'item', itemKind: spec.kind })"
            @click="beginPlacement({ kind: 'item', itemKind: spec.kind })"
          >
            <img
              v-if="spec.photo"
              :src="spec.photo"
              alt=""
              draggable="false"
              loading="lazy"
              class="aspect-4/3 w-full rounded-sm bg-muted object-cover"
            >
            <UIcon
              v-else
              :name="ITEM_ICONS[spec.kind]"
              class="size-5 text-muted"
            />
            <span>{{ spec.label }}</span>
            <span
              v-if="spec.category !== 'figures'"
              class="text-xs text-muted"
            >{{ spec.footprint === 'round' ? `Ø ${spec.width} cm` : `${spec.width} × ${spec.depth}` }}</span>
          </button>
          <!-- The cafe's own looks of this category (step 3d): shared by the pieces placed with them. -->
          <div
            v-for="look in itemLooksIn(category.key).filter(look => matches(look.name))"
            :key="look.id"
            class="relative"
          >
            <button
              type="button"
              class="flex size-full touch-none flex-col items-start gap-1 rounded-md border border-default p-2 text-left text-sm text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :data-testid="`item-look-${look.name}`"
              @pointerdown="startLibraryDrag($event, { kind: 'item', itemKind: look.kind, lookId: look.id })"
              @click="beginPlacement({ kind: 'item', itemKind: look.kind, lookId: look.id })"
            >
              <img
                v-if="look.photo"
                :src="look.photo.url"
                alt=""
                draggable="false"
                loading="lazy"
                class="aspect-4/3 w-full rounded-sm bg-muted object-cover"
              >
              <UIcon
                v-else
                :name="ITEM_ICONS[look.kind]"
                class="size-5 text-primary"
              />
              <span class="break-words">{{ look.name }}</span>
              <span class="text-xs text-muted">{{ ITEM_SPECS[look.kind].footprint === 'round' ? `Ø ${look.defaultWidth} cm` : `${look.defaultWidth} × ${look.defaultDepth}` }}</span>
            </button>
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              class="absolute top-1 right-1"
              :class="look.photo && 'bg-default/80'"
              :aria-label="`Edit the look ${look.name}`"
              @click="editItemLook(look)"
            />
          </div>
        </div>
        <UButton
          v-if="isLookCategory(category.key)"
          :label="`New ${category.noun} look`"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          class="self-start"
          @click="newItemLook({ category: category.key })"
        />
      </section>
      <UButton
        v-if="panel === 'assets'"
        label="Manage looks"
        icon="i-lucide-swatch-book"
        color="neutral"
        variant="link"
        size="sm"
        class="self-start px-0"
        :to="tenantPath('/admin/branches/looks')"
      />
    </div>
  </DefineLibrary>

  <!-- What's selected (md and up beside the plan; below, in a slide-over). -->
  <DefineMovePad>
    <div
      class="flex flex-wrap items-center gap-3 rounded-lg border border-default bg-default p-2"
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
            class="lg:hidden"
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
  </DefineMovePad>

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
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="X (cm)">
          <UInputNumber
            :model-value="selectedPlacement.x"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            :step="5"
            @update:model-value="value => setNumber(value, x => move(selection!, { x, y: selectedPlacement!.y }))"
          />
        </UFormField>
        <UFormField label="Y (cm)">
          <UInputNumber
            :model-value="selectedPlacement.y"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            :step="5"
            @update:model-value="value => setNumber(value, y => move(selection!, { x: selectedPlacement!.x, y }))"
          />
        </UFormField>
      </div>
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
        <div class="flex items-center gap-2">
          <img
            v-if="selectedLook.photo"
            :src="selectedLook.photo.url"
            :alt="`Photo of ${selectedLook.name}`"
            class="aspect-4/3 w-14 shrink-0 rounded-md bg-muted object-cover"
            data-testid="selected-look-photo"
          >
          <USelect
            :model-value="selectedPlacement.lookId"
            :items="lookItems"
            class="min-w-0 flex-1"
            @update:model-value="value => applyLook(selectedPlacement!.tableId, String(value))"
          />
        </div>
      </UFormField>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="isCustom(selectedLook)"
          label="Edit look"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          @click="editLook(selectedLook)"
        />
        <UButton
          label="Save as new look"
          icon="i-lucide-copy-plus"
          color="neutral"
          variant="outline"
          size="sm"
          @click="newLook(selectedLook, selectedPlacement.tableId)"
        />
      </div>
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
            {{ selectedItem.kind === 'stairs' ? 'Structure' : isFigureKind(selectedItem.kind) ? 'Decoration' : 'Furniture' }} · no QR code
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
      <div
        v-if="!isFigureKind(selectedItem.kind)"
        class="grid grid-cols-2 gap-3"
      >
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
        <UFormField
          v-if="isItemLookKind(selectedItem.kind)"
          label="Height (cm)"
          :help="heightRangeMessage(selectedItem.kind)"
        >
          <UInputNumber
            :model-value="pieceHeight(selectedItem)"
            :min="ITEM_HEIGHTS[selectedItem.kind].min"
            :max="ITEM_HEIGHTS[selectedItem.kind].max"
            :step="5"
            @update:model-value="value => setNumber(value, height => updateItem(selectedItem!.id, { height }))"
          />
        </UFormField>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="X (cm)">
          <UInputNumber
            :model-value="selectedItem.x"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            :step="5"
            @update:model-value="value => setNumber(value, x => move(selection!, { x, y: selectedItem!.y }))"
          />
        </UFormField>
        <UFormField label="Y (cm)">
          <UInputNumber
            :model-value="selectedItem.y"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            :step="5"
            @update:model-value="value => setNumber(value, y => move(selection!, { x: selectedItem!.x, y }))"
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
      <template v-if="isItemLookKind(selectedItem.kind)">
        <UFormField
          label="Look"
          :help="selectedItemLook
            ? `${itemLookUsers ? `Also used by ${itemLookUsers} ${itemLookUsers === 1 ? 'piece' : 'pieces'} here. ` : ''}Editing a look changes every piece that uses it.`
            : 'Its own finishes, below.'"
        >
          <div class="flex items-center gap-2">
            <img
              v-if="(selectedItemLook?.photo?.url ?? ITEM_SPECS[selectedItem.kind].photo)"
              :src="selectedItemLook?.photo?.url ?? ITEM_SPECS[selectedItem.kind].photo!"
              :alt="`Photo of ${selectedItemLook?.name ?? ITEM_SPECS[selectedItem.kind].label}`"
              class="aspect-4/3 w-14 shrink-0 rounded-md bg-muted object-cover"
              data-testid="selected-item-photo"
            >
            <USelect
              :model-value="selectedItemLook?.id ?? OWN_FINISHES"
              :items="itemLookItems"
              class="min-w-0 flex-1"
              @update:model-value="value => setItemLook(selectedItem!.id, String(value))"
            />
          </div>
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="selectedItemLook"
            label="Edit look"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            size="sm"
            @click="editItemLook(selectedItemLook)"
          />
          <UButton
            label="Save as new look"
            icon="i-lucide-copy-plus"
            color="neutral"
            variant="outline"
            size="sm"
            @click="saveItemAsLook(selectedItem)"
          />
        </div>
      </template>
      <div
        v-for="slot in (selectedItemLook ? [] : ITEM_SPECS[selectedItem.kind].slots)"
        :key="slot.key"
        class="flex flex-col gap-2"
        role="group"
        :aria-label="slot.label"
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
    <div v-else-if="floor" class="flex flex-col gap-3">
      <p class="text-sm font-semibold text-highlighted">{{ floor.name }} floor</p>
      <UFormField label="Floor height (cm)">
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
        @update:model-value="setRoof"
      />
      <p class="text-sm text-muted">Select an object on the plan to edit its properties.</p>
    </div>
    <ReuseMovePad
      v-if="isExpanded && mode === 'select' && (selectedPlacement || selectedItem)"
      class="mt-3"
    />
  </DefineDetails>

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
    v-else-if="!editor.ready.value"
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
    class="relative flex h-full min-h-0 pb-12 sm:pb-0"
  >
    <nav aria-label="Studio panels" class="absolute inset-x-0 bottom-0 z-10 flex h-12 shrink-0 items-center justify-around border-t border-default bg-elevated sm:static sm:h-auto sm:w-16 sm:flex-col sm:justify-start sm:gap-1 sm:border-t-0 sm:border-r sm:p-1">
      <UButton
        v-for="option in panels"
        :key="option.value"
        :label="option.label"
        :icon="option.icon"
        :color="(isExpanded ? !focusMode && (option.value === panel || option.value === 'properties') : panelOpen === option.value) ? 'primary' : 'neutral'"
        :variant="(isExpanded ? !focusMode && (option.value === panel || option.value === 'properties') : panelOpen === option.value) ? 'soft' : 'ghost'"
        :aria-pressed="isExpanded ? !focusMode && (option.value === panel || option.value === 'properties') : panelOpen === option.value"
        size="sm"
        class="flex-col gap-1 sm:w-full"
        :class="option.value === 'properties' && 'sm:mt-auto'"
        :ui="{ label: 'text-xs', leadingIcon: 'size-4' }"
        @click="showPanel(option.value)"
      />
      <UButton
        :label="focusMode ? 'Show panels' : 'Hide panels'"
        icon="i-lucide-panels-left-right"
        color="neutral"
        variant="ghost"
        size="sm"
        class="hidden flex-col gap-1 lg:flex"
        :ui="{ label: 'text-xs whitespace-normal text-center', leadingIcon: 'size-4' }"
        @click="focusMode = !focusMode"
      />
    </nav>
    <aside v-if="!focusMode" :aria-label="panelTitle" class="hidden w-48 shrink-0 overflow-y-auto border-r border-default bg-default p-3 lg:block xl:w-60">
      <h2 class="mb-3 border-b border-default pb-3 text-sm font-semibold text-highlighted">{{ panelTitle }}</h2>
      <ReuseLibrary />
    </aside>
    <AppDrawer
      v-if="isCompact"
      :open="panelOpen !== null"
      :title="panelTitle"
      @update:open="open => !open && (panelOpen = null)"
    >
      <template #body>
        <ReuseDetails v-if="detailsOpen" />
        <ReuseLibrary v-else />
      </template>
    </AppDrawer>
    <AppSlideover
      v-else-if="!isExpanded"
      :open="panelOpen !== null"
      :title="panelTitle"
      :side="detailsOpen ? 'right' : 'left'"
      @update:open="open => !open && (panelOpen = null)"
    >
      <template #body>
        <ReuseDetails v-if="detailsOpen" />
        <ReuseLibrary v-else />
      </template>
    </AppSlideover>

    <!-- The plan -->
    <main
      ref="planArea"
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
        :placing="!!pending"
        @place="placePending"
        @cancel-place="pending = null"
        @select="selection = $event"
        @move="move"
        @rotate="rotate"
        @resize="resize"
        @remove="remove"
        @shape="updateShape"
        @add-wall="addWall"
        @edit-length="editLength"
      />

      <!-- Draw outline: the clicked length label becomes a field (3A). -->
      <form
        v-if="lengthEdit"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${lengthEdit.at.x}px`, top: `${lengthEdit.at.y}px` }"
        data-testid="edge-length-edit"
        @submit.prevent="applyLength()"
      >
        <UInput
          ref="lengthInput"
          v-model.number="lengthEdit.value"
          type="number"
          inputmode="numeric"
          :min="EDGE_LENGTH_MIN_CM"
          :max="EDGE_LENGTH_MAX_CM"
          size="sm"
          class="w-28 shadow-md"
          :aria-label="`${names[lengthEdit.index] ?? 'Edge'} length (cm)`"
          :ui="{ trailing: 'pointer-events-none text-xs text-muted' }"
          @blur="applyLength()"
          @keydown.esc.stop.prevent="lengthEdit = null"
        >
          <template #trailing>
            cm
          </template>
        </UInput>
      </form>

      <!-- Quick actions next to the selection (2B): the common moves without the panel. -->
      <div
        v-if="mode === 'select' && quickBarStyle && (selectedPlacement || selectedItem)"
        ref="quickBar"
        role="toolbar"
        :aria-label="selectedPlacement ? `${tableLabel(selectedPlacement.tableId) ?? 'Table'} quick actions` : 'Furniture quick actions'"
        class="absolute flex items-center gap-0.5 rounded-lg border border-default bg-default p-1 shadow-md"
        :style="quickBarStyle"
        data-testid="quick-actions"
      >
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="ghost"
          aria-label="Rotate 90°"
          @click="turn(90)"
        >
          <span class="hidden sm:inline">Rotate 90°</span>
        </UButton>
        <USeparator
          orientation="vertical"
          class="h-5"
        />
        <UButton
          v-if="selectedPlacement"
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          aria-label="Duplicate look"
          @click="duplicateLook(selectedPlacement.tableId)"
        >
          <span class="hidden sm:inline">Duplicate look</span>
        </UButton>
        <UButton
          v-else-if="selectedItem"
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          aria-label="Duplicate"
          @click="duplicateItem(selectedItem.id)"
        >
          <span class="hidden sm:inline">Duplicate</span>
        </UButton>
        <USeparator
          orientation="vertical"
          class="h-5"
        />
        <UButton
          :icon="selectedPlacement ? 'i-lucide-map-pin-off' : 'i-lucide-trash-2'"
          color="neutral"
          variant="ghost"
          :aria-label="selectedPlacement ? 'Remove from map' : 'Delete'"
          @click="remove(selection!)"
        >
          <span class="hidden sm:inline">{{ selectedPlacement ? 'Remove from map' : 'Delete' }}</span>
        </UButton>
      </div>
      <div
        v-else-if="mode === 'select' && quickBarStyle && selectedWall"
        ref="quickBar"
        role="toolbar"
        aria-label="Wall quick actions"
        class="absolute flex items-center rounded-lg border border-default bg-default p-1 shadow-md"
        :style="quickBarStyle"
        data-testid="quick-actions"
      >
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          aria-label="Delete wall"
          @click="remove(selection!)"
        >
          <span class="hidden sm:inline">Delete wall</span>
        </UButton>
      </div>
      <div
        v-else-if="mode === 'select' && quickBarStyle && floor && selectedEdge !== undefined"
        ref="quickBar"
        role="toolbar"
        :aria-label="`${names[selectedEdge] ?? 'Edge'} quick actions`"
        class="absolute flex items-center gap-0.5 rounded-lg border border-default bg-default p-1 shadow-md"
        :style="quickBarStyle"
        data-testid="quick-actions"
      >
        <UFieldGroup
          role="group"
          aria-label="Edge type"
        >
          <UButton
            v-for="kind in EDGE_KINDS"
            :key="kind.value"
            :label="kind.label"
            :color="floor.edges[selectedEdge]?.kind === kind.value ? 'primary' : 'neutral'"
            :variant="floor.edges[selectedEdge]?.kind === kind.value ? 'soft' : 'ghost'"
            :aria-pressed="floor.edges[selectedEdge]?.kind === kind.value"
            @click="updateShape(setEdgeKind(shapeOf(floor), selectedEdge, kind.value))"
          />
        </UFieldGroup>
        <template v-if="floor.edges[selectedEdge]?.kind !== 'open'">
          <USeparator
            orientation="vertical"
            class="h-5"
          />
          <UButton
            icon="i-lucide-door-open"
            color="neutral"
            variant="ghost"
            :aria-label="`Add a ${floor.edges[selectedEdge]?.kind === 'railing' ? 'gate' : 'door'}`"
            :disabled="!openingFits(shapeOf(floor), selectedEdge, 'door')"
            @click="updateShape(addOpening(shapeOf(floor), selectedEdge, 'door', newLayoutId('door')))"
          >
            <span class="hidden sm:inline">{{ floor.edges[selectedEdge]?.kind === 'railing' ? 'Gate' : 'Door' }}</span>
          </UButton>
          <UButton
            v-if="floor.edges[selectedEdge]?.kind === 'wall'"
            icon="i-lucide-app-window"
            color="neutral"
            variant="ghost"
            aria-label="Add a window"
            :disabled="!openingFits(shapeOf(floor), selectedEdge, 'window')"
            @click="updateShape(addOpening(shapeOf(floor), selectedEdge, 'window', newLayoutId('window')))"
          >
            <span class="hidden sm:inline">Window</span>
          </UButton>
        </template>
      </div>

      <div class="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <!-- A tool's bar replaces the floor bar while it's open (3A, 9A). -->
        <div
          v-if="mode === 'outline' || mode === 'wall'"
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
            <USelect
              :model-value="floor.id"
              :items="floorItems"
              aria-label="Active floor"
              size="sm"
              @update:model-value="selectFloor"
            />
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
            <USwitch
              v-if="floorIndex > 0"
              v-model="showBelow"
              label="Floor below"
              size="sm"
              class="px-1"
            />
          </div>
          <UButton
            v-if="exploreEnabled"
            label="Explore settings"
            icon="i-lucide-map-pin"
            color="neutral"
            variant="outline"
            size="sm"
            class="pointer-events-auto bg-default"
            :ui="{ label: 'max-sm:sr-only' }"
            @click="exploreOpen = true"
          />
        </div>

        <UAlert
          v-if="placementAlerts.length && mode === 'select'"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          class="pointer-events-auto max-w-xl"
          :title="`Check placement on ${floor.name}`"
          :description="`${listLabels(placementAlerts.slice(0, 3).map(entry => entry.label))}${placementAlerts.length > 3 ? ` (+${placementAlerts.length - 3} more)` : ''}. Highlighted pieces overlap or extend outside the floor. You can still save.`"
          :actions="[{ label: 'Show', color: 'neutral', variant: 'outline', onClick: () => { selection = placementAlerts[0]!.selection } }]"
          data-testid="placement-warning"
        />
      </div>

      <!-- How the tool works (3A, 9A). -->
      <div
        v-if="mode === 'outline' || mode === 'wall'"
        class="pointer-events-none absolute bottom-28 left-2 flex max-w-60 flex-col gap-1 rounded-lg border border-default bg-default px-3 py-2 text-xs text-toned shadow-sm"
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

      <div v-if="mode === 'select' && !pending && !isExpanded && (selectedPlacement || selectedItem)" class="absolute bottom-16 left-2 max-w-52 shadow-md">
        <ReuseMovePad />
      </div>
      <UButton
        v-else-if="mode === 'select' && !pending && !isExpanded && selection"
        label="Details"
        color="neutral"
        variant="outline"
        class="absolute bottom-16 left-2 shadow-sm lg:hidden"
        @click="detailsOpen = true"
      />
      <div class="absolute inset-x-2 bottom-2 flex justify-center sm:bottom-3">
        <UFieldGroup
          class="max-w-full rounded-lg border border-default bg-default p-1 shadow-sm"
          aria-label="Canvas tools"
        >
          <UButton
            icon="i-lucide-mouse-pointer-2"
            label="Select"
            :variant="mode === 'select' ? 'soft' : 'ghost'"
            :color="mode === 'select' ? 'primary' : 'neutral'"
            :aria-pressed="mode === 'select'"
            :ui="{ label: 'max-xl:sr-only' }"
            @click="startTool('select')"
          />
          <UButton
            icon="i-lucide-hand"
            label="Hand"
            :variant="mode === 'hand' ? 'soft' : 'ghost'"
            :color="mode === 'hand' ? 'primary' : 'neutral'"
            :aria-pressed="mode === 'hand'"
            :ui="{ label: 'max-xl:sr-only' }"
            @click="startTool('hand')"
          />
          <UDropdownMenu
            :items="drawTools"
            :content="{ side: 'top' }"
          >
            <UButton
              icon="i-lucide-pen-tool"
              label="Draw"
              color="neutral"
              variant="ghost"
              :ui="{ label: 'max-xl:sr-only' }"
            />
          </UDropdownMenu>
          <UButton
            icon="i-lucide-undo-2"
            color="neutral"
            variant="ghost"
            aria-label="Undo"
            :disabled="!draft.canUndo.value"
            @click="draft.undo()"
          />
          <UButton
            icon="i-lucide-redo-2"
            color="neutral"
            variant="ghost"
            aria-label="Redo"
            :disabled="!draft.canRedo.value"
            @click="draft.redo()"
          />
        </UFieldGroup>
      </div>
      <div class="absolute right-2 bottom-16 flex items-center gap-1 rounded-lg border border-default bg-default p-1 shadow-sm">
        <UButton
          icon="i-lucide-zoom-out"
          color="neutral"
          variant="ghost"
          aria-label="Zoom out"
          @click="canvas?.zoom(-1)"
        />
        <span class="text-xs tabular-nums text-muted">{{ canvas?.zoomLevel ?? 100 }}%</span>
        <UButton
          icon="i-lucide-zoom-in"
          color="neutral"
          variant="ghost"
          aria-label="Zoom in"
          @click="canvas?.zoom(1)"
        />
        <UButton
          icon="i-lucide-scan"
          color="neutral"
          variant="ghost"
          aria-label="Fit to screen"
          @click="canvas?.fit()"
        />
      </div>
      <div v-if="pending" class="absolute inset-x-2 bottom-28 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-default bg-default p-2 shadow-sm">
        <span class="text-sm text-toned" role="status">Click or tap the plan to place {{ pendingLabel }}.</span>
        <UButton
          label="Place at center"
          color="neutral"
          variant="outline"
          @click="placePending()"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="pending = null"
        />
      </div>
    </main>

    <aside v-if="!focusMode" aria-label="Properties" class="hidden w-60 shrink-0 overflow-y-auto border-l border-default bg-default p-3 lg:block xl:w-72">
      <h2 class="mb-3 border-b border-default pb-3 text-sm font-semibold text-highlighted">Properties</h2>
      <ReuseDetails />
    </aside>
  </div>
</template>
