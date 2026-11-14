<script setup lang="ts">
import StudioNumberField from './StudioNumberField.vue'
/**
 * Design shop (D273, frames 1–3, 6A–6C, 9A–9C): a branch's saved layout with its real tables. The
 * library (Unplaced tables, table looks, furniture), the floor plan with its floors, Draw outline
 * and Draw wall, and the panel for what's selected. Every change goes through the editor's draft
 * (one undo step each) and is saved with Studio's Save layout (on the canvas, D277). Pieces arrive by dragging
 * from the library or with Place on map, then move by drag, the arrow keys or typed X and Y in
 * Properties, so the editor works without dragging on touch, with a keyboard and in the e2e tests.
 */
import { createReusableTemplate, useElementSize, useEventListener, useMediaQuery } from '@vueuse/core'
import type { CommandPaletteGroup, ContextMenuItem, DropdownMenuItem } from '@nuxt/ui'
import type { DiningTable } from '#shared/contracts/branches'
import { edgeLength, FLOOR_HEIGHT_MAX_CM, floorPageId, isSimpleOutline, SHAPE_ARC, wallKind, isFigureKind, ITEM_SIZE_MAX_CM, ITEM_SIZE_MIN_CM, isItemLookKind, isShapeKind, itemHeightRange, LAYOUT_MAX_EXTENT_CM, LAYOUT_MAX_FLOORS, LAYOUT_MAX_PAGES, layoutPages, PAGE_NAME_MAX, SHAPE_NAME_MAX } from '#shared/contracts/shop-layout'
import type { CustomItemLook, CustomLook, Finish, Floor, LayoutGroup, Wall, ItemKind, ItemLook, LayoutItem, LayoutTable, Point, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import type { LayoutEditor } from '../composables/useLayoutEditor'
import { useLayoutGroupMutations, useLayoutGroups } from '../composables/useBranches'
import { losesStreetDoor } from '../composables/useLayoutDraft'
import type { ItemCategory, LookCategory } from '../designer/catalog'
import type { AlignEdge, PlanClipboard } from '../designer/group'
import { CATEGORIES, FINISH_SWATCHES, LOOK_CATEGORIES, findItemLook, findLook, ITEM_SPECS, itemFinish, keepsCircle, NEW_TABLE_LOOK, pieceFinishes, pieceHeight } from '../designer/catalog'
import { fittedRadius, maxRadius, polygonShape } from '../designer/shapes'
import type { ShapeEdit } from '../designer/shapes'
import { besideOf, boundsOf, floorPoints, newLayoutId, nextSnapStep, normalizeRotation, placementExtent, snap, SNAP_CM } from '../designer/geometry'
import type { Bounds, Sized } from '../designer/geometry'
import { areaM2, edgeNames, setEdgeLength, shapeOf, withShape } from '../designer/outline'
import type { FloorShape } from '../designer/outline'
import type { PlanGhost, PlanMode, PlanSelection } from '../designer/plan'
import { alignOffsets, cycleSelection, distributeOffsets, duplicateSelected, groupFromSelection, pasteClipboard, placeGroup, removeSelected, shiftSelected, turnSelected } from '../designer/group'
import { addRoom } from '../designer/rooms'
import { canAddFloor, newFloor } from '../designer/starters'
import { addPage, besideFrames, effectiveFrames, floorsOnPage, framePlace, removePage, renamePage, setFloorPage } from '../designer/pages'
import { addWallOpening, copyStructure, setWallKind, wallOpeningFits } from '../designer/walls'
import type { Starter } from '../designer/starters'
import WallPanel from './WallPanel.vue'
import SaveGroupModal from './SaveGroupModal.vue'
import ExploreLayoutSettings from './ExploreLayoutSettings.vue'
import ItemLookFormModal from './ItemLookFormModal.vue'
import type { ItemLookSource } from './ItemLookFormModal.vue'
import FloorPlanCanvas from './FloorPlanCanvas.vue'
import StudioLayerRow from './StudioLayerRow.vue'
import StudioCommands from './StudioCommands.vue'
import LayoutStarterPicker from './LayoutStarterPicker.vue'
import LookFormModal from './LookFormModal.vue'
import PickTableModal from './PickTableModal.vue'
import StudioLooksPanel from './StudioLooksPanel.vue'
import StudioToolbar from './StudioToolbar.vue'
import { ShortcutsHelp } from '#components'
import { STUDIO_DRAG_KEYS, STUDIO_SHORTCUTS, STUDIO_SIDEBAR } from './studio'
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
/** Studio's view (D277): the toolbar's 2D and 3D switch it. */
const view = defineModel<'design' | '3d'>('view', { required: true })
/** The left sidebar on a wide screen (Studio owns it, so 3D keeps the same choice). */
const sidebarOpen = defineModel<boolean>('sidebar', { default: true })
/** The sidebar's width in px as resized here: 3D shows its sidebar at the same width. */
const sidebarWidth = defineModel<number>('sidebarWidth', { default: STUDIO_SIDEBAR.initial })
defineSlots<{
  /** Studio's header at the top of the sidebar. `collapsible`: it may offer Hide sidebar. */
  'sidebar-header'?: (props: { collapsible: boolean }) => unknown
  /** Studio's actions at the canvas's top right (Save layout). */
  'actions'?: () => unknown
}>()

const exploreEnabled = useRuntimeConfig().public.explore
const exploreOpen = ref(false)
const toast = useToast()
const draft = props.editor.draft
const layout = computed(() => draft.layout.value)
const tables = computed(() => props.editor.tables.value)
const floors = computed(() => layout.value.floors)
const floor = computed(() => floors.value.find(candidate => candidate.id === props.editor.floorId.value) ?? floors.value[0])
const floorIndex = computed(() => (floor.value ? floors.value.indexOf(floor.value) : -1))
const selection = props.editor.selection
/** Two or more selected together (D278), or empty. */
const group = props.editor.group
const multi = computed(() => group.value.length > 1)
const inGroup = (target: PlanSelection) => multi.value && group.value.some(member => member.kind === target.kind && member.id === target.id)
const showBelow = ref(true)
const mode = ref<PlanMode>('select')
const canvas = useTemplateRef<InstanceType<typeof FloorPlanCanvas>>('canvas')
const { isCompact, isExpanded } = useLayoutContext()

// --- The resizable sidebar (D277) ---

const splitter = useTemplateRef<{ $el?: HTMLElement, panelsRef: { collapse: () => void, expand: () => void, isCollapsed: boolean }[] }>('splitter')
const sidebarElement = useTemplateRef<HTMLElement>('sidebarElement')
const sidebarShown = computed(() => isExpanded.value && sidebarOpen.value)
const splitItems = [
  { id: 'studio-sidebar', slot: 'sidebar', sizeUnit: 'px' as const, defaultSize: STUDIO_SIDEBAR.initial, minSize: STUDIO_SIDEBAR.min, maxSize: STUDIO_SIDEBAR.max, collapsible: true, collapsedSize: 0, class: 'overflow-hidden' },
  { id: 'studio-canvas', slot: 'canvas', class: 'min-w-0' },
]

// Hide sidebar and narrow screens collapse the panel; the plan's panel is never rendered again.
watch([sidebarShown, splitter], ([shown, group]) => {
  const panel = group?.panelsRef[0]
  if (!panel || panel.isCollapsed === !shown) return
  if (shown) panel.expand()
  else panel.collapse()
}, { flush: 'post', immediate: true })

// Nuxt UI's splitter gives its handle no name: a focusable separator needs one.
watch(splitter, (group) => {
  group?.$el?.querySelector('[data-slot="handle"]')?.setAttribute('aria-label', 'Resize sidebar')
}, { flush: 'post' })

const { width: measuredSidebar } = useElementSize(sidebarElement, undefined, { box: 'border-box' })
watch(measuredSidebar, (width) => {
  if (width >= STUDIO_SIDEBAR.min) sidebarWidth.value = Math.round(width)
})
const panels = [
  { value: 'floors', label: 'Floors', icon: 'i-lucide-layers' },
  { value: 'tables', label: 'Tables', icon: 'i-lucide-table-2' },
  { value: 'assets', label: 'Assets', icon: 'i-lucide-box' },
  { value: 'looks', label: 'Manage looks', icon: 'i-lucide-swatch-book' },
] as const
type Panel = typeof panels[number]['value']
const panel = ref<Panel>('floors')
/** Below 1024 px the sidebar and Properties open over the plan, one at a time (D277). */
const sheet = ref<'sidebar' | 'properties' | null>(null)
const detailsOpen = computed({
  get: () => sheet.value === 'properties',
  set: open => sheet.value = open ? 'properties' : null,
})
const search = ref('')
const panelTitle = computed(() => panels.find(option => option.value === panel.value)?.label ?? 'Floors')
const matches = (label: string) => label.toLowerCase().includes(search.value.trim().toLowerCase())

function showPanel(next: Panel) {
  if (next === panel.value) return
  panel.value = next
  search.value = ''
  stopFind()
}

// --- Find in Floors (D277): the floors, and the named pieces on the floor shown ---

const finding = ref(false)
const findQuery = ref('')
const findMatches = (label: string) => label.toLowerCase().includes(findQuery.value.trim().toLowerCase())
const pieceLabel = (item: LayoutItem) => item.name ?? findItemLook(itemLooks.value, item.lookId)?.name ?? ITEM_SPECS[item.kind].label
const foundFloors = computed(() => floors.value.filter(candidate => findMatches(candidate.name)))
const foundPieces = computed(() => {
  const current = floor.value
  if (!current || !findQuery.value.trim()) return []
  return [
    ...tablesOn(current.id).map(placement => ({ selection: { kind: 'table' as const, id: placement.tableId }, label: tableLabel(placement.tableId) ?? 'Unavailable table', icon: 'i-lucide-table-2' })),
    ...current.items.map(item => ({ selection: { kind: 'item' as const, id: item.id }, label: pieceLabel(item), icon: ITEM_ICONS[item.kind] })),
    ...current.walls.map((wall, index) => ({ selection: { kind: 'wall' as const, id: wall.id }, label: wallLabel(current.walls, index), icon: 'i-lucide-brick-wall' })),
  ].filter(piece => findMatches(piece.label))
})

function startFind() {
  finding.value = true
  findQuery.value = ''
}

function stopFind() {
  finding.value = false
  findQuery.value = ''
}

/** The create menu beside the asset search (D277): one entry per kind of look. */
const createItems = computed<DropdownMenuItem[]>(() => [
  { label: 'New table look', icon: 'i-lucide-table-2', onSelect: () => void newLook() },
  ...LOOK_CATEGORIES.map(category => ({ label: `New ${category.noun} look`, icon: 'i-lucide-armchair', onSelect: () => void newItemLook({ category: category.key }) })),
])

watch(() => props.active, (active) => {
  if (!active) {
    exploreOpen.value = false
    sheet.value = null
    pending.value = null
    if (mode.value === 'outline' || mode.value === 'wall') finishTool()
  }
})
const confirm = useConfirm()

const [DefineLibrary, ReuseLibrary] = createReusableTemplate()
const [DefineDetails, ReuseDetails] = createReusableTemplate()
/** Properties can be on the page twice (beside the plan and in its sheet): ids stay unique. */
const detailsId = useId()
const [DefineTransform, ReuseTransform] = createReusableTemplate<{ x: number, y: number, rotation: number }>()
const [DefineRail, ReuseRail] = createReusableTemplate<{ vertical: boolean }>()
const [DefinePanelActions, ReusePanelActions] = createReusableTemplate()

function selectPlaced(target: PlanSelection, floorId: string) {
  if (floor.value?.id !== floorId) selectFloor(floorId)
  selection.value = target
  sheet.value = null
}

function selectFloor(id: string) {
  shownPage.value = null
  if (id === floor.value?.id) return
  pending.value = null
  props.editor.showFloor(id)
  selection.value = null
}

// --- Pages (ISS-036, like Figma's): groups of floors; the canvas shows one page's frames ---

const pages = computed(() => layoutPages(layout.value))
/** A page picked that has no floors yet: shown empty. Null: the floor shown's page. */
const shownPage = ref<string | null>(null)
const pageId = computed(() => shownPage.value ?? (floor.value ? floorPageId(floor.value, pages.value) : pages.value[0]!.id))
const pageFloors = computed(() => floorsOnPage(layout.value, pageId.value))
/** Where each frame on the page stands: saved, or side by side for floors saved before frames. */
const frameOffsets = computed(() => effectiveFrames(pageFloors.value))
const frameAt = computed(() => (floor.value ? frameOffsets.value[floor.value.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 }))
/** The page's frames with their offsets written out, as `besideFrames` and a move need them. */
const placedFrames = () => pageFloors.value.map(candidate => framePlace({ ...candidate, canvasX: frameOffsets.value[candidate.id]?.x ?? 0, canvasY: frameOffsets.value[candidate.id]?.y ?? 0 }))
/** The page's other floors, drawn beside the one shown (hidden ones aren't). */
const otherFrames = computed(() => pageFloors.value.filter(candidate => candidate.id !== floor.value?.id && !candidate.hidden))

/** Shows a page: its first floor, or the page empty. */
function selectPage(id: string) {
  const first = floorsOnPage(layout.value, id)[0]
  if (first) return selectFloor(first.id)
  shownPage.value = id
  selection.value = null
}
function newPage() {
  const page = { id: newLayoutId('page'), name: `Page ${pages.value.length + 1}` }
  let added = false
  draft.change(next => void (added = addPage(next, page)))
  if (added) selectPage(page.id)
  else toast.add({ title: 'Page not added', description: `A layout has at most ${LAYOUT_MAX_PAGES} pages.`, color: 'neutral', icon: 'i-lucide-info' })
}
function renamePageNamed(id: string, name: string) {
  draft.change(next => renamePage(next, id, name.slice(0, PAGE_NAME_MAX)))
}
/** A page goes only empty: its floors' tables would otherwise leave the plan. */
function deletePage(id: string) {
  if (floorsOnPage(layout.value, id).length) {
    toast.add({ title: 'Page not deleted', description: 'Move its floors to another page first.', color: 'neutral', icon: 'i-lucide-info' })
    return
  }
  draft.change(next => void removePage(next, id))
  if (shownPage.value === id) shownPage.value = null
}
function moveFloorToPage(id: string) {
  const current = floor.value
  if (!current || floorPageId(current, pages.value) === id) return
  const target = floorsOnPage(layout.value, id)
  const offsets = effectiveFrames(target)
  draft.change((next) => {
    setFloorPage(next, current.id, id)
    // Beside the frames already there, as a new floor would be.
    const moved = next.floors.find(candidate => candidate.id === current.id)
    if (!moved) return
    const at = besideFrames(target.map(other => framePlace({ ...other, canvasX: offsets[other.id]?.x ?? 0, canvasY: offsets[other.id]?.y ?? 0 })), floorPoints(moved))
    moved.canvasX = at.x
    moved.canvasY = at.y
  })
}

// An empty floor (Blank, or a new floor: owner D1) opens Draw outline; Copy walls from floor below is in Properties.
watch(() => !!floor.value && !floor.value.slabs.length && !floor.value.walls.length, (empty) => {
  if (empty) mode.value = 'outline'
}, { immediate: true })

/**
 * The floor surface Edit points works on (D282): the one selected or double-clicked, else the
 * floor's first. Kept while its floor is shown.
 */
const slabId = ref<string | null>(null)
const activeSlab = computed(() => floor.value?.slabs.find(slab => slab.id === slabId.value) ?? floor.value?.slabs[0])
watch(selection, (current) => {
  if (current?.kind === 'slab') slabId.value = current.id
})

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
  'block': 'i-lucide-box',
  'block-round': 'i-lucide-cylinder',
  'block-poly': 'i-lucide-pentagon',
}
const LOOK_ICONS = { round: 'i-lucide-circle', rect: 'i-lucide-rectangle-horizontal', booth: 'i-lucide-sofa' } as const
// A polygon block is drawn with the Shape tool, never placed from the library (it needs its corners).
const catalog = CATEGORIES.map(category => ({ ...category, specs: Object.values(ITEM_SPECS).filter(spec => spec.category === category.key && spec.kind !== 'block-poly') }))
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
const selectedSlab = computed(() => selection.value?.kind === 'slab' ? floor.value?.slabs.find(slab => slab.id === selection.value!.id) : undefined)
watch([selection, selectedPlacement, selectedItem, selectedWall, selectedSlab], ([current, table, item, wall, slab]) => {
  if (!current) return
  if ({ table, item, wall, slab }[current.kind] === undefined) {
    selection.value = null
    detailsOpen.value = false
  }
}, { immediate: true })

// A set member gone (an undo, another floor shown): the set keeps what is still on this floor.
watch([group, () => floor.value], ([members, current]) => {
  if (members.length < 2 || !current) return
  const present = members.filter(member => member.kind === 'table'
    ? layout.value.placements.some(placement => placement.tableId === member.id && placement.floorId === current.id)
    : member.kind === 'item' ? current.items.some(item => item.id === member.id) : current.walls.some(wall => wall.id === member.id))
  if (present.length !== members.length) props.editor.selectMany(present)
})

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
    ...current.items.map(item => ({ selection: { kind: 'item' as const, id: item.id }, label: item.name ?? ITEM_SPECS[item.kind].label })),
  ]
  return pieces.filter(piece => warnings.has(piece.selection.id))
})

// --- Changes, each one undo step ---

/** One change to the floor shown; false when there is none or the change was refused (a limit, ISS-043). */
function changeFloor(apply: (floor: Floor) => void): boolean {
  const id = floor.value?.id
  if (!id) return false
  return draft.change((next) => {
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
  if (changeFloor(target => target.items.push(item))) selection.value = { kind: 'item', id }
}

function updateTable(tableId: string, change: Partial<{ floorId: string, x: number, y: number, rotation: number, width: number, depth: number, lookId: string }>) {
  draft.change((next) => {
    const placement = next.placements.find(candidate => candidate.tableId === tableId)
    if (placement) Object.assign(placement, change)
  })
  if (change.floorId) props.editor.showFloor(change.floorId)
}

/** A shape's name (D278): trimmed; empty puts the kind's name back. One undo step, none when unchanged. */
function setShapeName(itemId: string, value: string) {
  const name = value.trim().slice(0, SHAPE_NAME_MAX)
  const item = floor.value?.items.find(candidate => candidate.id === itemId)
  if (!item || (item.name ?? '') === name) return
  draft.change((next) => {
    const target = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === itemId)
    if (!target) return
    if (name) target.name = name
    else delete target.name
  })
}

function updateItem(itemId: string, change: Partial<{ x: number, y: number, z: number, rotation: number, width: number, depth: number, height: number, finishes: Partial<Record<string, Finish>> }> & ShapeEdit) {
  draft.change((next) => {
    const item = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === itemId)
    if (!item) return
    Object.assign(item, change)
    // A shape setting back at its default is left out (ED-05 to ED-07), and a radius stays within
    // the shape after a resize.
    const radius = fittedRadius(item.radius, item.width, item.depth)
    if (radius === undefined) delete item.radius
    else item.radius = radius
    if (item.arcStart === undefined) delete item.arcStart
    if (item.arcSweep === undefined) delete item.arcSweep
    if (item.arcInner === undefined) delete item.arcInner
    if (item.flipX === undefined) delete item.flipX
    if (item.flipY === undefined) delete item.flipY
    // On the floor is left out, as the contract saves it (D282).
    if (!item.z) delete item.z
  })
}

/** A shape's dot dragged on the plan, or a Properties setting (ED-05, ED-06). */
function editShape(target: PlanSelection, change: ShapeEdit) {
  if (target.kind === 'item') updateItem(target.id, change)
}

/** Flip horizontal or vertical (ED-07, Figma's Shift+H, Shift+V): every selected piece; tables stay. */
function flip(axis: 'flipX' | 'flipY') {
  const targets = (multi.value ? group.value : selection.value ? [selection.value] : []).filter(target => target.kind === 'item')
  if (!targets.length) return
  draft.change((next) => {
    for (const target of targets) {
      const item = next.floors.flatMap(candidate => candidate.items).find(candidate => candidate.id === target.id)
      if (!item || item.locked) continue
      if (axis === 'flipX') item.flipX = item.flipX ? undefined : true
      else item.flipY = item.flipY ? undefined : true
      if (!item.flipX) delete item.flipX
      if (!item.flipY) delete item.flipY
    }
  })
}

function move(target: PlanSelection, position: Point) {
  if (inGroup(target)) {
    // An arrow key on a set (D278): the same step for all.
    const current = target.kind === 'table' ? layout.value.placements.find(placement => placement.tableId === target.id) : floor.value?.items.find(item => item.id === target.id)
    if (current) moveGroup({ x: position.x - current.x, y: position.y - current.y })
    return
  }
  if (target.kind === 'table') updateTable(target.id, position)
  else if (target.kind === 'item') updateItem(target.id, position)
}

function rotate(target: PlanSelection, rotation: number) {
  if (inGroup(target)) return turnGroup()
  if (target.kind === 'table') updateTable(target.id, { rotation })
  else if (target.kind === 'item') updateItem(target.id, { rotation })
}

/** A corner handle on the plan: the new size and the centre that keeps the opposite corner. */
function resize(target: PlanSelection, size: Omit<Sized, 'rotation'>) {
  if (target.kind === 'table') updateTable(target.id, size)
  else if (target.kind === 'item') updateItem(target.id, size)
}

/**
 * A table leaves the map (back to Unplaced, its QR untouched); furniture, walls and floor surfaces
 * are deleted (D282: really, ISS-046).
 */
function remove(target: PlanSelection) {
  if (inGroup(target)) return removeGroup()
  if (target.kind === 'wall' || target.kind === 'slab') return void removePart(target)
  draft.change((next) => {
    if (target.kind === 'table') next.placements = next.placements.filter(placement => placement.tableId !== target.id)
    for (const candidate of next.floors) {
      if (target.kind === 'item') candidate.items = candidate.items.filter(item => item.id !== target.id)
    }
  })
  selection.value = null
}

/**
 * A wall or a floor surface deleted for real (ISS-046, D282): a wall with its doors and windows,
 * silently (owner D6: Undo brings them back); a surface without its walls. Removing Explore's
 * street door asks first (ISS-038).
 */
async function removePart(target: PlanSelection) {
  const apply = (next: ShopLayout) => {
    for (const candidate of next.floors) {
      if (target.kind === 'wall') candidate.walls = candidate.walls.filter(wall => wall.id !== target.id)
      if (target.kind === 'slab') candidate.slabs = candidate.slabs.filter(slab => slab.id !== target.id)
    }
  }
  if (!(await keepsStreetDoor(apply))) return
  draft.change(apply)
  selection.value = null
}

/**
 * A floor surface's new outline and the floor's walls after it (Edit points, D282), one undo step.
 * Refused when it would cross itself (ISS-039; one that already did may still be edited back); asks
 * first when it would remove Explore's street door (ISS-038).
 */
async function updateShape(slabId: string, shape: FloorShape) {
  const current = floor.value
  const slab = current?.slabs.find(candidate => candidate.id === slabId)
  if (!current || !slab) return
  if (!isSimpleOutline(shape.outline) && isSimpleOutline(slab.outline)) {
    toast.add({ title: 'Outline not changed', description: 'A floor\'s sides cannot cross each other.', color: 'neutral', icon: 'i-lucide-info' })
    return
  }
  await changeStructure(current.id, target => withShape(target, slabId, shape))
}

/** A new floor surface drawn on the floor shown, with its walls around it (D282). */
function addSlab(shape: FloorShape) {
  const id = newLayoutId('slab')
  if (changeFloor((target) => {
    target.slabs.push({ id, outline: shape.outline })
    target.walls.push(...shape.walls)
  })) slabId.value = id
}

/**
 * The floor's surfaces and walls replaced by `change` (Room, Edit points, Copy walls), one undo
 * step, after asking when Explore's street door would go (ISS-038).
 */
async function changeStructure(floorId: string, change: (floor: Floor) => Pick<Floor, 'slabs' | 'walls'>) {
  const apply = (next: ShopLayout) => {
    const target = next.floors.find(candidate => candidate.id === floorId)
    if (!target) return
    const { slabs, walls } = change(target)
    target.slabs = slabs
    target.walls = walls
  }
  if (!(await keepsStreetDoor(apply))) return
  draft.change(apply)
}

/** Owner D1: the floor below's surfaces and walls on the floor shown, without doors or windows. */
function copyWallsFromBelow() {
  const current = floor.value
  const below = floors.value[floorIndex.value - 1]
  if (!current || !below) return
  const copied = copyStructure(below)
  void changeStructure(current.id, target => ({ slabs: [...target.slabs, ...copied.slabs], walls: [...target.walls, ...copied.walls] }))
  if (mode.value === 'outline') finishTool()
}

/**
 * Whether a change may go ahead as far as Explore's street door goes (ISS-038; owner 2026-11-14:
 * ask, then turn Explore off): true when the door stays, or the owner agreed to lose it. The draft
 * then clears the door and Explore with the change itself, so undo brings both back.
 */
async function keepsStreetDoor(apply: (next: ShopLayout) => void): Promise<boolean> {
  const before = layout.value
  const after = structuredClone(toRaw(before))
  apply(after)
  if (!losesStreetDoor(before, after)) return true
  return await confirm(streetDoorWarning(before))
}

function streetDoorWarning(before: ShopLayout) {
  const explore = before.scene?.explore === true
  return {
    title: explore ? 'Turn off Explore?' : 'Remove the street door?',
    description: explore
      ? 'This removes Explore\'s street door, so customers no longer see this café in Explore. Choose a street door in Explore settings to show it again.'
      : 'This removes the street door chosen in Explore settings.',
    confirmLabel: explore ? 'Turn off Explore' : 'Remove street door',
    danger: true,
  }
}

// --- Typing a length on the plan's label (3A) ---

/** The edge whose length is being typed, where its label is on screen, and what's typed so far. */
const lengthEdit = ref<{ index: number, at: Point, value: number | undefined } | null>(null)
const lengthInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('lengthInput')
/** Inside walls' kinds, for the right-click menu (D278). */
const INNER_WALL_OPTIONS = [
  { value: 'wall', label: 'Wall' },
  { value: 'railing', label: 'Railing' },
  { value: 'half', label: 'Half wall' },
  { value: 'glass', label: 'Glass' },
] as const
const EDGE_LENGTH_MIN_CM = 10
const EDGE_LENGTH_MAX_CM = 10_000

function editLength(index: number, at: Point) {
  const slab = activeSlab.value
  if (!slab) return
  lengthEdit.value = { index, at, value: Math.round(edgeLength(slab.outline, index)) }
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
  const slab = activeSlab.value
  if (!edit || !current || !slab || typeof edit.value !== 'number' || !Number.isFinite(edit.value)) return
  const length = Math.min(EDGE_LENGTH_MAX_CM, Math.max(EDGE_LENGTH_MIN_CM, Math.round(edit.value)))
  if (length === Math.round(edgeLength(slab.outline, edit.index))) return
  void updateShape(slab.id, setEdgeLength(shapeOf(current, slab), edit.index, length))
}

watch(() => [mode.value, floor.value?.id], () => {
  lengthEdit.value = null
})

/**
 * The Room tool (D278, D282): the rectangle becomes a floor surface with walls, merges into the
 * surfaces it touches or, with Cut, is cut out of them, as one undo step; then Select again, as
 * Figma's shape tools do. A refused room says why.
 */
function applyRoom(bounds: Bounds, cut: boolean) {
  const current = floor.value
  if (!current) return
  const result = addRoom(current, bounds, cut)
  if ('refused' in result) {
    toast.add({ title: cut ? 'Room not cut out' : 'Room not added', description: result.refused, color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  void changeStructure(current.id, () => result.floor)
  finishTool()
}

/** The Shape tool (D278): a block or round block where it was drawn, selected; then Select again. */
function placeShape(bounds: Bounds) {
  const width = Math.min(ITEM_SIZE_MAX_CM, Math.round(bounds.maxX - bounds.minX))
  const depth = Math.min(ITEM_SIZE_MAX_CM, Math.round(bounds.maxY - bounds.minY))
  if (Math.min(width, depth) < SHAPE_MIN_CM) {
    toast.add({ title: 'Shape not added', description: `Drag at least ${SHAPE_MIN_CM} cm each way.`, color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  const id = newLayoutId('item')
  // A round block may be an ellipse, as drawn (ISS-017); Shift draws a circle.
  const kind = roundShape.value ? 'block-round' : 'block'
  const added = changeFloor(target => target.items.push({ id, kind, x: Math.round((bounds.minX + bounds.maxX) / 2), y: Math.round((bounds.minY + bounds.maxY) / 2), rotation: 0, width, depth, finishes: {} }))
  finishTool()
  if (added) selection.value = { kind: 'item', id }
}
const SHAPE_MIN_CM = 20

/** The Shape tool's Polygon (plan Phase 4): the corners drawn become a polygon block there, selected; then Select again. */
function placePolygon(corners: Point[]) {
  const shape = polygonShape(corners)
  if (!shape) return
  const id = newLayoutId('item')
  const width = Math.min(ITEM_SIZE_MAX_CM, Math.max(ITEM_SIZE_MIN_CM, shape.width))
  const depth = Math.min(ITEM_SIZE_MAX_CM, Math.max(ITEM_SIZE_MIN_CM, shape.depth))
  const added = changeFloor(target => target.items.push({ id, kind: 'block-poly', x: shape.x, y: shape.y, rotation: 0, width, depth, finishes: {}, points: shape.points }))
  finishTool()
  if (added) selection.value = { kind: 'item', id }
}

function addWall(wall: Omit<Wall, 'id'>) {
  changeFloor(target => target.walls.push({ id: newLayoutId('wall'), ...wall }))
}

/** The floor's inside walls after a change from their panel or the plan (D278): one undo step. */
function setWalls(walls: Wall[]) {
  changeFloor((target) => {
    target.walls = walls
  })
}

function turn(degrees: number) {
  if (multi.value) return turnGroup()
  const target = selection.value
  const current = selectedPlacement.value ?? selectedItem.value
  if (target && current) rotate(target, normalizeRotation(current.rotation + degrees))
}

// --- Several selected (D278) ---

function moveGroup(delta: Point) {
  const floorId = floor.value?.id
  if (!floorId || (!delta.x && !delta.y)) return
  draft.change(next => shiftSelected(next, floorId, group.value, delta))
}

/** 90° clockwise around the set's middle, as one piece. */
function turnGroup() {
  const floorId = floor.value?.id
  const box = canvas.value?.selectedBounds
  if (!floorId || !box) return
  const center = { x: snap((box.minX + box.maxX) / 2, SNAP_CM), y: snap((box.minY + box.maxY) / 2, SNAP_CM) }
  draft.change(next => turnSelected(next, floorId, group.value, center))
}

/** Align (ISS-026, Figma): each selected one lines up with the set's edge, as drawn; one undo step. */
function alignGroup(edge: AlignEdge) {
  moveEach(boxes => alignOffsets(boxes, edge))
}
/** Distribute (owner, 2026-11-13): equal gaps across or down; the outer two stay. */
function distributeGroup(axis: 'x' | 'y') {
  moveEach(boxes => distributeOffsets(boxes, axis))
}
/** Align one piece to its floor (ED-11, Figma's align to the frame): the outline's edges, as drawn. */
function alignToFloor(edge: AlignEdge) {
  const target = selection.value
  const points = floor.value ? floor.value.slabs.flatMap(slab => slab.outline) : []
  if (!target || !points.length) return
  moveEach(boxes => alignOffsets(boxes, edge, boundsOf(points)), [target])
}
/** Moves each selected one by its own offset, from their boxes as drawn; one undo step. */
function moveEach(offsets: (boxes: { target: PlanSelection, bounds: Bounds }[]) => { target: PlanSelection, delta: Point }[], targets: readonly PlanSelection[] = group.value) {
  const plan = canvas.value
  const floorId = floor.value?.id
  if (!plan || !floorId) return
  const boxes = targets.flatMap((target) => {
    const bounds = plan.boxOf(target)
    return bounds ? [{ target, bounds }] : []
  })
  const moves = offsets(boxes)
  if (!moves.length) return
  draft.change((next) => {
    for (const { target, delta } of moves) shiftSelected(next, floorId, [target], delta)
  })
}
const DISTRIBUTE_BUTTONS: { axis: 'x' | 'y', label: string, icon: string }[] = [
  { axis: 'x', label: 'Distribute across', icon: 'i-lucide-align-horizontal-space-between' },
  { axis: 'y', label: 'Distribute down', icon: 'i-lucide-align-vertical-space-between' },
]
const ALIGN_BUTTONS: { edge: AlignEdge, label: string, icon: string }[] = [
  { edge: 'left', label: 'Align left', icon: 'i-lucide-align-start-vertical' },
  { edge: 'center', label: 'Align centres', icon: 'i-lucide-align-center-vertical' },
  { edge: 'right', label: 'Align right', icon: 'i-lucide-align-end-vertical' },
  { edge: 'top', label: 'Align top', icon: 'i-lucide-align-start-horizontal' },
  { edge: 'middle', label: 'Align middles', icon: 'i-lucide-align-center-horizontal' },
  { edge: 'bottom', label: 'Align bottom', icon: 'i-lucide-align-end-horizontal' },
]

function removeGroup() {
  const targets = [...group.value]
  draft.change(next => removeSelected(next, targets))
  selection.value = null
}

/** Shift+click: in or out of the set. */
function toggleSelected(target: PlanSelection) {
  const current = props.editor.selected.value.filter(member => member.kind !== 'slab')
  const present = current.some(member => member.kind === target.kind && member.id === target.id)
  props.editor.selectMany(present ? current.filter(member => member.kind !== target.kind || member.id !== target.id) : [...current, target])
}

/** A box selection: what it touched, added to the set with Shift. */
function selectBox(targets: PlanSelection[], additive: boolean) {
  const base = additive ? props.editor.selected.value.filter(member => member.kind !== 'slab') : []
  props.editor.selectMany([...base, ...targets])
}

/** Ctrl/⌘+A: every table, piece and inside wall on the floor shown. */
const planFocused = () => !!document.activeElement?.closest('[data-testid="floor-plan"]')

/** The floor's tables, pieces and inside walls in the Floors list's order. */
function floorOrder(): PlanSelection[] {
  const current = floor.value
  if (!current) return []
  return [
    ...tablesOn(current.id).map(placement => ({ kind: 'table' as const, id: placement.tableId })),
    ...current.items.map(item => ({ kind: 'item' as const, id: item.id })),
    ...current.walls.map(wall => ({ kind: 'wall' as const, id: wall.id })),
  ]
}

/** The middle of what the clipboard holds (its pieces' and walls' points), for Paste here. */
function clipboardMiddle(clipboard: PlanClipboard): Point | null {
  const points = [...clipboard.items.map(item => ({ x: item.x, y: item.y })), ...clipboard.walls.flatMap(wall => [wall.from, wall.to])]
  if (!points.length) return null
  const box = boundsOf(points)
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

/** Bring to front, Send to back (ISS-008, Figma's): a piece drawn over or under the others. */
function reorderItem(itemId: string, to: 'front' | 'back') {
  changeFloor((target) => {
    const at = target.items.findIndex(item => item.id === itemId)
    if (at < 0) return
    const [item] = target.items.splice(at, 1)
    if (to === 'front') target.items.push(item!)
    else target.items.unshift(item!)
  })
}

/** The menu's edit group for what is selected (ISS-008): copy, paste here, order, hide, lock. */
function editGroup(targets: PlanSelection[]): ContextMenuItem[][] {
  const current = floor.value
  if (!current || !targets.length) return []
  const layers = targets.map(target => ({ target, layer: layerIn(layout.value, target, current.id) }))
  const allLocked = layers.every(entry => entry.layer?.locked)
  const items = targets.filter(target => target.kind === 'item')
  return [[
    { label: 'Copy', icon: 'i-lucide-copy', kbds: ['meta', 'c'], onSelect: () => void props.editor.copy() },
    { label: 'Paste here', icon: 'i-lucide-clipboard-paste', kbds: ['meta', 'v'], disabled: !props.editor.clipboard.value, onSelect: () => pasteCopied(canvas.value?.contextPoint) },
  ], ...(items.length === 1 && targets.length === 1
    ? [[
        { label: 'Bring to front', icon: 'i-lucide-bring-to-front', onSelect: () => reorderItem(items[0]!.id, 'front') },
        { label: 'Send to back', icon: 'i-lucide-send-to-back', onSelect: () => reorderItem(items[0]!.id, 'back') },
      ]]
    : []), [
    { label: 'Hide', icon: 'i-lucide-eye-off', onSelect: () => draft.change(next => layers.forEach(entry => setFlag(layerIn(next, entry.target, current.id), 'hidden', true))) },
    { label: allLocked ? 'Unlock' : 'Lock', icon: allLocked ? 'i-lucide-lock-open' : 'i-lucide-lock', onSelect: () => draft.change(next => layers.forEach(entry => setFlag(layerIn(next, entry.target, current.id), 'locked', !allLocked))) },
  ], ...(targets.some(target => target.kind !== 'table')
    ? [[{ label: 'Save as group…', icon: 'i-lucide-boxes', onSelect: () => void saveAsGroup(targets) }]]
    : [])]
}

// --- Saved groups (plan Phase 5, D284): the cafe's pieces and walls to place again ---

const groupsQuery = useLayoutGroups()
const groupMutations = useLayoutGroupMutations()
const savedGroups = computed(() => groupsQuery.data.value ?? [])
const saveGroupModal = useOverlay().create(SaveGroupModal)

/** The selected pieces and walls as a group for the cafe; tables stay out (each has its own QR code). */
async function saveAsGroup(targets: readonly PlanSelection[]) {
  const current = floor.value
  const pieces = current ? groupFromSelection(layout.value, current.id, targets) : null
  if (!pieces) {
    toast.add({ title: 'Nothing to save', description: 'Tables are never in a group: select pieces or walls.', color: 'neutral', icon: 'i-lucide-info' })
    return
  }
  await saveGroupModal.open(pieces).result
}

/** A saved group's copies in the middle of the plan shown, selected, as one undo step. */
function placeSavedGroup(saved: LayoutGroup) {
  const current = floor.value
  if (!current) return
  const at = canvas.value?.viewCenter() ?? { x: 0, y: 0 }
  const known = new Set(itemLooks.value.map(look => look.id))
  let copies: PlanSelection[] = []
  if (!draft.change(next => void (copies = placeGroup(next, current.id, saved, { x: Math.round(at.x), y: Math.round(at.y) }, known)))) return
  props.editor.selectMany(copies)
  sheet.value = null
}

// --- Layers (ISS-021, like Figma's): hide, lock, rename, range select, hover ---

type LayerFlag = 'hidden' | 'locked'
type Layer = { hidden?: true, locked?: true }
/** The draft's own table, piece or inside wall for a target on a floor. */
function layerIn(next: ShopLayout, target: PlanSelection, floorId: string): (Layer & { name?: string }) | undefined {
  if (target.kind === 'table') return next.placements.find(placement => placement.tableId === target.id)
  const on = next.floors.find(candidate => candidate.id === floorId)
  if (target.kind === 'item') return on?.items.find(item => item.id === target.id)
  if (target.kind === 'wall') return on?.walls.find(wall => wall.id === target.id)
  if (target.kind === 'slab') return on?.slabs.find(slab => slab.id === target.id)
}
const setFlag = (layer: Layer | undefined, flag: LayerFlag, on: boolean) => {
  if (!layer) return
  // Left out when off, as the contract saves it.
  if (flag === 'hidden') {
    if (on) layer.hidden = true
    else delete layer.hidden
  }
  else if (on) layer.locked = true
  else delete layer.locked
}
/** The eye or the lock of a row: one undo step, saved with the layout. */
function setLayerFlag(target: PlanSelection, floorId: string, flag: LayerFlag, on: boolean) {
  draft.change(next => setFlag(layerIn(next, target, floorId), flag, on))
}
function setFloorFlag(floorId: string, flag: LayerFlag, on: boolean) {
  draft.change(next => setFlag(next.floors.find(candidate => candidate.id === floorId), flag, on))
}
/** A double-click rename of a piece or an inside wall; a table's name is its own record (Edit table). */
function renameLayer(target: PlanSelection, floorId: string, name: string) {
  draft.change((next) => {
    const layer = layerIn(next, target, floorId)
    if (layer && target.kind !== 'table') layer.name = name
  })
}
function renameFloorLayer(floorId: string, name: string) {
  draft.change((next) => {
    const renamed = next.floors.find(candidate => candidate.id === floorId)
    if (renamed) renamed.name = name
  })
}
/** A row clicked: Shift selects the range from the last picked, Ctrl/⌘ adds or takes it out. */
function clickLayer(target: PlanSelection, floorId: string, event: MouseEvent) {
  if (floor.value?.id !== floorId) {
    selectPlaced(target, floorId)
    return
  }
  const order = floorOrder()
  const anchor = selection.value ? order.findIndex(entry => entry.kind === selection.value!.kind && entry.id === selection.value!.id) : -1
  const at = order.findIndex(entry => entry.kind === target.kind && entry.id === target.id)
  if (event.shiftKey && anchor >= 0 && at >= 0) {
    const [from, to] = anchor <= at ? [anchor, at] : [at, anchor]
    // The anchor stays the last picked, so a second Shift+click spans from it again.
    props.editor.selectMany([...order.slice(from, to + 1).filter(entry => entry.id !== order[anchor]!.id), order[anchor]!])
    return
  }
  if (event.metaKey || event.ctrlKey) return toggleSelected(target)
  selectPlaced(target, floorId)
}
/** The row pointed at in Layers: outlined on the plan. */
const layerHover = ref<PlanSelection | null>(null)
/** In the selection: the one, or one of the set. */
const isPicked = (kind: PlanSelection['kind'], id: string) => props.editor.selected.value.some(member => member.kind === kind && member.id === id)
/** A wall's layer name: its own, or numbered among the floor's outer (beside their line, D282) or interior walls. */
function wallLabel(walls: readonly Wall[], index: number): string {
  const wall = walls[index]!
  if (wall.name) return wall.name
  const number = walls.slice(0, index + 1).filter(other => !!other.side === !!wall.side).length
  return `${wall.side ? 'Outer' : 'Interior'} wall ${number}`
}
const slabLabel = (slab: Floor['slabs'][number], index: number) => slab.name ?? `Floor surface ${index + 1}`

function selectNext(step: 1 | -1) {
  const next = cycleSelection(floorOrder(), selection.value, step)
  if (next) props.editor.selectMany([next])
}

/** Ctrl/⌘+A: everything on the floor that is shown and not locked (Figma's). */
function selectAll() {
  const current = floor.value
  if (!current) return
  const free = (layer: Layer) => !layer.hidden && !layer.locked
  props.editor.selectMany([
    ...layout.value.placements.filter(placement => placement.floorId === current.id && free(placement)).map(placement => ({ kind: 'table' as const, id: placement.tableId })),
    ...current.items.filter(free).map(item => ({ kind: 'item' as const, id: item.id })),
    ...current.walls.filter(free).map(wall => ({ kind: 'wall' as const, id: wall.id })),
  ])
}

/** Ctrl/⌘+D on a set: its furniture and walls copied 50 cm away and selected; tables keep their own QR. */
function duplicateGroup() {
  const floorId = floor.value?.id
  if (!floorId) return
  const targets = [...group.value]
  let copies: PlanSelection[] = []
  if (targets.some(target => target.kind !== 'table') && !draft.change(next => void (copies = duplicateSelected(next, floorId, targets, { x: 50, y: 50 })))) copies = []
  if (targets.some(target => target.kind === 'table')) {
    toast.add({ title: 'Tables not copied', description: 'Each table has its own QR code: use Duplicate look on one table to place another table.', color: 'neutral', icon: 'i-lucide-info' })
  }
  if (copies.length) props.editor.selectMany(copies)
}

/** What the set holds, for Properties: "2 tables, 3 pieces and 1 wall". */
const groupSummary = computed(() => {
  const count = (kind: PlanSelection['kind']) => group.value.filter(member => member.kind === kind).length
  const parts = [[count('table'), 'table'], [count('item'), 'piece'], [count('wall'), 'wall']] as const
  const named = parts.filter(([n]) => n > 0).map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`)
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0] ?? ''
})

// --- Floors (9B, 6B) ---

function addFloor() {
  if (!canAddFloor(layout.value)) return
  stopFind()
  // On the page shown, beside its frames (ISS-036).
  const created: Floor = { ...newFloor(layout.value) }
  const at = besideFrames(placedFrames(), [])
  created.canvasX = at.x
  created.canvasY = at.y
  if (pageId.value !== pages.value[0]!.id) created.pageId = pageId.value
  draft.change(next => void next.floors.push(created))
  selectFloor(created.id)
  renaming.value = { id: created.id, name: created.name }
}

/** A new floor's name, typed in its row: Enter or leaving the field keeps it, Escape the default. */
const renaming = ref<{ id: string, name: string } | null>(null)

function commitRename(id: string) {
  const edit = renaming.value
  if (edit?.id !== id) return
  renaming.value = null
  const name = edit.name.trim()
  const target = floors.value.find(candidate => candidate.id === id)
  if (!name || !target || name === target.name) return
  draft.change((next) => {
    const renamed = next.floors.find(candidate => candidate.id === id)
    if (renamed) renamed.name = name
  })
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

/** The frame moved, by its name on the plan or by Frame X and Y (ISS-035): one undo step; 0 is left out. */
function setFrame(at: Point) {
  const current = floor.value
  if (!current) return
  const offsets = frameOffsets.value
  draft.change((next) => {
    // The page's frames all get their place written out (the first move after frames came), so
    // none laid out side by side jumps; then this one goes where asked.
    for (const other of next.floors) {
      const place = other.id === current.id ? at : offsets[other.id]
      if (!place) continue
      other.canvasX = place.x
      other.canvasY = place.y
    }
  })
}
function moveFrame(delta: Point) {
  const current = floor.value
  if (current && !current.locked) setFrame({ x: frameAt.value.x + delta.x, y: frameAt.value.y + delta.y })
}

/**
 * Moves the floor shown one place up or down (owner: the order matters; the first is the ground
 * floor, 3D stacks them in order). Explore's street door is on the ground floor: a move that would
 * take it from there is refused, with why.
 */
function moveFloor(step: 1 | -1) {
  const at = floorIndex.value
  const to = at + step
  if (at < 0 || to < 0 || to >= floors.value.length) return
  if ((at === 0 || to === 0) && layout.value.scene?.entrance) {
    toast.add({ title: 'Floor not moved', description: 'Explore\'s street door is on the ground floor. Choose no street door in Explore settings first.', color: 'neutral', icon: 'i-lucide-info' })
    return
  }
  draft.change((next) => {
    const [moved] = next.floors.splice(at, 1)
    if (moved) next.floors.splice(to, 0, moved)
  })
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
  const apply = (next: ShopLayout) => {
    next.floors = next.floors.filter(candidate => candidate.id !== target.id)
    next.placements = next.placements.filter(placement => placement.floorId !== target.id)
  }
  // The ground floor holds Explore's street door (ISS-038): say so in the same dialog.
  const after = structuredClone(toRaw(layout.value))
  apply(after)
  const explore = losesStreetDoor(layout.value, after)
    ? layout.value.scene?.explore ? ' Explore\'s street door is on this floor: customers no longer see this café in Explore until you choose a new one.' : ' Explore\'s street door is on this floor and is removed too.'
    : ''
  const confirmed = await confirm({
    title: `Remove the ${target.name} floor?`,
    description: `${moved}Its outline, walls${pieces ? ` and ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} of furniture` : ''} are deleted.${explore} You can undo this.`,
    confirmLabel: 'Remove floor',
    danger: true,
  })
  if (!confirmed) return
  const index = floors.value.indexOf(target)
  draft.change(apply)
  selectFloor(floors.value[Math.max(0, index - 1)]!.id)
}

function listLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

// --- Draw outline and Draw wall (3A, 9A) ---

/** The layout when the tool opened: Cancel puts this floor's shape and walls back, as one undo step. */
let toolStart: { floorId: string, slabs: Floor['slabs'], walls: Wall[] } | null = null

function startTool(next: PlanMode) {
  if (next === 'room') roomCut.value = false
  pending.value = null
  if (mode.value === next) return finishTool()
  if (next === 'select' || next === 'hand') {
    finishTool()
    mode.value = next
    return
  }
  const current = floor.value
  toolStart = current ? { floorId: current.id, slabs: current.slabs, walls: current.walls } : null
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
  if (start && current && (changed(current.slabs, start.slabs) || changed(current.walls, start.walls))) {
    draft.change((next) => {
      const target = next.floors.find(candidate => candidate.id === start.floorId)
      if (!target) return
      target.slabs = structuredClone(toRaw(start.slabs))
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
/**
 * Ctrl/⌘+V (ISS-022): new copies of what Ctrl/⌘+C copied, one undo step, on the floor shown: 50 cm
 * on, on the floor it came from; in the same place on another floor (owner, 2026-11-13, like
 * Figma's paste into another frame). One table alone asks which table the copy is, as Duplicate
 * look does; tables in a set are not copied (each has its own QR code).
 */
function pasteCopied(at?: Point | null) {
  const clipboard = props.editor.clipboard.value
  const current = floor.value
  if (!clipboard || !current) return
  const sameFloor = clipboard.floorId === current.id
  // Paste here (ISS-008): the copies centred on the point right-clicked.
  const middle = clipboardMiddle(clipboard)
  if (!clipboard.items.length && !clipboard.walls.length) {
    const [tableId] = clipboard.tableIds
    const original = layout.value.placements.find(placement => placement.tableId === tableId)
    if (clipboard.tableIds.length === 1 && tableId && original) void duplicateLook(tableId, at ? { x: Math.round(at.x), y: Math.round(at.y) } : sameFloor ? undefined : { x: original.x, y: original.y }, current.id)
    else toast.add({ title: 'Tables not copied', description: 'Each table has its own QR code: use Duplicate look on one table to place another table.', color: 'neutral', icon: 'i-lucide-info' })
    return
  }
  const offset = at && middle ? { x: Math.round(at.x - middle.x), y: Math.round(at.y - middle.y) } : sameFloor ? props.editor.nextPasteOffset() : { x: 0, y: 0 }
  let copies: PlanSelection[] = []
  if (!draft.change(next => void (copies = pasteClipboard(next, clipboard, current.id, offset)))) return
  if (clipboard.tableIds.length) toast.add({ title: 'Tables not copied', description: 'Each table has its own QR code: use Duplicate look on one table to place another table.', color: 'neutral', icon: 'i-lucide-info' })
  props.editor.selectMany(copies)
}

/** `floorId`: where the copy goes (a paste on another floor); the original's floor otherwise. */
async function duplicateLook(tableId: string, to?: Point, floorId?: string) {
  const source = layout.value.placements.find(placement => placement.tableId === tableId)
  if (!source) return
  const choice = await pickModal.open({ lookName: findLook(props.looks, source.lookId).name, tables: unplaced.value }).result
  if (!choice) return
  const copyId = choice === 'new' ? (await newTable())?.id : choice
  // The dialog waited: read the original again (an undo may have taken it off the map meanwhile).
  const original = layout.value.placements.find(placement => placement.tableId === tableId)
  if (!copyId || !original || placedIds.value.has(copyId)) return
  const extent = placementExtent(original, findLook(props.looks, original.lookId))
  const at = to ?? besideOf(original, extent.width, extent.depth)
  const { rotation, width, depth, lookId } = original
  const onFloor = floorId ?? original.floorId
  draft.change(next => next.placements.push({ tableId: copyId, floorId: onFloor, ...at, rotation, width, depth, lookId }))
  props.editor.showFloor(onFloor)
  selection.value = { kind: 'table', id: copyId }
}

/** Duplicate (furniture): a copy with the same size, turn and finishes, beside it or at `to` (Alt+drag). */
function duplicateItem(itemId: string, to?: Point) {
  const item = floor.value?.items.find(candidate => candidate.id === itemId)
  if (!item) return
  const id = newLayoutId('item')
  const at = to ?? besideOf(item, item.width, item.depth)
  if (changeFloor(target => target.items.push({ ...structuredClone(toRaw(item)), id, ...at }))) selection.value = { kind: 'item', id }
}

// --- The cafe's own chair and fixture looks (step 3d) ---

const itemLookModal = overlay.create(ItemLookFormModal)
const isCustomItem = (look: ItemLook): look is CustomItemLook => 'version' in look
const selectedItemLook = computed(() => (selectedItem.value ? findItemLook(itemLooks.value, selectedItem.value.lookId) : undefined))
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
  sheet.value = null
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
  ghost.value = at ? ghostOf(libraryDrag.piece, { x: snap(at.x, snapStep.value), y: snap(at.y, snapStep.value) }) : null
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

// --- Studio's keys (D278) ---

const shortcutsHelp = overlay.create(ShortcutsHelp)
/** Studio's keys and drag keys, one list (`STUDIO_SHORTCUTS`): by `?` or the plan's right-click menu. */
/** Ctrl/⌘+/: Studio's actions to search (StudioCommands). */
const commandsOpen = ref(false)
const commandGroups = computed<CommandPaletteGroup[]>(() => {
  const plan = canvas.value
  const selected = props.editor.selected.value.length > 0
  const tool = (label: string, next: PlanMode, icon: string, kbd: string, round?: boolean) => ({
    label,
    icon,
    kbds: [kbd],
    onSelect: () => {
      if (round !== undefined) roundShape.value = round
      startTool(next)
    },
  })
  return [
    { id: 'tools', label: 'Tools', items: [
      tool('Select', 'select', 'i-lucide-mouse-pointer-2', 'v'),
      tool('Hand', 'hand', 'i-lucide-hand', 'h'),
      tool('Room', 'room', 'i-lucide-square-plus', 'r'),
      tool('Shape: rectangle', 'shape', 'i-lucide-square', 's', false),
      tool('Shape: ellipse', 'shape', 'i-lucide-circle', 'o', true),
      tool('Edit points', 'outline', 'i-lucide-pen-tool', 'p'),
      tool('Draw wall', 'wall', 'i-lucide-brick-wall', 'w'),
    ] },
    { id: 'edit', label: 'Edit', items: [
      { label: 'Undo', icon: 'i-lucide-undo-2', kbds: ['meta', 'z'], disabled: !draft.canUndo.value, onSelect: () => draft.undo() },
      { label: 'Redo', icon: 'i-lucide-redo-2', kbds: ['meta', 'shift', 'z'], disabled: !draft.canRedo.value, onSelect: () => draft.redo() },
      { label: 'Select all', icon: 'i-lucide-box-select', kbds: ['meta', 'a'], onSelect: () => (mode.value === 'select' ? selectAll() : undefined) },
      { label: 'Copy', icon: 'i-lucide-copy', kbds: ['meta', 'c'], disabled: !selected, onSelect: () => void props.editor.copy() },
      { label: 'Paste', icon: 'i-lucide-clipboard-paste', kbds: ['meta', 'v'], disabled: !props.editor.clipboard.value, onSelect: () => pasteCopied() },
      { label: 'Duplicate', icon: 'i-lucide-copy-plus', kbds: ['meta', 'd'], disabled: !selected, onSelect: duplicateSelection },
      { label: 'Delete', icon: 'i-lucide-trash-2', kbds: ['delete'], disabled: !selected, onSelect: () => (multi.value ? removeGroup() : selection.value && remove(selection.value)) },
    ] },
    { id: 'view', label: 'View', items: [
      { label: 'Zoom to fit', icon: 'i-lucide-scan', kbds: ['shift', '1'], onSelect: () => plan?.fit() },
      { label: 'Zoom to selection', icon: 'i-lucide-scan-search', kbds: ['shift', '2'], onSelect: () => plan?.zoomToSelection() },
      { label: 'Zoom to 100%', icon: 'i-lucide-search', kbds: ['meta', '0'], onSelect: () => plan?.zoomTo(100) },
      { label: 'Zoom in', icon: 'i-lucide-zoom-in', kbds: ['meta', '+'], onSelect: () => plan?.zoom(1) },
      { label: 'Zoom out', icon: 'i-lucide-zoom-out', kbds: ['meta', '-'], onSelect: () => plan?.zoom(-1) },
    ] },
    { id: 'help', label: 'Help', items: [
      { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: showShortcuts },
    ] },
  ]
})
const showShortcuts = () => void shortcutsHelp.open({ shortcuts: [...STUDIO_SHORTCUTS, ...STUDIO_DRAG_KEYS] })

/**
 * A dialog, menu or open select is on screen: Studio's keys must not act behind it. One that is
 * closing (its 100 ms animation, `data-state="closed"`) no longer counts: Delete right after a
 * menu choice acts on the plan.
 */
const somethingOnTop = () => !!document.querySelector(['dialog', 'alertdialog', 'menu', 'listbox'].map(role => `[role="${role}"]:not([data-state="closed"])`).join(', '))

/**
 * Whether the focused element uses this key itself: typing in a field, or the arrows of the
 * sidebar's resize handle, a tab list or a radio group. Anything else (the page, the plan, a
 * button just clicked in a panel) leaves the key to Studio, as Figma does.
 */
function focusTakes(event: KeyboardEvent): boolean {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return false
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable) return true
  if (event.key.startsWith('Arrow')) return !!active.closest('[role="separator"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="menubar"], [role="listbox"]')
  // Space and Enter press a focused button; Escape and the letters don't.
  if (event.key === 'Enter' || event.key === ' ') return active.tagName === 'BUTTON' || active.tagName === 'A' || active.getAttribute('role') === 'button'
  return false
}

/** Alt+drag (D278): a copy where the drag ended; a table's copy asks which table it is, as Duplicate look does. */
function copyTo(target: PlanSelection, at: Point) {
  if (target.kind === 'item') duplicateItem(target.id, at)
  else if (target.kind === 'table') void duplicateLook(target.id, at)
}

/** Ctrl/⌘+D: a piece's copy beside it; a table asks which table the copy is (its QR stays its own). */
function duplicateSelection() {
  if (multi.value) return duplicateGroup()
  const target = selection.value
  if (target?.kind === 'item') duplicateItem(target.id)
  else if (target?.kind === 'table') void duplicateLook(target.id)
}

/** Every key pressed in 2D, outside a field: the plan's own keys first, then the tools and zoom. */
function onStudioKey(event: KeyboardEvent) {
  if (!props.active || view.value !== 'design' || event.defaultPrevented || event.isComposing || somethingOnTop() || focusTakes(event)) return
  if (lengthEdit.value) return
  // An empty page (ISS-036) shows no floor: no key may change the one hidden behind it.
  if (!pageFloors.value.length && !((event.ctrlKey || event.metaKey) && event.key === '/') && event.key !== '?') return
  const plan = canvas.value
  const command = event.ctrlKey || event.metaKey
  if (!command && !event.altKey && plan?.keydown(event)) return
  const run = (action: () => void) => {
    event.preventDefault()
    action()
  }
  if (command && !event.altKey) {
    const key = event.key.toLowerCase()
    if (key === 'd' && !event.shiftKey) return run(duplicateSelection)
    // Copy and paste (ISS-022): in memory, on the floor copied from.
    // Command search (owner, 2026-11-13: like Figma's Ctrl/⌘+/).
    if (key === '/') return run(() => (commandsOpen.value = true))
    if (key === 'c' && !event.shiftKey && mode.value === 'select' && props.editor.selected.value.length) return run(() => props.editor.copy())
    if (key === 'v' && !event.shiftKey && mode.value === 'select' && props.editor.clipboard.value) return run(pasteCopied)
    if (key === 'a' && !event.shiftKey && mode.value === 'select') return run(selectAll)
    if (key === '=' || key === '+') return run(() => plan?.zoom(1))
    if (key === '-') return run(() => plan?.zoom(-1))
    // Ctrl/⌘+0 (ISS-006): 100 %, and the browser's own page zoom does not reset.
    if (key === '0' && !event.shiftKey) return run(() => plan?.zoomTo(100))
    return
  }
  if (event.altKey) return
  // Shift with a digit: the code, since Shift+1 types "!" (Figma's zoom keys).
  if (event.shiftKey && event.code === 'Digit1') return run(() => plan?.fit())
  if (event.shiftKey && event.code === 'Digit2') return run(() => plan?.zoomToSelection())
  if (event.shiftKey && event.code === 'Digit0') return run(() => plan?.zoomTo(100))
  if (event.key === '?') return run(showShortcuts)
  // Tab and Shift+Tab while the plan has the focus (ISS-007, Figma): the next or previous piece, in
  // the Floors list's order. Anywhere else Tab moves the focus as usual.
  if (event.key === 'Tab' && mode.value === 'select' && !pending.value && planFocused()) return run(() => selectNext(event.shiftKey ? -1 : 1))
  if (event.key === 'Escape') {
    if (pending.value) return run(() => pending.value = null)
    if (mode.value !== 'select') return run(finishTool)
    // Nothing selected: the page gets the focus back, so Tab leaves the plan (no keyboard trap).
    if (!selection.value && planFocused()) return run(() => (document.activeElement as HTMLElement).blur())
    return
  }
  // Enter opens Edit points on the floor (Figma's Enter into a shape's points), and closes it again.
  if (event.key === 'Enter' && !event.shiftKey && floor.value && floor.value.slabs.length) {
    if (mode.value === 'select' && (!selection.value || selection.value.kind === 'slab')) return run(() => startTool('outline'))
    if (mode.value === 'outline') return run(finishTool)
  }
  // Figma's flips (ED-07): Shift+H, Shift+V on the selected pieces.
  if (event.shiftKey && mode.value === 'select' && (event.code === 'KeyH' || event.code === 'KeyV') && props.editor.selected.value.some(target => target.kind === 'item')) {
    return run(() => flip(event.code === 'KeyH' ? 'flipX' : 'flipY'))
  }
  if (event.shiftKey) return
  const tools: Record<string, PlanMode> = { v: 'select', h: 'hand', r: 'room', s: 'shape', o: 'shape', p: 'outline', w: 'wall' }
  const key = event.key.toLowerCase()
  if (key === 'g') return run(cycleSnap)
  if (key === 's' || key === 'o') {
    roundShape.value = key === 'o'
    polygonShapeOn.value = false
  }
  const tool = tools[key]
  if (tool && floor.value) return run(() => (tool === mode.value ? undefined : startTool(tool)))
}
useEventListener('keydown', onStudioKey)

/**
 * The snap step (plan Phase 2): G cycles 1, 5, 10 and 25 cm, and a toast says which. Moves,
 * drawing and resizing land on it; the arrow keys keep their 1 and 10 cm. Kept while the editor is
 * open, not saved.
 */
const snapStep = ref<number>(SNAP_CM)
function cycleSnap() {
  snapStep.value = nextSnapStep(snapStep.value)
  toast.add({ id: 'snap-step', title: `Snap to ${snapStep.value} cm`, color: 'neutral', icon: 'i-lucide-grid-2x2' })
}

// --- The right-click menu (D278) ---

/**
 * What a right-click offers for the selection (the plan picks what's under the pointer first): the
 * quick bar's actions with their keys, so a mouse needs no bar over the plan. Empty plan: zoom and
 * the drawing tools.
 */
const contextItems = computed((): ContextMenuItem[][] => {
  const target = selection.value
  const plan = canvas.value
  const zoomItems: ContextMenuItem[] = [
    { label: 'Zoom to selection', icon: 'i-lucide-scan-search', kbds: ['shift', '2'], onSelect: () => plan?.zoomToSelection() },
  ]
  if (multi.value) {
    return [[
      { label: 'Rotate 90°', icon: 'i-lucide-rotate-cw', kbds: ['shift', 'r'], onSelect: turnGroup },
      { label: 'Flip horizontal', icon: 'i-lucide-flip-horizontal-2', kbds: ['shift', 'h'], disabled: group.value.every(member => member.kind !== 'item'), onSelect: () => flip('flipX') },
      { label: 'Flip vertical', icon: 'i-lucide-flip-vertical-2', kbds: ['shift', 'v'], disabled: group.value.every(member => member.kind !== 'item'), onSelect: () => flip('flipY') },
      { label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], disabled: group.value.every(member => member.kind === 'table'), onSelect: duplicateGroup },
    ], ...editGroup([...group.value]), zoomItems, [
      { label: `Delete ${group.value.length}`, icon: 'i-lucide-trash-2', color: 'error' as const, kbds: ['delete'], onSelect: removeGroup },
    ]]
  }
  if (selectedPlacement.value) {
    const tableId = selectedPlacement.value.tableId
    return [[
      { label: 'Rotate 90°', icon: 'i-lucide-rotate-cw', kbds: ['shift', 'r'], onSelect: () => turn(90) },
      { label: 'Duplicate look', icon: 'i-lucide-copy', kbds: ['meta', 'd'], onSelect: () => void duplicateLook(tableId) },
    ], [
      { label: 'Edit table', icon: 'i-lucide-pencil', onSelect: editTable },
      { label: 'View QR', icon: 'i-lucide-qr-code', onSelect: viewQr },
    ], ...editGroup([{ kind: 'table', id: tableId }]), zoomItems, [
      { label: 'Remove from map', icon: 'i-lucide-map-pin-off', kbds: ['delete'], onSelect: () => remove({ kind: 'table', id: tableId }) },
    ]]
  }
  if (selectedItem.value) {
    const itemId = selectedItem.value.id
    return [[
      { label: 'Rotate 90°', icon: 'i-lucide-rotate-cw', kbds: ['shift', 'r'], onSelect: () => turn(90) },
      { label: 'Flip horizontal', icon: 'i-lucide-flip-horizontal-2', kbds: ['shift', 'h'], onSelect: () => flip('flipX') },
      { label: 'Flip vertical', icon: 'i-lucide-flip-vertical-2', kbds: ['shift', 'v'], onSelect: () => flip('flipY') },
      { label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], onSelect: () => duplicateItem(itemId) },
    ], ...editGroup([{ kind: 'item', id: itemId }]), zoomItems, [
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', kbds: ['delete'], onSelect: () => remove({ kind: 'item', id: itemId }) },
    ]]
  }
  if (selectedWall.value && target && floor.value) {
    const wall = selectedWall.value
    const walls = floor.value.walls
    const kind = wallKind(wall)
    return [
      INNER_WALL_OPTIONS.map(option => ({ label: option.label, type: 'checkbox' as const, checked: kind === option.value, onSelect: () => setWalls(setWallKind(walls, wall.id, option.value)) })),
      [
        { label: kind === 'railing' ? 'Add a gate' : kind === 'wall' ? 'Add a door' : 'Add an opening', icon: 'i-lucide-door-open', disabled: !wallOpeningFits(wall, 'door'), onSelect: () => setWalls(addWallOpening(walls, wall.id, 'door', newLayoutId('door'))) },
        ...(kind === 'wall' ? [{ label: 'Add a window', icon: 'i-lucide-app-window', disabled: !wallOpeningFits(wall, 'window'), onSelect: () => setWalls(addWallOpening(walls, wall.id, 'window', newLayoutId('window'))) }] : []),
      ],
      ...editGroup([target]),
      zoomItems,
      [{ label: 'Delete wall', icon: 'i-lucide-trash-2', color: 'error' as const, kbds: ['delete'], onSelect: () => remove(target) }],
    ]
  }
  if (selectedSlab.value && target) {
    return [[
      { label: 'Edit points', icon: 'i-lucide-pen-tool', kbds: ['enter'], onSelect: () => startTool('outline') },
    ], [{ label: 'Delete floor surface', icon: 'i-lucide-trash-2', color: 'error' as const, kbds: ['delete'], onSelect: () => remove(target) }]]
  }
  return [...(props.editor.clipboard.value
    ? [[{ label: 'Paste here', icon: 'i-lucide-clipboard-paste', kbds: ['meta', 'v'], onSelect: () => pasteCopied(plan?.contextPoint) }]]
    : []), [
    { label: 'Fit to screen', icon: 'i-lucide-scan', kbds: ['shift', '1'], onSelect: () => plan?.fit() },
    { label: 'Zoom to 100%', icon: 'i-lucide-search', kbds: ['meta', '0'], onSelect: () => plan?.zoomTo(100) },
  ], [
    { label: 'Room', icon: 'i-lucide-square-plus', kbds: ['r'], onSelect: () => startTool('room') },
    { label: 'Edit points', icon: 'i-lucide-pen-tool', kbds: ['p'], onSelect: () => startTool('outline') },
    { label: 'Draw wall', icon: 'i-lucide-brick-wall', kbds: ['w'], onSelect: () => startTool('wall') },
  ], [
    // The shortcut list from a menu too (ISS-025), not only by its key.
    { label: 'Search actions', icon: 'i-lucide-search', kbds: ['meta', '/'], onSelect: () => (commandsOpen.value = true) },
    { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: showShortcuts },
  ]]
})

// --- Quick actions beside the selection (2B) ---

/**
 * The quick bar is for fingers (D278): on a touch screen, or where Properties is a sheet. A mouse
 * gets the right-click menu and Properties instead, so nothing covers the plan.
 */
const coarsePointer = useMediaQuery('(pointer: coarse)')
const showQuickBar = computed(() => coarsePointer.value || !isExpanded.value)

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

/** A size field's value: whole centimetres, and only when it changed (no undo step for nothing). */
function setNumber(value: number | null | undefined, current: number, apply: (value: number) => void) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  const next = Math.round(value)
  if (next !== current) apply(next)
}

// --- Typed position and turn (D277): Enter or leaving the field commits, one undo step each ---

const placed = computed(() => selectedPlacement.value ?? selectedItem.value)

function setPosition(axis: 'x' | 'y', value: number | null | undefined) {
  const target = selection.value
  const current = placed.value
  if (!target || !current) return
  setNumber(value, current[axis], next => move(target, { x: current.x, y: current.y, [axis]: next }))
}

/** Any angle typed is kept as 0–359°: 360 is 0, −90 is 270. */
function setRotation(value: number | null | undefined) {
  const target = selection.value
  const current = placed.value
  if (!target || !current || typeof value !== 'number' || !Number.isFinite(value)) return
  const next = normalizeRotation(Math.round(value))
  if (next !== current.rotation) rotate(target, next)
}

const swatch = (finish: Finish) => FINISH_SWATCHES[finish]

function chooseStarter(starter: Starter) {
  props.editor.begin(starter.layout())
}

/** The toolbar's tools with their keys (D278: Draw outline and Draw wall are tools of their own). */
const planTools = [
  { mode: 'select', label: 'Select', icon: 'i-lucide-mouse-pointer-2', kbds: ['v'] },
  { mode: 'hand', label: 'Hand', icon: 'i-lucide-hand', kbds: ['h'] },
  { mode: 'room', label: 'Room', icon: 'i-lucide-square-plus', kbds: ['r'] },
  { mode: 'shape', label: 'Shape', icon: 'i-lucide-shapes', kbds: ['s'] },
  { mode: 'outline', label: 'Edit points', icon: 'i-lucide-pen-tool', kbds: ['p'] },
  { mode: 'wall', label: 'Draw wall', icon: 'i-lucide-brick-wall', kbds: ['w'] },
] as const satisfies readonly { mode: PlanMode, label: string, icon: string, kbds: readonly string[] }[]
const drawing = computed(() => mode.value === 'outline' || mode.value === 'wall' || mode.value === 'room' || mode.value === 'shape')
/** The Shape tool draws a round block (O) rather than a block (S) (D278). */
const roundShape = ref(false)
/** The Shape tool draws a polygon corner by corner (plan Phase 4). */
const polygonShapeOn = ref(false)
/** Room adds by default; the tool bar's Cut cuts the rectangle out (owner: Alt draws from the middle, like Figma). */
const roomCut = ref(false)
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
    <!-- Find (D277): the floors and the named pieces on the floor shown, in place of the list. -->
    <div
      v-if="panel === 'floors' && finding"
      class="flex flex-col gap-3"
    >
      <div class="flex items-center gap-2">
        <UInput
          v-model="findQuery"
          icon="i-lucide-search"
          placeholder="Find floors and pieces…"
          aria-label="Find floors and pieces"
          autofocus
          class="min-w-0 flex-1"
          @keydown.esc.stop.prevent="stopFind()"
        />
        <UTooltip text="Close Find">
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Close Find"
            @click="stopFind()"
          />
        </UTooltip>
      </div>
      <p
        v-if="!foundFloors.length && !foundPieces.length"
        class="text-sm text-muted"
      >
        No floors or pieces match.
      </p>
      <UButton
        v-for="candidate in foundFloors"
        :key="candidate.id"
        :label="candidate.name"
        icon="i-lucide-layers"
        :color="candidate.id === floor?.id ? 'primary' : 'neutral'"
        variant="ghost"
        class="justify-start"
        @click="selectFloor(candidate.id); stopFind(); sheet = null"
      />
      <template v-if="foundPieces.length">
        <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
          On {{ floor?.name }}
        </h3>
        <UButton
          v-for="piece in foundPieces"
          :key="piece.selection.id"
          :label="piece.label"
          :icon="piece.icon"
          color="neutral"
          variant="ghost"
          class="justify-start"
          @click="floor && selectPlaced(piece.selection, floor.id); stopFind()"
        />
      </template>
    </div>
    <div
      v-else-if="panel === 'floors'"
      class="flex flex-col gap-2"
    >
      <!-- Pages (ISS-036, like Figma's): above the layers, each a group of floors by purpose. -->
      <section
        aria-label="Pages"
        class="flex flex-col border-b border-default pb-2"
        data-testid="studio-pages"
      >
        <div class="flex min-h-7 items-center justify-between">
          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
            Pages
          </h3>
          <UTooltip text="Add page">
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Add page"
              @click="newPage()"
            />
          </UTooltip>
        </div>
        <StudioLayerRow
          v-for="page in pages"
          :key="page.id"
          :label="page.name"
          icon="i-lucide-file"
          :current="page.id === pageId"
          :flags="false"
          :testid="`page-${page.name}`"
          @select="selectPage(page.id)"
          @rename="name => renamePageNamed(page.id, name)"
        >
          <template
            v-if="pages.length > 1"
            #actions
          >
            <UTooltip text="Delete page">
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Delete page ${page.name}`"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                @click="deletePage(page.id)"
              />
            </UTooltip>
          </template>
        </StudioLayerRow>
      </section>
      <p
        v-if="!pageFloors.length"
        class="text-sm text-muted"
        data-testid="page-empty"
      >
        No floors on this page yet. Add a floor, or move one here from its Properties.
      </p>
      <div
        v-for="candidate in pageFloors"
        :key="candidate.id"
      >
        <UInput
          v-if="renaming?.id === candidate.id"
          v-model="renaming.name"
          :maxlength="30"
          aria-label="New floor name"
          autofocus
          class="w-full"
          :data-testid="`floor-name-${candidate.name}`"
          @keydown.enter.prevent="commitRename(candidate.id)"
          @keydown.esc.stop.prevent="renaming = null"
          @blur="commitRename(candidate.id)"
        />
        <!-- Layers (ISS-021): the floor as a frame, then what is on it, like Figma's layers list. -->
        <StudioLayerRow
          v-else
          :label="candidate.name"
          icon="i-lucide-frame"
          :current="candidate.id === floor?.id"
          :hidden="candidate.hidden"
          :locked="candidate.locked"
          :testid="`floor-tab-${candidate.name}`"
          @select="selectFloor(candidate.id); sheet = null"
          @rename="name => renameFloorLayer(candidate.id, name)"
          @hidden="on => setFloorFlag(candidate.id, 'hidden', on)"
          @locked="on => setFloorFlag(candidate.id, 'locked', on)"
        >
          <template #trailing>
            <span class="text-xs text-muted">{{ tablesOn(candidate.id).length }} {{ tablesOn(candidate.id).length === 1 ? 'table' : 'tables' }}</span>
          </template>
        </StudioLayerRow>
        <div
          v-if="candidate.id === floor?.id"
          class="mt-0.5 flex flex-col"
          role="group"
          :aria-label="`On ${candidate.name}`"
        >
          <StudioLayerRow
            v-for="table in tablesOn(candidate.id)"
            :key="table.tableId"
            :depth="1"
            :label="tableLabel(table.tableId) ?? 'Unavailable table'"
            icon="i-lucide-table-2"
            :selected="isPicked('table', table.tableId)"
            :hidden="table.hidden"
            :locked="table.locked"
            :renameable="false"
            :testid="`layer-table-${tableLabel(table.tableId)}`"
            @select="event => clickLayer({ kind: 'table', id: table.tableId }, candidate.id, event)"
            @hidden="on => setLayerFlag({ kind: 'table', id: table.tableId }, candidate.id, 'hidden', on)"
            @locked="on => setLayerFlag({ kind: 'table', id: table.tableId }, candidate.id, 'locked', on)"
            @hover="on => layerHover = on ? { kind: 'table', id: table.tableId } : null"
          />
          <StudioLayerRow
            v-for="item in candidate.items"
            :key="item.id"
            :depth="1"
            :label="pieceLabel(item)"
            :icon="ITEM_ICONS[item.kind]"
            :selected="isPicked('item', item.id)"
            :hidden="item.hidden"
            :locked="item.locked"
            :testid="`layer-item-${item.id}`"
            @select="event => clickLayer({ kind: 'item', id: item.id }, candidate.id, event)"
            @rename="name => renameLayer({ kind: 'item', id: item.id }, candidate.id, name)"
            @hidden="on => setLayerFlag({ kind: 'item', id: item.id }, candidate.id, 'hidden', on)"
            @locked="on => setLayerFlag({ kind: 'item', id: item.id }, candidate.id, 'locked', on)"
            @hover="on => layerHover = on ? { kind: 'item', id: item.id } : null"
          />
          <StudioLayerRow
            v-for="(slab, index) in candidate.slabs"
            :key="slab.id"
            :depth="1"
            :label="slabLabel(slab, index)"
            icon="i-lucide-square-dashed"
            :selected="isPicked('slab', slab.id)"
            :hidden="slab.hidden"
            :locked="slab.locked"
            :testid="`layer-slab-${slab.id}`"
            @select="() => selectPlaced({ kind: 'slab', id: slab.id }, candidate.id)"
            @rename="name => renameLayer({ kind: 'slab', id: slab.id }, candidate.id, name)"
            @hidden="on => setLayerFlag({ kind: 'slab', id: slab.id }, candidate.id, 'hidden', on)"
            @locked="on => setLayerFlag({ kind: 'slab', id: slab.id }, candidate.id, 'locked', on)"
          />
          <StudioLayerRow
            v-for="(wall, index) in candidate.walls"
            :key="wall.id"
            :depth="1"
            :label="wallLabel(candidate.walls, index)"
            icon="i-lucide-brick-wall"
            :selected="isPicked('wall', wall.id)"
            :hidden="wall.hidden"
            :locked="wall.locked"
            :testid="`layer-wall-${wall.id}`"
            @select="event => clickLayer({ kind: 'wall', id: wall.id }, candidate.id, event)"
            @rename="name => renameLayer({ kind: 'wall', id: wall.id }, candidate.id, name)"
            @hidden="on => setLayerFlag({ kind: 'wall', id: wall.id }, candidate.id, 'hidden', on)"
            @locked="on => setLayerFlag({ kind: 'wall', id: wall.id }, candidate.id, 'locked', on)"
            @hover="on => layerHover = on ? { kind: 'wall', id: wall.id } : null"
          />
        </div>
      </div>
      <p
        v-if="!canAddFloor(layout)"
        class="text-xs text-muted"
        data-testid="floor-limit"
      >
        Add floor is off: a layout has at most {{ LAYOUT_MAX_FLOORS }} floors.
      </p>
    </div>
    <StudioLooksPanel v-else-if="panel === 'looks'" />
    <div
      v-else
      class="flex flex-col gap-4"
    >
      <div class="flex items-center gap-2">
        <SearchInput
          v-model="search"
          :placeholder="panel === 'tables' ? 'Search tables…' : 'Search assets…'"
          class="min-w-0 flex-1"
        />
        <UDropdownMenu
          v-if="panel === 'assets'"
          :items="createItems"
          :content="{ align: 'end' }"
        >
          <UTooltip text="New look">
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              aria-label="New look"
            />
          </UTooltip>
        </UDropdownMenu>
      </div>
      <section
        v-if="panel === 'tables'"
        class="flex flex-col gap-2"
      >
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
          class="flex flex-wrap items-center gap-2 rounded-md border border-default py-1.5 pr-1.5 pl-1"
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
          <span class="flex-1 text-sm whitespace-nowrap text-muted">{{ table.seats }} seats</span>
          <UButton
            label="Place on map"
            size="xs"
            variant="ghost"
            class="ml-auto"
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

      <section
        v-if="panel === 'tables'"
        class="flex flex-col gap-2"
      >
        <h2 class="text-sm font-semibold text-highlighted">
          On plan
        </h2>
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
        <p
          v-if="!placedTables.length"
          class="text-sm text-muted"
        >
          No placed tables match.
        </p>
      </section>

      <section
        v-if="panel === 'assets' && (!search || looks.some(look => matches(look.name)))"
        class="flex flex-col gap-2"
      >
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Table looks · chairs follow the table’s seats
        </h2>
        <div class="grid grid-cols-2 gap-2 @xs:grid-cols-3">
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
      </section>

      <!-- Saved groups (plan Phase 5, D284): the cafe's own, placed in the middle of the plan. -->
      <section
        v-if="panel === 'assets' && savedGroups.some(saved => matches(saved.name))"
        class="flex flex-col gap-2"
        data-testid="saved-groups"
      >
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Saved groups
        </h2>
        <div
          v-for="saved in savedGroups.filter(candidate => matches(candidate.name))"
          :key="saved.id"
          class="flex items-center gap-1"
        >
          <UButton
            :label="saved.name"
            icon="i-lucide-boxes"
            color="neutral"
            variant="outline"
            class="min-w-0 flex-1"
            :data-testid="`saved-group-${saved.name}`"
            @click="placeSavedGroup(saved)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            :aria-label="`Delete the group ${saved.name}`"
            @click="groupMutations.remove.execute({ group: saved })"
          />
        </div>
      </section>

      <section
        v-for="category in (panel === 'assets' ? catalog.filter(category => category.specs.some(spec => matches(spec.label)) || itemLooksIn(category.key).some(look => matches(look.name))) : [])"
        :key="category.key"
        class="flex flex-col gap-2"
      >
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          {{ category.library }}
        </h2>
        <div class="grid grid-cols-2 gap-2 @xs:grid-cols-3">
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
      </section>
      <p
        v-if="panel === 'assets' && search && !looks.some(look => matches(look.name)) && !catalog.some(category => category.specs.some(spec => matches(spec.label)) || itemLooksIn(category.key).some(look => matches(look.name)))"
        class="text-sm text-muted"
      >
        No assets match “{{ search.trim() }}”.
      </p>
    </div>
  </DefineLibrary>

  <!-- What's selected (md and up beside the plan; below, in a slide-over). -->
  <!-- Position and turn (D277): typed (math too, ISS-020), arrows 1 or 10, a drag on the handle scrubs; Enter or leaving commits, Escape reverts. -->
  <DefineTransform v-slot="{ x, y, rotation }">
    <div
      class="flex flex-col gap-3"
      role="group"
      aria-label="Position and rotation"
    >
      <!-- Figma's align row for one piece (ED-11): to its floor's edges. -->
      <div
        role="group"
        aria-label="Align to floor"
        class="flex flex-wrap gap-1"
      >
        <UTooltip
          v-for="button in ALIGN_BUTTONS"
          :key="button.edge"
          :text="`${button.label} to the floor`"
        >
          <UButton
            :icon="button.icon"
            color="neutral"
            variant="ghost"
            :aria-label="`${button.label} to the floor`"
            :data-testid="`align-floor-${button.edge}`"
            @click="alignToFloor(button.edge)"
          />
        </UTooltip>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="X (cm)">
          <StudioNumberField
            :model-value="x"
            label="X"
            unit="cm"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            class="w-full"
            @update:model-value="value => setPosition('x', value)"
          />
        </UFormField>
        <UFormField label="Y (cm)">
          <StudioNumberField
            :model-value="y"
            label="Y"
            unit="cm"
            :min="-LAYOUT_MAX_EXTENT_CM"
            :max="LAYOUT_MAX_EXTENT_CM"
            class="w-full"
            @update:model-value="value => setPosition('y', value)"
          />
        </UFormField>
      </div>
      <UFormField label="Rotation (°)">
        <div class="flex gap-2">
          <StudioNumberField
            :model-value="rotation"
            label="Rotation"
            unit="°"
            :min="-360"
            :max="720"
            class="min-w-0 flex-1"
            @update:model-value="setRotation"
          />
          <UTooltip text="Turn 90° left">
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              aria-label="Turn 90° left"
              @click="turn(-90)"
            />
          </UTooltip>
          <UTooltip text="Turn 90° right">
            <UButton
              icon="i-lucide-rotate-cw"
              color="neutral"
              variant="outline"
              aria-label="Turn 90° right"
              @click="turn(90)"
            />
          </UTooltip>
        </div>
      </UFormField>
    </div>
  </DefineTransform>

  <DefineDetails>
    <!-- Several selected (D278): what the set holds and what can be done to all of it. -->
    <div
      v-if="multi"
      class="flex flex-col gap-4"
      data-testid="selected-group"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
          <UIcon
            name="i-lucide-boxes"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            {{ group.length }} selected
          </p>
          <p class="text-xs text-muted">
            {{ groupSummary }}
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Clear selection"
          @click="selection = null; detailsOpen = false"
        />
      </div>
      <p class="text-sm text-muted">
        Drag any of them, or use the arrow keys, to move them together. Shift+click adds or removes one.
      </p>
      <UButton
        v-if="group.some(member => member.kind !== 'table')"
        label="Save as group"
        icon="i-lucide-boxes"
        color="neutral"
        variant="outline"
        class="self-start"
        @click="saveAsGroup(group)"
      />
      <!-- Figma's align row (ISS-026): to the set's own edges. -->
      <div
        role="group"
        aria-label="Align"
        class="flex flex-wrap gap-1"
      >
        <UTooltip
          v-for="button in ALIGN_BUTTONS"
          :key="button.edge"
          :text="button.label"
        >
          <UButton
            :icon="button.icon"
            color="neutral"
            variant="ghost"
            :aria-label="button.label"
            :data-testid="`align-${button.edge}`"
            @click="alignGroup(button.edge)"
          />
        </UTooltip>
        <UTooltip
          v-for="button in DISTRIBUTE_BUTTONS"
          :key="button.axis"
          :text="group.length < 3 ? `${button.label} (three or more)` : button.label"
        >
          <UButton
            :icon="button.icon"
            color="neutral"
            variant="ghost"
            :aria-label="button.label"
            :disabled="group.length < 3"
            :data-testid="`distribute-${button.axis}`"
            @click="distributeGroup(button.axis)"
          />
        </UTooltip>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <UButton
          label="Rotate 90°"
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="outline"
          @click="turnGroup()"
        />
        <UButton
          label="Duplicate"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          :disabled="group.every(member => member.kind === 'table')"
          @click="duplicateGroup()"
        />
        <!-- A short label: the grid's half width cut "Zoom to selection" off (ISS-010). -->
        <UTooltip
          text="Zoom to selection"
          :kbds="['shift', '2']"
        >
          <UButton
            label="Zoom"
            icon="i-lucide-scan-search"
            color="neutral"
            variant="outline"
            aria-label="Zoom to selection"
            @click="canvas?.zoomToSelection()"
          />
        </UTooltip>
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          @click="removeGroup()"
        />
      </div>
      <p
        v-if="group.some(member => member.kind === 'table')"
        class="text-xs text-muted"
      >
        Delete takes tables off the map (back to Unplaced tables, QR codes unchanged). Duplicate copies furniture and walls, not tables.
      </p>
    </div>
    <div
      v-else-if="selectedPlacement && selectedLook"
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
        <UTooltip text="View QR">
          <UButton
            icon="i-lucide-qr-code"
            color="neutral"
            variant="ghost"
            aria-label="View QR"
            :disabled="!selectedDiningTable?.qrUrl"
            @click="viewQr()"
          />
        </UTooltip>
        <UTooltip text="Remove from map">
          <UButton
            icon="i-lucide-map-pin-off"
            color="neutral"
            variant="ghost"
            aria-label="Remove from map"
            @click="remove(selection!)"
          />
        </UTooltip>
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
      <ReuseTransform
        :x="selectedPlacement.x"
        :y="selectedPlacement.y"
        :rotation="selectedPlacement.rotation"
      />
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="Width (cm)">
          <StudioNumberField
            :model-value="selectedPlacement.width"
            label="Width"
            unit="cm"
            :min="40"
            :max="600"
            @update:model-value="value => setNumber(value, selectedPlacement!.width, width => updateTable(selectedPlacement!.tableId, { width, ...(selectedLook!.shape === 'round' ? { depth: width } : {}) }))"
          />
        </UFormField>
        <UFormField label="Depth (cm)">
          <StudioNumberField
            :model-value="selectedPlacement.depth"
            label="Depth"
            unit="cm"
            :min="40"
            :max="600"
            :disabled="selectedLook.shape === 'round'"
            @update:model-value="value => setNumber(value, selectedPlacement!.depth, depth => updateTable(selectedPlacement!.tableId, { depth }))"
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
      <USeparator label="Look" />
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
          <p class="truncate text-base font-semibold text-highlighted">
            {{ selectedItem.name ?? ITEM_SPECS[selectedItem.kind].label }}
          </p>
          <p class="text-xs text-muted">
            {{ isShapeKind(selectedItem.kind) ? ITEM_SPECS[selectedItem.kind].label : selectedItem.kind === 'stairs' ? 'Structure' : isFigureKind(selectedItem.kind) ? 'Decoration' : 'Furniture' }} · no QR code
          </p>
        </div>
        <UTooltip text="Delete">
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            aria-label="Delete"
            @click="remove(selection!)"
          />
        </UTooltip>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null; detailsOpen = false"
        />
      </div>
      <ReuseTransform
        :x="selectedItem.x"
        :y="selectedItem.y"
        :rotation="selectedItem.rotation"
      />
      <!-- Figma's flips (ED-07): mirrored on the plan and in 3D. -->
      <div
        role="group"
        aria-label="Flip"
        class="flex gap-1"
      >
        <UTooltip
          text="Flip horizontal"
          :kbds="['shift', 'h']"
        >
          <UButton
            icon="i-lucide-flip-horizontal-2"
            color="neutral"
            :variant="selectedItem.flipX ? 'soft' : 'ghost'"
            aria-label="Flip horizontal"
            :aria-pressed="!!selectedItem.flipX"
            @click="flip('flipX')"
          />
        </UTooltip>
        <UTooltip
          text="Flip vertical"
          :kbds="['shift', 'v']"
        >
          <UButton
            icon="i-lucide-flip-vertical-2"
            color="neutral"
            :variant="selectedItem.flipY ? 'soft' : 'ghost'"
            aria-label="Flip vertical"
            :aria-pressed="!!selectedItem.flipY"
            @click="flip('flipY')"
          />
        </UTooltip>
      </div>
      <div
        v-if="!isFigureKind(selectedItem.kind)"
        class="grid grid-cols-2 gap-2"
      >
        <UFormField label="Width (cm)">
          <StudioNumberField
            :model-value="selectedItem.width"
            label="Width"
            unit="cm"
            :min="10"
            :max="2000"
            @update:model-value="value => setNumber(value, selectedItem!.width, width => updateItem(selectedItem!.id, { width, ...(keepsCircle(selectedItem!.kind) ? { depth: width } : {}) }))"
          />
        </UFormField>
        <UFormField label="Depth (cm)">
          <StudioNumberField
            :model-value="selectedItem.depth"
            label="Depth"
            unit="cm"
            :min="10"
            :max="2000"
            :disabled="keepsCircle(selectedItem.kind)"
            @update:model-value="value => setNumber(value, selectedItem!.depth, depth => updateItem(selectedItem!.id, { depth }))"
          />
        </UFormField>
        <UFormField
          v-if="isShapeKind(selectedItem.kind)"
          label="Name"
          help="Shown on the plan, for example Stage or Planter box."
          class="col-span-2"
        >
          <UInput
            :model-value="selectedItem.name ?? ''"
            :maxlength="SHAPE_NAME_MAX"
            placeholder="Block"
            @change="(event: Event) => setShapeName(selectedItem!.id, (event.target as HTMLInputElement).value)"
            @keydown.enter="(event: KeyboardEvent) => setShapeName(selectedItem!.id, (event.target as HTMLInputElement).value)"
          />
        </UFormField>
        <UFormField
          v-if="itemHeightRange(selectedItem.kind)"
          label="Height (cm)"
          :help="`${itemHeightRange(selectedItem.kind)!.min} to ${itemHeightRange(selectedItem.kind)!.max} cm`"
          class="col-span-2"
        >
          <StudioNumberField
            :model-value="pieceHeight(selectedItem)"
            label="Height"
            unit="cm"
            :min="itemHeightRange(selectedItem.kind)!.min"
            :max="itemHeightRange(selectedItem.kind)!.max"
            @update:model-value="value => setNumber(value, pieceHeight(selectedItem!), height => updateItem(selectedItem!.id, { height }))"
          />
        </UFormField>
        <!-- Off the floor (D282, plan Phase 4): a shelf on a wall, a sign; 0 stands on the floor. -->
        <UFormField
          v-if="selectedItem.kind !== 'stairs' && !isFigureKind(selectedItem.kind)"
          label="Above the floor (cm)"
          :help="`0 to ${floor?.height ?? FLOOR_HEIGHT_MAX_CM} cm`"
          class="col-span-2"
        >
          <StudioNumberField
            :model-value="selectedItem.z ?? 0"
            label="Above the floor"
            unit="cm"
            :min="0"
            :max="floor?.height ?? FLOOR_HEIGHT_MAX_CM"
            @update:model-value="value => setNumber(value, selectedItem!.z ?? 0, z => updateItem(selectedItem!.id, { z }))"
          />
        </UFormField>
        <!-- A rectangle shape's corner radius (ED-05); also by the dots inside its corners. -->
        <UFormField
          v-if="selectedItem.kind === 'block'"
          label="Corner radius (cm)"
          :help="`0 to ${maxRadius(selectedItem.width, selectedItem.depth)} cm`"
          class="col-span-2"
        >
          <StudioNumberField
            :model-value="selectedItem.radius ?? 0"
            label="Corner radius"
            unit="cm"
            :min="0"
            :max="maxRadius(selectedItem.width, selectedItem.depth)"
            @update:model-value="value => setNumber(value, selectedItem!.radius ?? 0, radius => updateItem(selectedItem!.id, { radius: radius || undefined }))"
          />
        </UFormField>
        <!-- A round shape's arc (ED-06): Figma's Start, Sweep and Ratio; also by the dots on the plan. -->
        <template v-if="selectedItem.kind === 'block-round'">
          <UFormField label="Start (°)">
            <StudioNumberField
              :model-value="selectedItem.arcStart ?? 0"
              label="Start"
              unit="°"
              :min="0"
              :max="359"
              @update:model-value="value => setNumber(value, selectedItem!.arcStart ?? 0, arcStart => updateItem(selectedItem!.id, { arcStart: arcStart || undefined }))"
            />
          </UFormField>
          <UFormField label="Sweep (°)">
            <StudioNumberField
              :model-value="selectedItem.arcSweep ?? 360"
              label="Sweep"
              unit="°"
              :min="SHAPE_ARC.sweepMin"
              :max="360"
              @update:model-value="value => setNumber(value, selectedItem!.arcSweep ?? 360, arcSweep => updateItem(selectedItem!.id, { arcSweep: arcSweep >= 360 ? undefined : arcSweep }))"
            />
          </UFormField>
          <UFormField
            label="Ratio (%)"
            help="The hole in the middle: 0 for none, up to 95 for a thin ring."
            class="col-span-2"
          >
            <StudioNumberField
              :model-value="selectedItem.arcInner ?? 0"
              label="Ratio"
              unit="%"
              :min="0"
              :max="SHAPE_ARC.innerMax"
              @update:model-value="value => setNumber(value, selectedItem!.arcInner ?? 0, arcInner => updateItem(selectedItem!.id, { arcInner: arcInner || undefined }))"
            />
          </UFormField>
        </template>
      </div>
      <template v-if="isItemLookKind(selectedItem.kind)">
        <USeparator label="Look" />
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
      <USeparator
        v-if="!selectedItemLook && ITEM_SPECS[selectedItem.kind].slots.length"
        label="Finishes"
      />
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
    </div>

    <WallPanel
      v-else-if="selectedWall && floor"
      :walls="floor.walls"
      :wall="selectedWall"
      :floor-height="floor.height"
      @change="setWalls"
      @remove="remove(selection!)"
      @close="selection = null; detailsOpen = false"
    />

    <!-- A floor surface (D282): its area, Edit points, and a real delete (ISS-046). -->
    <div
      v-else-if="selectedSlab && floor"
      class="flex flex-col gap-4"
      data-testid="selected-slab"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
          <UIcon
            name="i-lucide-square-dashed"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            {{ selectedSlab.name ?? 'Floor surface' }}
          </p>
          <p class="text-xs text-muted tabular-nums">
            {{ areaM2(selectedSlab.outline) }} m² · {{ selectedSlab.outline.length }} corners
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          aria-label="Delete floor surface"
          @click="remove(selection!)"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close panel"
          @click="selection = null; detailsOpen = false"
        />
      </div>
      <UButton
        label="Edit points"
        icon="i-lucide-pen-tool"
        color="neutral"
        variant="outline"
        class="self-start"
        @click="startTool('outline')"
      />
      <p class="text-xs text-muted">
        Deleting the surface keeps its walls; delete a wall on its own to remove it.
      </p>
    </div>
    <!-- Nothing selected (D277): the floor shown, then Explore. These were the floor bar's menu. -->
    <div
      v-else-if="floor"
      class="flex flex-col gap-4"
      data-testid="floor-settings"
    >
      <section
        class="flex flex-col gap-3"
        :aria-labelledby="`${detailsId}-floor`"
      >
        <h3
          :id="`${detailsId}-floor`"
          class="text-sm font-semibold text-highlighted"
        >
          {{ floor.name }} floor
        </h3>
        <UFormField label="Floor name">
          <UInput
            v-model="floorName"
            :maxlength="30"
            class="w-full"
            @blur="renameFloor()"
            @keydown.enter="renameFloor()"
            @keydown.esc.stop.prevent="floorName = floor.name; ($event.target as HTMLInputElement).blur()"
          />
        </UFormField>
        <UFormField
          label="Floor height (cm)"
          help="The wall height in 3D."
        >
          <StudioNumberField
            :model-value="floor.height"
            label="Floor height"
            unit="cm"
            :min="200"
            :max="800"
            class="w-full"
            @update:model-value="setHeight"
          />
        </UFormField>
        <USwitch
          :model-value="floor.hasRoof"
          label="Roof over this floor"
          description="Off: open to the sky, like a rooftop patio."
          @update:model-value="setRoof"
        />
        <USwitch
          v-if="floorIndex > 0"
          v-model="showBelow"
          label="Show floor below"
          description="On the plan only, to line this floor up."
        />
        <UFormField
          v-if="pages.length > 1"
          label="Page"
        >
          <USelect
            :model-value="floorPageId(floor, pages)"
            :items="pages.map(page => ({ label: page.name, value: page.id }))"
            class="w-full"
            data-testid="floor-page"
            @update:model-value="value => moveFloorToPage(String(value))"
          />
        </UFormField>
        <!-- The floor as a frame on Studio's canvas (ISS-035): design-only, 3D stacks floors by order. -->
        <div
          class="grid grid-cols-2 gap-2"
          role="group"
          aria-label="Frame on the canvas"
        >
          <UFormField label="Frame X (cm)">
            <StudioNumberField
              :model-value="frameAt.x"
              label="Frame X"
              unit="cm"
              :min="-LAYOUT_MAX_EXTENT_CM"
              :max="LAYOUT_MAX_EXTENT_CM"
              :disabled="floor.locked"
              class="w-full"
              @update:model-value="value => setFrame({ x: value, y: frameAt.y })"
            />
          </UFormField>
          <UFormField label="Frame Y (cm)">
            <StudioNumberField
              :model-value="frameAt.y"
              label="Frame Y"
              unit="cm"
              :min="-LAYOUT_MAX_EXTENT_CM"
              :max="LAYOUT_MAX_EXTENT_CM"
              :disabled="floor.locked"
              class="w-full"
              @update:model-value="value => setFrame({ x: frameAt.x, y: value })"
            />
          </UFormField>
        </div>
        <!-- Floor order (owner: it matters): the ground floor first; 3D and stairs follow it. -->
        <div
          class="flex items-center gap-2"
          role="group"
          aria-label="Floor order"
        >
          <span class="flex-1 text-sm text-default">Order: {{ floorIndex + 1 }} of {{ floors.length }}</span>
          <UButton
            icon="i-lucide-arrow-down"
            label="Down"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="floorIndex <= 0"
            data-testid="floor-down"
            @click="moveFloor(-1)"
          />
          <UButton
            icon="i-lucide-arrow-up"
            label="Up"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="floorIndex >= floors.length - 1"
            data-testid="floor-up"
            @click="moveFloor(1)"
          />
        </div>
        <UButton
          label="Remove floor…"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          class="self-start"
          :disabled="floors.length <= 1"
          @click="removeFloor()"
        />
      </section>
      <template v-if="exploreEnabled">
        <USeparator />
        <section
          class="flex flex-col gap-2"
          :aria-labelledby="`${detailsId}-explore`"
        >
          <h3
            :id="`${detailsId}-explore`"
            class="text-sm font-semibold text-highlighted"
          >
            Explore
          </h3>
          <p class="text-xs text-muted">
            How customers walk into this branch in Explore.
          </p>
          <UButton
            label="Explore settings"
            icon="i-lucide-map-pin"
            color="neutral"
            variant="outline"
            class="self-start"
            @click="sheet = null; exploreOpen = true"
          />
        </section>
      </template>
      <USeparator />
      <p class="text-sm text-muted">
        Select something on the plan to edit it.
      </p>
    </div>
  </DefineDetails>

  <!-- The open panel's own actions, beside its title (Floors: Find and Add floor). -->
  <DefinePanelActions>
    <template v-if="panel === 'floors' && !finding">
      <UTooltip text="Find">
        <UButton
          icon="i-lucide-search"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Find"
          @click="startFind()"
        />
      </UTooltip>
      <UTooltip text="Add floor">
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Add floor"
          :disabled="!canAddFloor(layout)"
          @click="addFloor()"
        />
      </UTooltip>
    </template>
  </DefinePanelActions>

  <!-- The panel rail: down the sidebar on a wide screen, across the top of the sheet below it. -->
  <DefineRail v-slot="{ vertical }">
    <nav
      aria-label="Studio panels"
      :class="vertical ? 'flex w-16 shrink-0 flex-col gap-1 border-r border-default p-1' : 'grid grid-cols-4 gap-1'"
    >
      <UButton
        v-for="option in panels"
        :key="option.value"
        :label="option.label"
        :icon="option.icon"
        :color="option.value === panel ? 'primary' : 'neutral'"
        :variant="option.value === panel ? 'soft' : 'ghost'"
        :aria-pressed="option.value === panel"
        size="sm"
        class="flex-col gap-1"
        :ui="{ label: 'text-xs text-center whitespace-normal', leadingIcon: 'size-4' }"
        @click="showPanel(option.value)"
      />
    </nav>
  </DefineRail>

  <div
    v-if="editor.error.value || !editor.ready.value || !floor"
    class="flex h-full min-h-0 flex-col"
  >
    <slot
      name="sidebar-header"
      :collapsible="false"
    />
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
    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <LayoutStarterPicker
        :table-count="tables.length"
        @choose="chooseStarter"
      />
    </div>
  </div>

  <div
    v-else
    class="relative flex h-full min-h-0"
  >
    <AppDrawer
      v-if="isCompact"
      :open="sheet !== null"
      :title="detailsOpen ? 'Properties' : panelTitle"
      @update:open="open => !open && (sheet = null)"
    >
      <template #body>
        <ReuseDetails v-if="detailsOpen" />
        <div
          v-else
          class="flex flex-col gap-4"
        >
          <slot
            name="sidebar-header"
            :collapsible="false"
          />
          <ReuseRail :vertical="false" />
          <div class="flex justify-end gap-1 empty:hidden">
            <ReusePanelActions />
          </div>
          <ReuseLibrary />
        </div>
      </template>
    </AppDrawer>
    <AppSlideover
      v-else-if="!isExpanded"
      :open="sheet !== null"
      :title="detailsOpen ? 'Properties' : panelTitle"
      :side="detailsOpen ? 'right' : 'left'"
      @update:open="open => !open && (sheet = null)"
    >
      <template #body>
        <ReuseDetails v-if="detailsOpen" />
        <div
          v-else
          class="flex flex-col gap-4"
        >
          <slot
            name="sidebar-header"
            :collapsible="false"
          />
          <ReuseRail :vertical="false" />
          <div class="flex justify-end gap-1 empty:hidden">
            <ReusePanelActions />
          </div>
          <ReuseLibrary />
        </div>
      </template>
    </AppSlideover>

    <!-- The sidebar and the plan (D277): one splitter, so hiding or resizing the sidebar never mounts
         the plan again. Below 1024 px the sidebar panel stays collapsed and the sheets take over. -->
    <USplitter
      id="studio-split"
      ref="splitter"
      :items="splitItems"
      :keyboard-resize-by="2"
      class="min-w-0 flex-1"
      :ui="{ handle: 'z-10 -mx-1 max-lg:hidden' }"
      @collapse="index => index === 0 && isExpanded && (sidebarOpen = false)"
      @expand="index => index === 0 && (sidebarOpen = true)"
    >
      <template #sidebar>
        <!-- The sidebar (D277): Studio's header, the panel rail and the open panel. -->
        <div
          v-if="sidebarShown"
          ref="sidebarElement"
          data-testid="studio-sidebar"
          class="flex w-full min-w-0 flex-col border-r border-default bg-default"
        >
          <slot
            name="sidebar-header"
            :collapsible="true"
          />
          <div class="flex min-h-0 flex-1">
            <ReuseRail :vertical="true" />
            <aside
              :aria-label="panelTitle"
              class="@container min-w-0 flex-1 overflow-y-auto p-3"
            >
              <div class="mb-3 flex min-h-8 items-center gap-1 border-b border-default pb-3">
                <h2 class="min-w-0 flex-1 text-sm font-semibold text-highlighted">
                  {{ panelTitle }}
                </h2>
                <ReusePanelActions />
              </div>
              <ReuseLibrary />
            </aside>
          </div>
        </div>
      </template>
      <template #canvas>
        <!-- The plan -->
        <main
          ref="planArea"
          aria-label="Floor plan"
          class="relative h-full min-w-0 flex-1 bg-muted"
        >
          <UContextMenu
            :items="contextItems"
            :disabled="mode !== 'select' || !!pending"
            :modal="false"
          >
            <!-- One element for the menu's trigger: the canvas has several roots (its live regions). -->
            <div class="size-full">
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
                :round-shape="roundShape"
                :room-cut="roomCut"
                :list-hover="layerHover"
                :frames="otherFrames"
                :frame-offsets="frameOffsets"
                :group="group"
                :placing="!!pending"
                :slab-id="activeSlab?.id ?? null"
                :snap-step="snapStep"
                :polygon-shape="polygonShapeOn"
                @polygon="placePolygon"
                @open-floor="selectFloor"
                @place="placePending"
                @cancel-place="pending = null"
                @select="selection = $event"
                @move="move"
                @copy="copyTo"
                @rotate="rotate"
                @resize="resize"
                @shape-edit="editShape"
                @remove="remove"
                @shape="updateShape"
                @new-slab="addSlab"
                @add-wall="addWall"
                @walls="setWalls"
                @room="applyRoom"
                @block="placeShape"
                @toggle="toggleSelected"
                @select-many="selectBox"
                @move-group="moveGroup"
                @edit-points="id => { slabId = id; startTool('outline') }"
                @edit-length="editLength"
                @move-frame="moveFrame"
              />
            </div>
          </UContextMenu>

          <!-- A page with no floors yet (ISS-036): nothing to draw. -->
          <div
            v-if="!pageFloors.length"
            class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center"
            data-testid="plan-empty-page"
          >
            <UIcon
              name="i-lucide-file"
              class="size-8 text-dimmed"
            />
            <p class="max-w-72 text-sm text-muted">
              This page has no floors. Add one, or move a floor here from its Properties.
            </p>
            <UButton
              label="Add floor"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              :disabled="!canAddFloor(layout)"
              @click="addFloor()"
            />
          </div>

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
              :aria-label="`${(activeSlab ? edgeNames(activeSlab.outline) : [])[lengthEdit.index] ?? 'Edge'} length (cm)`"
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
            v-if="showQuickBar && !multi && mode === 'select' && quickBarStyle && (selectedPlacement || selectedItem)"
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
            v-else-if="showQuickBar && !multi && mode === 'select' && quickBarStyle && selectedWall"
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
          <div class="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <UTooltip
                  v-if="!isExpanded || !sidebarOpen"
                  :text="isExpanded ? 'Show sidebar' : 'Open Studio sidebar'"
                >
                  <UButton
                    icon="i-lucide-panel-left-open"
                    color="neutral"
                    variant="outline"
                    class="pointer-events-auto bg-default"
                    :aria-label="isExpanded ? 'Show sidebar' : 'Open Studio sidebar'"
                    @click="isExpanded ? sidebarOpen = true : sheet = 'sidebar'"
                  />
                </UTooltip>
                <!-- A tool's bar replaces the floor bar while it's open (3A, 9A). -->
                <div
                  v-if="drawing"
                  class="flex flex-wrap items-center gap-2"
                  data-testid="tool-bar"
                >
                  <span class="rounded-lg border border-default bg-default px-3 py-2 text-sm font-semibold text-highlighted shadow-sm">
                    {{ mode === 'outline' ? 'Edit points' : mode === 'room' ? 'Room' : mode === 'shape' ? 'Shape' : 'Draw wall' }}
                    <span class="font-normal text-muted">· {{ floor.name }} floor<template v-if="mode === 'outline' && activeSlab"> · {{ areaM2(activeSlab.outline) }} m²</template></span>
                  </span>
                  <span class="pointer-events-auto flex items-center gap-1 rounded-lg border border-default bg-default p-1 shadow-sm">
                    <UFieldGroup
                      v-if="mode === 'shape'"
                      size="sm"
                      role="group"
                      aria-label="Shape"
                    >
                      <UButton
                        v-for="option in [{ round: false, polygon: false, label: 'Rectangle', icon: 'i-lucide-square' }, { round: true, polygon: false, label: 'Ellipse', icon: 'i-lucide-circle' }, { round: false, polygon: true, label: 'Polygon', icon: 'i-lucide-pentagon' }]"
                        :key="option.label"
                        :icon="option.icon"
                        :label="option.label"
                        :color="roundShape === option.round && polygonShapeOn === option.polygon ? 'primary' : 'neutral'"
                        :variant="roundShape === option.round && polygonShapeOn === option.polygon ? 'soft' : 'ghost'"
                        :aria-pressed="roundShape === option.round && polygonShapeOn === option.polygon"
                        @click="roundShape = option.round; polygonShapeOn = option.polygon"
                      />
                    </UFieldGroup>
                    <UFieldGroup
                      v-if="mode === 'room'"
                      size="sm"
                      role="group"
                      aria-label="Room"
                    >
                      <UButton
                        v-for="option in [{ cut: false, label: 'Add', icon: 'i-lucide-square-plus' }, { cut: true, label: 'Cut', icon: 'i-lucide-square-minus' }]"
                        :key="option.label"
                        :icon="option.icon"
                        :label="option.label"
                        :color="roomCut === option.cut ? 'primary' : 'neutral'"
                        :variant="roomCut === option.cut ? 'soft' : 'ghost'"
                        :aria-pressed="roomCut === option.cut"
                        @click="roomCut = option.cut"
                      />
                    </UFieldGroup>
                    <USwitch
                      v-if="floorIndex > 0"
                      v-model="showBelow"
                      label="Show floor below"
                      size="sm"
                      class="px-1"
                    />
                    <UButton
                      v-if="mode === 'outline' && floorIndex > 0 && !floor.slabs.length && !floor.walls.length"
                      label="Copy walls from floor below"
                      icon="i-lucide-copy"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="copyWallsFromBelow()"
                    />
                    <UButton
                      v-if="floor.slabs.length"
                      label="Cancel"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="cancelTool()"
                    />
                    <UButton
                      label="Done"
                      size="sm"
                      @click="finishTool()"
                    />
                  </span>
                </div>
                <template v-else>
                  <USelect
                    :model-value="floor.id"
                    :items="floorItems"
                    aria-label="Active floor"
                    class="pointer-events-auto"
                    @update:model-value="selectFloor"
                  />
                </template>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <slot name="actions" />
                <UButton
                  v-if="!isExpanded"
                  label="Properties"
                  icon="i-lucide-sliders-horizontal"
                  color="neutral"
                  variant="outline"
                  class="pointer-events-auto bg-default"
                  :ui="{ label: 'max-sm:sr-only' }"
                  @click="detailsOpen = true"
                />
              </div>
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
            v-if="drawing"
            class="pointer-events-none absolute bottom-28 left-2 flex max-w-60 flex-col gap-1 rounded-lg border border-default bg-default px-3 py-2 text-xs text-toned shadow-sm"
          >
            <template v-if="mode === 'outline' && !floor.slabs.length">
              <span>Click on the grid to add corners.</span>
              <span>Click the first corner, double-click or press Enter to close the shape.</span>
            </template>
            <template v-else-if="mode === 'outline'">
              <span>Drag a corner to move it (Shift: in a straight line, Alt: keep right angles), or drag a side to move it.</span>
              <span>Double-click a side or click its round handle to add a corner. Click a corner, then Delete to remove it.</span>
              <span>Walls on a corner move with it. Select a wall to change it or add doors and windows. Escape or Enter when done.</span>
            </template>
            <template v-else-if="mode === 'shape'">
              <span v-if="polygonShapeOn">Click on the grid to add corners; click the first corner, double-click or press Enter to close the polygon. Backspace removes the last corner.</span>
              <span v-else>Drag to draw a {{ roundShape ? 'round block' : 'block' }} for anything the library doesn't have: a stage, a planter box, a platform. A click makes one 100 × 100 cm.</span>
              <span>Name it, set its height and finish in Properties. S draws rectangles, O ellipses; Shift keeps the sides equal, Alt draws from the middle.</span>
            </template>
            <template v-else-if="mode === 'room'">
              <span>Drag a rectangle: the floor, or a room added to it.</span>
              <span>Choose Cut above to cut it out instead. Shift draws a square, Alt from the middle.</span>
            </template>
            <template v-else>
              <span>Click where the wall starts, then where it ends: any angle, Shift for 45° steps.</span>
              <span>Walls carry on from the last end; click the first point to close the loop. Enter or a double-click stops; Escape stops and leaves.</span>
            </template>
          </div>

          <div class="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center sm:bottom-3">
            <StudioToolbar
              v-model:view="view"
              :zoom-level="canvas?.zoomLevel ?? 100"
              fit-label="Fit to screen"
              :can-undo="draft.canUndo.value"
              :can-redo="draft.canRedo.value"
              @zoom="direction => canvas?.zoom(direction)"
              @zoom-to="percent => canvas?.zoomTo(percent)"
              @zoom-to-selection="canvas?.zoomToSelection()"
              @fit="canvas?.fit()"
              @undo="draft.undo()"
              @redo="draft.redo()"
            >
              <UTooltip
                v-for="tool in planTools"
                :key="tool.mode"
                :text="tool.label"
                :kbds="[...tool.kbds]"
              >
                <UButton
                  :icon="tool.icon"
                  :label="isCompact ? undefined : tool.label"
                  :aria-label="tool.label"
                  :aria-keyshortcuts="tool.kbds[0]!.toUpperCase()"
                  :variant="mode === tool.mode ? 'soft' : 'ghost'"
                  :color="mode === tool.mode ? 'primary' : 'neutral'"
                  :aria-pressed="mode === tool.mode"
                  :disabled="tool.mode !== 'select' && tool.mode !== 'hand' && !floor"
                  :ui="{ label: 'max-xl:sr-only' }"
                  @click="tool.mode === mode ? undefined : startTool(tool.mode)"
                />
              </UTooltip>
            </StudioToolbar>
          </div>
          <div
            v-if="pending"
            class="absolute inset-x-2 bottom-28 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-default bg-default p-2 shadow-sm"
          >
            <span
              class="text-sm text-toned"
              role="status"
            >Click or tap the plan to place {{ pendingLabel }}.</span>
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
      </template>
    </USplitter>

    <aside
      aria-label="Properties"
      class="hidden w-60 shrink-0 overflow-y-auto border-l border-default bg-default p-3 lg:block xl:w-72"
    >
      <h2 class="mb-3 border-b border-default pb-3 text-sm font-semibold text-highlighted">
        Properties
      </h2>
      <ReuseDetails />
    </aside>

    <StudioCommands
      v-model:open="commandsOpen"
      :groups="commandGroups"
    />
  </div>
</template>
