<script setup lang="ts">
/**
 * One floor of the shop layout, drawn from above (D273, frames 1–3, 9A, 9C). Three tools (`mode`):
 *
 * - **select:** tap or click selects a table, furniture, an inside wall or an outline edge (pieces
 *   win over the edge behind them; the pointer's target gets a hover outline); a drag past a few
 *   pixels moves the selected piece, snapped to the 25 cm grid (5 cm with Ctrl/⌘, straight across
 *   or down with Shift); the round handle turns it in 15° steps (free with Shift); a corner handle
 *   resizes it in 5 cm steps with the opposite corner staying put (2B).
 * - **outline** (frame 3A): with no outline yet, clicks add corners and clicking the first corner,
 *   a double-click or Enter closes the shape; otherwise corners drag (keeping right angles unless
 *   Alt is held), a round edge handle adds a corner, a clicked corner moves with the arrow keys and
 *   goes with Delete. Furniture fades back.
 * - **wall** (frame 9A): click where an inside wall starts and where it ends; walls chain from the
 *   last end until Escape. Straight across or down unless Alt is held.
 *
 * Navigation follows Figma (D278): dragging empty space, Space+drag or the middle button pans; the
 * wheel pans (Shift: sideways); Ctrl/⌘+wheel or a pinch zooms. Keys come from Studio through
 * `keydown`, so they work without focusing the plan. Nothing changes the layout until a
 * gesture ends: then one event is emitted, one undo step.
 */
import { useElementSize, useEventListener } from '@vueuse/core'
import type { InnerWall, LayoutTable, Point, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { edgeLength, innerWallKind, innerWallLength, isFigureKind, ITEM_SIZE_MAX_CM, ITEM_SIZE_MIN_CM, TABLE_SIZE_MAX_CM, TABLE_SIZE_MIN_CM } from '#shared/contracts/shop-layout'
import { findLook, ITEM_SPECS } from '../designer/catalog'
import { BOOTH_BENCH_DEPTH_CM, boundsOf, chairPoses, FINE_GRID_CM, GRID_CM, normalizeRotation, outwardNormal, pointInPolygon, placementExtent, pointOnEdge, rectCorners, resizeFromCorner, rotatePoint, snap, WALL_THICKNESS_CM } from '../designer/geometry'
import type { Bounds, Sized } from '../designer/geometry'
import { canClose, CLOSE_DISTANCE_CM, closedShape, insertCorner, moveCorner, moveSide, removeCorner } from '../designer/outline'
import { moveWall, moveWallEnd } from '../designer/walls'
import type { FloorShape } from '../designer/outline'
import { itemFootprint, placementWarnings, tableFootprint } from '../designer/placement-warnings'
import type { PlanGhost, PlanMode, PlanSelection } from '../designer/plan'

const props = defineProps<{
  layout: ShopLayout
  floorId: string
  tables: readonly LayoutTable[]
  looks: readonly TableLook[]
  selection: PlanSelection | null
  ghost: PlanGhost | null
  showBelow: boolean
  mode: PlanMode
  placing?: boolean
}>()

const emit = defineEmits<{
  select: [selection: PlanSelection | null]
  place: [position: Point]
  cancelPlace: []
  move: [selection: PlanSelection, position: Point]
  /** Alt+drag (D278): a copy of the piece goes there, the piece stays. */
  copy: [selection: PlanSelection, position: Point]
  rotate: [selection: PlanSelection, rotation: number]
  /** A corner handle was dragged: the new size, and the centre that keeps the opposite corner. */
  resize: [selection: PlanSelection, size: Omit<Sized, 'rotation'>]
  remove: [selection: PlanSelection]
  /** The outline changed (Draw outline): corners and edges together. */
  shape: [shape: FloorShape]
  addWall: [wall: Omit<InnerWall, 'id'>]
  /** An inside wall's end or the whole wall was dragged (D278): the floor's walls after it. */
  walls: [walls: InnerWall[]]
  /** The Room tool's rectangle (D278), and whether Alt cuts it out. */
  room: [bounds: Bounds, cut: boolean]
  /** A double-click on the floor or its edge in Select: open Edit points (D278). */
  editPoints: []
  /** Draw outline: an edge's length label was clicked, to type its length there (3A). */
  editLength: [index: number, at: Point]
}>()

const svg = useTemplateRef<SVGSVGElement>('svg')
const { width: screenWidth, height: screenHeight } = useElementSize(svg)
const floorIndex = computed(() => props.layout.floors.findIndex(floor => floor.id === props.floorId))
const floor = computed(() => props.layout.floors[floorIndex.value] ?? props.layout.floors[0]!)
const below = computed(() => (props.showBelow ? props.layout.floors[floorIndex.value - 1] : undefined))

/** The narrowest and widest view, in centimetres, and the zoom range the menu and keys allow. */
const MIN_VIEW_CM = 200
const MAX_VIEW_CM = 8000
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

// The visible part of the plan, in centimetres.
const view = ref({ x: -100, y: -100, width: 1200, height: 1100 })
/** Screen pixels per centimetre (the viewBox fitted whole: xMidYMid meet). */
const scale = computed(() => Math.min((screenWidth.value || 800) / view.value.width, (screenHeight.value || 600) / view.value.height))
/** The zoom as a percentage, like Figma's: 100 % draws a centimetre as one screen pixel (D278). */
const zoomLevel = computed(() => Math.round(scale.value * 100))
const viewBox = computed(() => `${view.value.x} ${view.value.y} ${view.value.width} ${view.value.height}`)
/** Centimetres per screen pixel: labels and handles keep their size on screen at every zoom. */
const perPixel = computed(() => view.value.width / Math.max(1, screenWidth.value || 800))

function fit() {
  const points = floor.value.outline.length ? floor.value.outline : below.value?.outline ?? []
  if (!points.length) {
    view.value = { x: -100, y: -100, width: 1200, height: 1100 }
    return
  }
  frame(boundsOf(points), 160)
}

/** Shows these bounds whole, with a margin around them, at the plan's own aspect ratio. */
function frame(bounds: { minX: number, minY: number, maxX: number, maxY: number }, margin: number) {
  const width = Math.max(MIN_VIEW_CM, bounds.maxX - bounds.minX + margin * 2)
  const height = Math.max(MIN_VIEW_CM, bounds.maxY - bounds.minY + margin * 2)
  view.value = { x: (bounds.minX + bounds.maxX - width) / 2, y: (bounds.minY + bounds.maxY - height) / 2, width, height }
}

/** Shift+2: the selection fills the plan; nothing selected fits the floor (D278). */
function zoomToSelection() {
  const points = selectionPoints.value
  if (!points) return fit()
  frame(boundsOf(points), 80)
}

/** A zoom percentage (Shift+0 is 100 %), around the middle of the plan. */
function zoomTo(percent: number) {
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100))
  zoomAround(viewMiddle(), scale.value / target)
}

const viewMiddle = () => ({ x: view.value.x + view.value.width / 2, y: view.value.y + view.value.height / 2 })
watch(() => props.floorId, fit, { immediate: true })

/** A gesture's live result, drawn instead of the stored position until the gesture ends. */
const preview = ref<{ selection: PlanSelection, x: number, y: number, rotation: number, width?: number, depth?: number } | null>(null)
/** The Room tool's rectangle while it's dragged, and whether it will cut (Alt) (D278). */
const roomPreview = shallowRef<{ bounds: Bounds, cut: boolean } | null>(null)

/** The inside walls while an end or a whole wall is dragged (D278). */
const liveWalls = shallowRef<InnerWall[] | null>(null)
const walls = computed(() => liveWalls.value ?? floor.value.walls)
/** Each inside wall as drawn: its solid spans, its doors (gaps with a swing) and windows. */
const innerWalls = computed(() => walls.value.map((wall) => {
  const length = innerWallLength(wall)
  const along = (offset: number) => ({ x: wall.from.x + (wall.to.x - wall.from.x) * offset / Math.max(length, 1), y: wall.from.y + (wall.to.y - wall.from.y) * offset / Math.max(length, 1) })
  // A door swings to the wall's right as drawn (start to end), one width long.
  const side = { x: -(wall.to.y - wall.from.y) / Math.max(length, 1), y: (wall.to.x - wall.from.x) / Math.max(length, 1) }
  const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)
  const spans: { from: Point, to: Point }[] = []
  let cursor = 0
  for (const opening of openings) {
    if (opening.kind === 'door' && opening.offset > cursor) spans.push({ from: along(cursor), to: along(opening.offset) })
    if (opening.kind === 'door') cursor = opening.offset + opening.width
  }
  if (cursor < length) spans.push({ from: along(cursor), to: wall.to })
  return {
    ...wall,
    kind: innerWallKind(wall),
    spans,
    windows: openings.filter(opening => opening.kind === 'window').map(opening => ({ id: opening.id, from: along(opening.offset), to: along(opening.offset + opening.width) })),
    doors: openings.filter(opening => opening.kind === 'door').map((opening) => {
      const hinge = along(opening.offset)
      return { id: opening.id, hinge, swing: { x: hinge.x + side.x * opening.width, y: hinge.y + side.y * opening.width } }
    }),
  }
}))

/** The outline while a corner is dragged. */
const liveShape = shallowRef<FloorShape | null>(null)
const shape = computed<FloorShape>(() => liveShape.value ?? { outline: floor.value.outline, edges: floor.value.edges })

// --- Draw outline and Draw wall state ---
// Shallow: these points go into the layout, which holds plain objects only (its undo snapshots
// are structured clones, and a reactive proxy can't be cloned).
/** Corners placed so far while drawing a new outline. */
const drawn = shallowRef<Point[]>([])
/** Where the next corner or wall end would go, under the pointer. */
const hover = shallowRef<Point | null>(null)
/** The corner picked in Draw outline: arrow keys move it, Delete removes it. */
const corner = ref<number | null>(null)
/** Where the inside wall being drawn starts. */
const wallStart = shallowRef<Point | null>(null)
/** What a click would pick, under the pointer in the select tool (D278). */
const hovered = shallowRef<PlanSelection | null>(null)

const drawing = computed(() => props.mode === 'outline' && floor.value.outline.length === 0)
watch(() => [props.mode, props.floorId], () => {
  drawn.value = []
  hover.value = null
  corner.value = null
  wallStart.value = null
})

const edges = computed(() => shape.value.edges.map((edge, index) => {
  const outline = shape.value.outline
  const from = outline[index]!
  const to = outline[(index + 1) % outline.length]!
  const normal = outwardNormal(outline, index)
  const shift = edge.kind === 'wall' ? WALL_THICKNESS_CM / 2 : 0
  const at = (point: Point) => ({ x: point.x + normal.x * shift, y: point.y + normal.y * shift })
  const length = edgeLength(outline, index)
  const middle = pointOnEdge(outline, index, length / 2)
  return {
    index,
    kind: edge.kind,
    from: at(from),
    to: at(to),
    length,
    middle,
    label: { x: middle.x + normal.x * 50, y: middle.y + normal.y * 50 },
    openings: edge.openings.map((opening) => {
      const start = at(pointOnEdge(outline, index, opening.offset))
      const end = at(pointOnEdge(outline, index, opening.offset + opening.width))
      const hinge = pointOnEdge(outline, index, opening.offset)
      // A door swings into the room: the arc's far corner is one width inside the hinge.
      const swing = { x: hinge.x - normal.x * opening.width, y: hinge.y - normal.y * opening.width }
      return { id: opening.id, kind: opening.kind, start, end, hinge, swing, width: opening.width }
    }),
  }
}))

function posed<T extends Sized>(selection: PlanSelection, object: T): T {
  const live = preview.value
  if (!live || live.selection.kind !== selection.kind || live.selection.id !== selection.id) return object
  return { ...object, x: live.x, y: live.y, rotation: live.rotation, width: live.width ?? object.width, depth: live.depth ?? object.depth }
}

const items = computed(() => floor.value.items.map(item => posed({ kind: 'item', id: item.id }, item)))

const posedPlacements = computed(() => props.layout.placements
  .filter(placement => placement.floorId === floor.value.id)
  .map(placement => posed({ kind: 'table', id: placement.tableId }, placement)))

const placed = computed(() => posedPlacements.value
  .map((placement) => {
    const table = props.tables.find(candidate => candidate.id === placement.tableId)
    const look = findLook(props.looks, placement.lookId)
    return {
      ...placement,
      label: table?.label ?? '?',
      look,
      chairs: chairPoses(look, placement.width, placement.depth, table?.seats ?? 0),
      extent: placementExtent(placement, look),
    }
  }))

const footprints = computed(() => [
  ...placed.value.map(table => tableFootprint(table, table.look, table.chairs)),
  ...items.value.map(itemFootprint),
])
const floorShape = computed(() => ({ ...floor.value, ...shape.value }))
const warnings = computed(() => placementWarnings(floorShape.value, footprints.value))

const ghostView = computed(() => {
  const ghost = props.ghost
  if (!ghost) return null
  if (ghost.kind === 'item') return ghost
  const table = ghost.tableId ? props.tables.find(candidate => candidate.id === ghost.tableId) : undefined
  const look = findLook(props.looks, ghost.lookId)
  // A look dragged before its table is chosen shows four chairs.
  const seats = table?.seats ?? 4
  return { kind: 'table' as const, x: ghost.x, y: ghost.y, label: table?.label ?? '?', look, width: look.defaultWidth, depth: look.defaultDepth, chairs: chairPoses(look, look.defaultWidth, look.defaultDepth, seats) }
})

const ghostWarning = computed(() => {
  const ghost = ghostView.value
  if (!ghost) return false
  const piece = { ...ghost, rotation: 0 }
  const footprint = ghost.kind === 'table'
    ? tableFootprint({ ...piece, tableId: '' }, ghost.look, ghost.chairs)
    : itemFootprint({ ...piece, id: '', kind: ghost.itemKind })
  return placementWarnings(floorShape.value, footprints.value, footprint).has('')
})

const belowStairs = computed(() => (below.value?.items ?? []).filter(item => item.kind === 'stairs'))

const isSelected = (kind: PlanSelection['kind'], id: string) => props.selection?.kind === kind && props.selection.id === id
/** Tables and furniture take part in the select tool only; the other tools draw over them. */
const piecesActive = computed(() => props.mode === 'select')

/** A selected table's or piece's outline on the plan, its turn handle included (the selection's drawing). */
const selectionFrames = computed(() => {
  const selection = props.selection
  if (props.mode !== 'select' || !selection) return null
  const table = selection.kind === 'table' ? placed.value.find(candidate => candidate.tableId === selection.id) : undefined
  if (table) return { pose: table, width: table.extent.width + 12, depth: table.extent.depth + 12, handle: 56 }
  const item = selection.kind === 'item' ? items.value.find(candidate => candidate.id === selection.id) : undefined
  return item ? { pose: item, width: item.width + 16, depth: item.depth + 16, handle: 50 } : null
})

/** The hovered piece's outline, or the hovered wall's or edge's line; none for the selection itself. */
const hoverOutline = computed(() => {
  const target = hovered.value
  if (props.mode !== 'select' || !target || isSelected(target.kind, target.id)) return null
  if (target.kind === 'table') {
    const table = placed.value.find(candidate => candidate.tableId === target.id)
    return table ? { kind: 'frame' as const, pose: table, width: table.extent.width + 12, depth: table.extent.depth + 12 } : null
  }
  if (target.kind === 'item') {
    const item = items.value.find(candidate => candidate.id === target.id)
    return item ? { kind: 'frame' as const, pose: item, width: item.width + 16, depth: item.depth + 16 } : null
  }
  if (target.kind === 'wall') {
    const wall = walls.value.find(candidate => candidate.id === target.id)
    return wall ? { kind: 'line' as const, from: wall.from, to: wall.to } : null
  }
  const edge = edges.value[Number(target.id)]
  return edge ? { kind: 'line' as const, from: edge.from, to: edge.to } : null
})

/** The plan points a selection covers: a piece's frame and turn handle, a wall's or an edge's ends. */
const selectionPoints = computed((): Point[] | null => {
  const selection = props.selection
  if (props.mode !== 'select' || !selection) return null
  const frame = selectionFrames.value
  if (frame) {
    const { pose, width, depth, handle } = frame
    const turnHandle = rotatePoint({ x: 0, y: -depth / 2 - handle - 8 }, pose.rotation)
    return [...rectCorners(pose, width, depth, pose.rotation), { x: pose.x + turnHandle.x, y: pose.y + turnHandle.y }]
  }
  const reach = WALL_THICKNESS_CM
  const ends = (from: Point, to: Point) => [from, to].flatMap(point => [{ x: point.x - reach, y: point.y - reach }, { x: point.x + reach, y: point.y + reach }])
  if (selection.kind === 'wall') {
    const wall = walls.value.find(candidate => candidate.id === selection.id)
    return wall ? ends(wall.from, wall.to) : null
  }
  const edge = selection.kind === 'edge' ? edges.value[Number(selection.id)] : undefined
  return edge ? ends(edge.from, edge.to) : null
})

/**
 * Where the selection is on screen, in pixels from the plan's top-left corner, or null while it's
 * moved, turned or resized: the editor puts its quick actions next to it (frame 2B).
 */
const selectionBox = computed(() => {
  const points = selectionPoints.value
  if (!points || preview.value || !screenWidth.value || !screenHeight.value) return null
  const bounds = boundsOf(points)
  const topLeft = toScreen({ x: bounds.minX, y: bounds.minY })
  const bottomRight = toScreen({ x: bounds.maxX, y: bounds.maxY })
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
})

/** Plan centimetres → pixels from the plan's top-left corner (the viewBox fitted whole: xMidYMid meet). */
function toScreen(point: Point): Point {
  const { x, y, width, height } = view.value
  const scale = Math.min(screenWidth.value / width, screenHeight.value / height)
  return {
    x: (screenWidth.value - width * scale) / 2 + (point.x - x) * scale,
    y: (screenHeight.value - height * scale) / 2 + (point.y - y) * scale,
  }
}

/**
 * The four corner handles of a selection frame, in its own (unturned) directions. None while the
 * frame is small on screen: the handles would cover the piece, and a drag would resize it instead
 * of moving it.
 */
const handleCorners = (width: number, depth: number) => (Math.min(width, depth) / perPixel.value >= 56 ? rectCorners({ x: 0, y: 0 }, width, depth, 0) : [])

/** Screen → plan centimetres; null when the pointer is outside the plan. */
function toPlan(clientX: number, clientY: number, inside = false): Point | null {
  const element = svg.value
  const matrix = element?.getScreenCTM()
  if (!element || !matrix) return null
  if (inside) {
    const rect = element.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
  }
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

/** The middle of what's on screen, on the grid: where Place on map puts a piece. */
function viewCenter(): Point {
  return { x: snap(view.value.x + view.value.width / 2), y: snap(view.value.y + view.value.height / 2) }
}

/** Ctrl or ⌘ held: 5 cm steps instead of the 25 cm grid while dragging or drawing (D278). */
const fineSnap = (event: { ctrlKey: boolean, metaKey: boolean }) => event.ctrlKey || event.metaKey

/** Snapped to the grid; with `from`, straight across or down from it unless `free`. */
function drawPoint(plan: Point, from: Point | undefined, free: boolean, fine: boolean): Point {
  const step = fine ? FINE_GRID_CM : GRID_CM
  const point = { x: snap(plan.x, step), y: snap(plan.y, step) }
  if (!from || free) return point
  return Math.abs(point.x - from.x) >= Math.abs(point.y - from.y) ? { x: point.x, y: from.y } : { x: from.x, y: point.y }
}

type Gesture
  = | { type: 'drag', selection: PlanSelection, startPlan: Point, origin: { x: number, y: number, rotation: number }, startClient: Point, moved: boolean }
    | { type: 'rotate', selection: PlanSelection, center: Point, rotation: number }
    | { type: 'resize', selection: PlanSelection, corner: number, startPlan: Point, origin: Sized, round: boolean, min: number, max: number }
    | { type: 'corner', index: number, startPlan: Point, origin: Point, startClient: Point, moved: boolean }
    | { type: 'wall-end', id: string, end: 'from' | 'to', startClient: Point, moved: boolean }
    | { type: 'wall', id: string, startPlan: Point, startClient: Point, moved: boolean }
    | { type: 'room', start: Point }
    | { type: 'side', index: number, startPlan: Point, startClient: Point, moved: boolean }
    | { type: 'pan', startClient: Point, startView: typeof view.value, moved: boolean, plan: Point | null, event: { altKey: boolean, fine: boolean }, navigateOnly?: boolean }
    | { type: 'pinch', distance: number, startView: typeof view.value, middle: Point }

const pointers = new Map<number, Point>()
let gesture: Gesture | null = null
const DRAG_SLOP_PX = 5

function stored(selection: PlanSelection): Sized | undefined {
  if (selection.kind === 'table') return props.layout.placements.find(placement => placement.tableId === selection.id)
  if (selection.kind === 'item') return floor.value.items.find(item => item.id === selection.id)
  return undefined
}

/** What a corner handle may do to a piece: the contract's size limits, and whether it stays round. */
function sizeRules(selection: PlanSelection): { round: boolean, min: number, max: number } {
  if (selection.kind === 'table') {
    const placement = props.layout.placements.find(candidate => candidate.tableId === selection.id)
    return { round: !!placement && findLook(props.looks, placement.lookId).shape === 'round', min: TABLE_SIZE_MIN_CM, max: TABLE_SIZE_MAX_CM }
  }
  const item = floor.value.items.find(candidate => candidate.id === selection.id)
  return { round: !!item && ITEM_SPECS[item.kind].footprint === 'round', min: ITEM_SIZE_MIN_CM, max: ITEM_SIZE_MAX_CM }
}

// --- Space or the middle button pans from any tool (D278) ---

/** Space is held with the pointer over the plan: a drag pans, whatever is under it. */
const spaceHeld = ref(false)
/** A pan is under way: the grabbing cursor. */
const panning = ref(false)
let pointerInside = false

const typing = () => {
  const active = document.activeElement as HTMLElement | null
  return !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
}
useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code !== 'Space' || !pointerInside || typing()) return
  // Not a click on a focused toolbar button, and not the page scrolling.
  event.preventDefault()
  spaceHeld.value = true
})
useEventListener('keyup', (event: KeyboardEvent) => {
  if (event.code === 'Space') spaceHeld.value = false
})
/**
 * A right-click picks what's under the pointer (or clears the selection on empty plan), so Studio's
 * menu acts on it (D278). Only in the select tool; the other tools keep the browser's menu off.
 */
function onContextMenu(event: MouseEvent) {
  if (props.mode !== 'select' || props.placing) {
    event.preventDefault()
    return
  }
  const target = (event.target as Element).closest<SVGElement>('[data-kind]')
  const kind = target?.dataset.kind
  if (target && (kind === 'table' || kind === 'item' || kind === 'wall' || kind === 'edge')) {
    const id = target.dataset.id!
    if (!isSelected(kind, id)) emit('select', { kind, id })
  }
  else emit('select', null)
}

function onPointerEnter() {
  pointerInside = true
}
function onPointerLeave() {
  pointerInside = false
  hover.value = null
  hovered.value = null
}
useEventListener('blur', () => {
  spaceHeld.value = false
})

function onPointerDown(event: PointerEvent) {
  const middle = event.pointerType === 'mouse' && event.button === 1
  if (event.pointerType === 'mouse' && event.button !== 0 && !middle) return
  if (middle || (spaceHeld.value && pointers.size === 0)) {
    // No autoscroll from the middle button; a pan that never picks or places anything.
    event.preventDefault()
    svg.value?.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    hovered.value = null
    panning.value = true
    gesture = { type: 'pan', startClient: { x: event.clientX, y: event.clientY }, startView: { ...view.value }, moved: false, plan: null, event: { altKey: false, fine: false }, navigateOnly: true }
    return
  }
  svg.value?.setPointerCapture(event.pointerId)
  hovered.value = null
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Point, Point]
    preview.value = null
    liveShape.value = null
    liveWalls.value = null
    roomPreview.value = null
    gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), startView: { ...view.value }, middle: toPlan((a.x + b.x) / 2, (a.y + b.y) / 2) ?? { x: 0, y: 0 } }
    return
  }
  const target = (event.target as Element).closest<SVGElement>('[data-kind]')
  const plan = toPlan(event.clientX, event.clientY)
  const startPan = () => {
    gesture = { type: 'pan', startClient: { x: event.clientX, y: event.clientY }, startView: { ...view.value }, moved: false, plan, event: { altKey: event.altKey, fine: fineSnap(event) } }
  }
  if (props.mode === 'room' && plan && !props.placing) {
    const step = fineSnap(event) ? FINE_GRID_CM : GRID_CM
    gesture = { type: 'room', start: { x: snap(plan.x, step), y: snap(plan.y, step) } }
    return
  }
  if (props.placing || props.mode === 'hand' || props.mode === 'wall' || !target || !plan) return startPan()
  const kind = target.dataset.kind!
  const id = target.dataset.id!
  if (kind === 'corner') {
    const index = Number(id)
    corner.value = index
    gesture = { type: 'corner', index, startPlan: plan, origin: { ...shape.value.outline[index]! }, startClient: { x: event.clientX, y: event.clientY }, moved: false }
    return
  }
  if (kind === 'midpoint') {
    const index = Number(id)
    emit('shape', insertCorner(shape.value, index))
    corner.value = index + 1
    return
  }
  if (kind === 'first-corner') {
    closeDrawing()
    return
  }
  if (kind === 'edge-length') {
    // No mousedown follows, so the plan doesn't take the focus from the length's input.
    event.preventDefault()
    const edge = edges.value[Number(id)]
    if (edge) emit('editLength', edge.index, toScreen(edge.label))
    return
  }
  if (kind === 'wall-end') {
    const end = target.dataset.end === 'from' ? 'from' : 'to'
    gesture = { type: 'wall-end', id, end, startClient: { x: event.clientX, y: event.clientY }, moved: false }
    return
  }
  if (kind === 'wall') {
    // Pressed and dragged, a wall moves at once (Figma); its joined neighbours stretch to follow.
    if (!isSelected('wall', id)) emit('select', { kind, id })
    gesture = { type: 'wall', id, startPlan: plan, startClient: { x: event.clientX, y: event.clientY }, moved: false }
    return
  }
  if (kind === 'edge' && props.mode === 'outline') {
    // Edit points (D278): a side drags sideways, both its corners together; a tap selects it.
    gesture = { type: 'side', index: Number(id), startPlan: plan, startClient: { x: event.clientX, y: event.clientY }, moved: false }
    return
  }
  if (kind === 'edge') {
    emit('select', { kind, id })
    return
  }
  const selection: PlanSelection = { kind: kind as PlanSelection['kind'], id }
  const origin = stored(selection)
  if (!origin) return
  if (target.dataset.handle === 'rotate') {
    gesture = { type: 'rotate', selection, center: { x: origin.x, y: origin.y }, rotation: origin.rotation }
    return
  }
  if (target.dataset.handle === 'resize') {
    gesture = { type: 'resize', selection, corner: Number(target.dataset.corner), startPlan: plan, origin: { ...origin }, ...sizeRules(selection) }
    return
  }
  if (!isSelected(selection.kind, selection.id)) emit('select', selection)
  gesture = { type: 'drag', selection, startPlan: plan, origin: { ...origin }, startClient: { x: event.clientX, y: event.clientY }, moved: false }
}

function onPointerMove(event: PointerEvent) {
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (!gesture) {
    hovered.value = hoverTarget(event)
    // Hovering while drawing: where the next corner or wall end would go.
    if (drawing.value || props.mode === 'wall') {
      const plan = toPlan(event.clientX, event.clientY)
      const from = drawing.value ? drawn.value.at(-1) : wallStart.value ?? undefined
      hover.value = plan ? drawPoint(plan, from, event.altKey, fineSnap(event)) : null
    }
    return
  }
  if (gesture.type === 'pinch') {
    const [a, b] = [...pointers.values()] as [Point, Point]
    if (!a || !b) return
    const scale = gesture.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    zoomAround(gesture.middle, scale, gesture.startView)
    return
  }
  if (gesture.type === 'pan') {
    const element = svg.value
    if (!element) return
    const dx = event.clientX - gesture.startClient.x
    const dy = event.clientY - gesture.startClient.y
    if (Math.hypot(dx, dy) > DRAG_SLOP_PX) gesture.moved = true
    if (!gesture.moved) return
    panning.value = true
    const scale = gesture.startView.width / Math.max(1, element.getBoundingClientRect().width)
    view.value = { ...gesture.startView, x: gesture.startView.x - dx * scale, y: gesture.startView.y - dy * scale }
    return
  }
  const plan = toPlan(event.clientX, event.clientY)
  if (!plan) return
  if (gesture.type === 'room') {
    const step = fineSnap(event) ? FINE_GRID_CM : GRID_CM
    const end = { x: snap(plan.x, step), y: snap(plan.y, step) }
    const { start } = gesture
    roomPreview.value = { bounds: { minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y), maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y) }, cut: event.altKey }
    return
  }
  if (gesture.type === 'rotate') {
    const angle = (Math.atan2(plan.y - gesture.center.y, plan.x - gesture.center.x) * 180) / Math.PI + 90
    const rotation = normalizeRotation(event.shiftKey ? angle : Math.round(angle / 15) * 15)
    gesture.rotation = rotation
    preview.value = { selection: gesture.selection, x: gesture.center.x, y: gesture.center.y, rotation }
    return
  }
  if (gesture.type === 'resize') {
    const delta = { x: plan.x - gesture.startPlan.x, y: plan.y - gesture.startPlan.y }
    preview.value = { selection: gesture.selection, ...resizeFromCorner(gesture.origin, { corner: gesture.corner, delta, round: gesture.round, min: gesture.min, max: gesture.max }) }
    return
  }
  if (!gesture.moved && Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) < DRAG_SLOP_PX) return
  gesture.moved = true
  if (gesture.type === 'side') {
    const step = fineSnap(event) ? FINE_GRID_CM : GRID_CM
    const base = { outline: floor.value.outline, edges: floor.value.edges }
    const normal = outwardNormal(base.outline, gesture.index)
    const distance = snap((plan.x - gesture.startPlan.x) * normal.x + (plan.y - gesture.startPlan.y) * normal.y, step)
    liveShape.value = moveSide(base, gesture.index, distance)
    return
  }
  if (gesture.type === 'wall-end') {
    const { id, end } = gesture
    const wall = floor.value.walls.find(candidate => candidate.id === id)
    if (!wall) return
    const other = end === 'from' ? wall.to : wall.from
    liveWalls.value = moveWallEnd(floor.value.walls, id, end, drawPoint(plan, other, event.altKey, fineSnap(event)))
    return
  }
  if (gesture.type === 'wall') {
    const step = fineSnap(event) ? FINE_GRID_CM : GRID_CM
    const delta = { x: snap(plan.x - gesture.startPlan.x, step), y: snap(plan.y - gesture.startPlan.y, step) }
    if (event.shiftKey) {
      if (Math.abs(delta.x) >= Math.abs(delta.y)) delta.y = 0
      else delta.x = 0
    }
    liveWalls.value = moveWall(floor.value.walls, gesture.id, delta)
    return
  }
  const step = fineSnap(event) ? FINE_GRID_CM : GRID_CM
  const to = { x: snap(gesture.origin.x + plan.x - gesture.startPlan.x, step), y: snap(gesture.origin.y + plan.y - gesture.startPlan.y, step) }
  // Shift keeps a piece's move straight across or down, like Figma (D278).
  if (gesture.type === 'drag' && event.shiftKey) {
    if (Math.abs(plan.x - gesture.startPlan.x) >= Math.abs(plan.y - gesture.startPlan.y)) to.y = gesture.origin.y
    else to.x = gesture.origin.x
  }
  if (gesture.type === 'corner') {
    liveShape.value = moveCorner({ outline: floor.value.outline, edges: floor.value.edges }, gesture.index, to, !event.altKey)
    return
  }
  preview.value = { selection: gesture.selection, ...to, rotation: gesture.origin.rotation }
}

/** The table, piece, inside wall or edge under the pointer, in the select tool. */
function hoverTarget(event: PointerEvent): PlanSelection | null {
  if (props.mode !== 'select' || props.placing || event.pointerType === 'touch') return null
  const target = (event.target as Element).closest<SVGElement>('[data-kind]')
  const kind = target?.dataset.kind
  if (!target || (kind !== 'table' && kind !== 'item' && kind !== 'wall' && kind !== 'edge')) return null
  const id = target.dataset.id!
  return hovered.value?.kind === kind && hovered.value.id === id ? hovered.value : { kind, id }
}

function onPointerUp(event: PointerEvent, cancelled = false) {
  pointers.delete(event.pointerId)
  panning.value = false
  const finished = gesture
  if (finished?.type === 'pinch') {
    if (pointers.size === 0) gesture = null
    return
  }
  gesture = null
  const live = preview.value
  const liveOutline = liveShape.value
  const movedWalls = liveWalls.value
  const room = roomPreview.value
  roomPreview.value = null
  preview.value = null
  liveShape.value = null
  liveWalls.value = null
  if (!finished || cancelled) return
  if (finished.type === 'pan' && !finished.moved && !finished.navigateOnly) return tap(finished.plan, finished.event)
  if (finished.type === 'drag' && finished.moved && live) {
    if (event.altKey) emit('copy', finished.selection, { x: live.x, y: live.y })
    else emit('move', finished.selection, { x: live.x, y: live.y })
  }
  if (finished.type === 'rotate' && live) emit('rotate', finished.selection, live.rotation)
  if (finished.type === 'resize' && live?.width !== undefined && live.depth !== undefined && (live.width !== finished.origin.width || live.depth !== finished.origin.depth)) {
    emit('resize', finished.selection, { x: live.x, y: live.y, width: live.width, depth: live.depth })
  }
  if (finished.type === 'corner' && finished.moved && liveOutline) emit('shape', liveOutline)
  if (finished.type === 'side') {
    if (finished.moved && liveOutline) emit('shape', liveOutline)
    else if (!finished.moved) emit('select', { kind: 'edge', id: String(finished.index) })
  }
  if ((finished.type === 'wall' || finished.type === 'wall-end') && finished.moved && movedWalls) emit('walls', movedWalls)
  if (finished.type === 'room' && room) emit('room', room.bounds, event.altKey)
}

/** A tap on empty plan: clears the selection, or adds a corner or a wall end while drawing. */
function tap(plan: Point | null, keys: { altKey: boolean, fine: boolean }) {
  if (props.mode === 'hand') return
  if (props.placing) {
    if (plan) emit('place', plan)
    return
  }
  if (drawing.value && plan) {
    const first = drawn.value[0]
    const point = drawPoint(plan, drawn.value.at(-1), keys.altKey, keys.fine)
    if (first && drawn.value.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= Math.max(CLOSE_DISTANCE_CM, perPixel.value * 12)) return closeDrawing()
    const last = drawn.value.at(-1)
    if (!last || last.x !== point.x || last.y !== point.y) drawn.value = [...drawn.value, point]
    return
  }
  if (props.mode === 'wall' && plan) {
    const point = drawPoint(plan, wallStart.value ?? undefined, keys.altKey, keys.fine)
    const start = wallStart.value
    if (!start) {
      wallStart.value = point
      return
    }
    // The same point twice ends the chain.
    if (start.x === point.x && start.y === point.y) {
      wallStart.value = null
      return
    }
    emit('addWall', { from: start, to: point })
    wallStart.value = point
    return
  }
  if (props.mode === 'outline') {
    corner.value = null
    return
  }
  emit('select', null)
}

function closeDrawing() {
  if (!canClose(drawn.value)) return
  emit('shape', closedShape(drawn.value))
  drawn.value = []
  hover.value = null
}

/**
 * Closes a drawn outline or stops a wall chain. In Edit points a double-click on a side adds a
 * corner there; in Select a double-click on the floor or its edge opens Edit points (Figma's
 * double-click into a shape's points, D278).
 */
function onDoubleClick(event: MouseEvent) {
  if (drawing.value) return closeDrawing()
  if (props.mode === 'wall') {
    wallStart.value = null
    return
  }
  const target = (event.target as Element).closest<SVGElement>('[data-kind]')
  const plan = toPlan(event.clientX, event.clientY)
  if (props.mode === 'outline' && target?.dataset.kind === 'edge' && plan) {
    emit('shape', insertCorner(shape.value, Number(target.dataset.id), plan))
    return
  }
  const onFloor = !target && plan && shape.value.outline.length >= 3 && pointInPolygon(plan, shape.value.outline)
  if (props.mode === 'select' && !props.placing && (target?.dataset.kind === 'edge' || onFloor)) emit('editPoints')
}

function zoomAround(point: Point, scale: number, from = view.value) {
  const width = Math.min(MAX_VIEW_CM, Math.max(MIN_VIEW_CM, from.width * scale))
  const factor = width / from.width
  view.value = {
    x: point.x - (point.x - from.x) * factor,
    y: point.y - (point.y - from.y) * factor,
    width,
    height: from.height * factor,
  }
}

/**
 * Like Figma (D278): the wheel or a two-finger scroll pans (Shift: sideways); Ctrl/⌘+wheel and a
 * trackpad pinch (which the browser sends as a wheel with Ctrl) zoom at the pointer.
 */
function onWheel(event: WheelEvent) {
  // Lines (Firefox's mouse wheel) and pages to pixels.
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (screenHeight.value || 600) : 1
  if (event.ctrlKey || event.metaKey) {
    const point = toPlan(event.clientX, event.clientY)
    if (point) zoomAround(point, 1.01 ** (event.deltaY * unit))
    return
  }
  const perScreenPixel = 1 / scale.value
  const dx = (event.shiftKey ? event.deltaY : event.deltaX) * unit * perScreenPixel
  const dy = (event.shiftKey ? 0 : event.deltaY) * unit * perScreenPixel
  view.value = { ...view.value, x: view.value.x + dx, y: view.value.y + dy }
}

function zoom(direction: 1 | -1) {
  zoomAround(viewMiddle(), direction > 0 ? 0.8 : 1.25)
}
defineExpose({ toPlan, viewCenter, fit, zoom, zoomTo, zoomToSelection, zoomLevel, selectionBox, warnings, keydown, focus: () => svg.value?.focus() })

const ARROWS: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }

/**
 * The plan's own keys, called by Studio for every key pressed outside a field (D278), so they work
 * without focusing the plan first. Returns whether the key was used; Studio handles the rest (Esc
 * leaving a tool, the tool keys).
 * - Arrows move the selection or the picked corner 5 cm, 25 cm with Shift (Figma's small and big
 *   nudge); Shift+R turns the selection 90°; Delete or Backspace removes it.
 * - Escape cancels in steps: a placement, the last corner drawn, the wall being drawn, the picked
 *   corner, then the selection.
 */
function keydown(event: KeyboardEvent): boolean {
  const done = () => {
    event.preventDefault()
    return true
  }
  if (props.placing) {
    if (event.key !== 'Escape') return false
    emit('cancelPlace')
    return done()
  }
  if (props.mode === 'hand') return false
  const step = event.shiftKey ? GRID_CM : FINE_GRID_CM
  const arrow = ARROWS[event.key]
  if (drawing.value) {
    if (event.key === 'Enter') {
      closeDrawing()
      return done()
    }
    if ((event.key === 'Escape' || event.key === 'Backspace') && drawn.value.length) {
      drawn.value = drawn.value.slice(0, -1)
      return done()
    }
    return false
  }
  if (props.mode === 'outline') {
    const index = corner.value
    if (index === null) return false
    if (event.key === 'Escape') {
      corner.value = null
      return done()
    }
    const at = shape.value.outline[index]
    if (arrow && at) {
      emit('shape', moveCorner(shape.value, index, { x: at.x + arrow.x * step, y: at.y + arrow.y * step }, !event.altKey))
      return done()
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && shape.value.outline.length > 3) {
      emit('shape', removeCorner(shape.value, index))
      corner.value = null
      return done()
    }
    return false
  }
  if (props.mode === 'wall') {
    if (event.key !== 'Escape' || !wallStart.value) return false
    wallStart.value = null
    return done()
  }
  const selection = props.selection
  if (!selection) return false
  if (event.key === 'Escape') {
    emit('select', null)
    return done()
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    emit('remove', selection)
    return done()
  }
  const current = stored(selection)
  if (!current) return false
  if (arrow) {
    emit('move', selection, { x: current.x + arrow.x * step, y: current.y + arrow.y * step })
    return done()
  }
  if (event.key === 'R' && event.shiftKey) {
    emit('rotate', selection, normalizeRotation(current.rotation + 90))
    return done()
  }
  return false
}

const cornerChip = computed(() => {
  const index = corner.value
  const at = index === null ? undefined : shape.value.outline[index]
  return at ? `Corner x ${(at.x / 100).toFixed(2)} m · y ${(at.y / 100).toFixed(2)} m` : ''
})
const drawingPreview = computed(() => (hover.value ? [...drawn.value, hover.value] : drawn.value))
const wallPreview = computed(() => (wallStart.value && hover.value ? { from: wallStart.value, to: hover.value, length: Math.round(Math.hypot(hover.value.x - wallStart.value.x, hover.value.y - wallStart.value.y)) } : null))

const ariaLabel = computed(() => {
  if (drawing.value) return `Draw outline, ${floor.value.name} floor. Click on the grid to add corners; Enter closes the shape, Backspace removes the last corner.`
  if (props.mode === 'outline') return `Edit points, ${floor.value.name} floor. Drag a corner or a side to move it; double-click a side to add a corner; with a corner picked, arrow keys move it and Delete removes it.`
  if (props.mode === 'room') return `Room, ${floor.value.name} floor. Drag a rectangle to add a room to the floor; hold Alt to cut it out.`
  if (props.mode === 'wall') return `Draw wall, ${floor.value.name} floor. Click where the wall starts and where it ends; Escape stops.`
  return `Floor plan, ${floor.value.name}. Arrow keys move the selected piece 5 cm (Shift: 25 cm), Shift+R turns it, Delete removes it, Escape clears the selection. Question mark lists every shortcut.`
})

const transform = (object: { x: number, y: number, rotation: number }) => `translate(${object.x} ${object.y}) rotate(${object.rotation})`
const points = (list: readonly Point[]) => list.map(point => `${point.x},${point.y}`).join(' ')
const stairLines = (depth: number) => Array.from({ length: Math.max(2, Math.floor(depth / 28)) }, (_, index) => -depth / 2 + (index + 1) * 28).filter(y => y < depth / 2)
const slatLines = (width: number) => Array.from({ length: Math.max(1, Math.floor(width / 12) - 1) }, (_, index) => -width / 2 + (index + 1) * 12)
const warningCorners = (object: { x: number, y: number, rotation: number }, width: number, depth: number) => points(rectCorners(object, width + 24, depth + 24, object.rotation))
function chairRect(chair: TableLook['chair']) {
  const size = chair === 'none' ? ITEM_SPECS['cafe-chair'] : ITEM_SPECS[chair]
  return { x: -size.width / 2, y: -size.depth / 2, width: size.width, height: size.depth }
}
const metres = (cm: number) => `${Math.round(cm)} cm`
/** A label's box around its text, in plan centimetres at the current zoom. */
const chipSize = (text: string) => ({ width: (text.length * 7 + 16) * perPixel.value, height: 22 * perPixel.value, font: 12 * perPixel.value })
</script>

<template>
  <svg
    ref="svg"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    class="size-full touch-none select-none outline-none data-panning:**:cursor-[inherit] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
    :class="panning ? 'cursor-grabbing' : spaceHeld || mode === 'hand' ? 'cursor-grab' : mode !== 'select' && 'cursor-crosshair'"
    :data-panning="spaceHeld || panning ? 'yes' : undefined"
    role="application"
    tabindex="0"
    :aria-label="ariaLabel"
    data-testid="floor-plan"
    :data-mode="mode"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp($event, true)"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
    @wheel.prevent="onWheel"
  >
    <defs>
      <pattern
        id="plan-grid-minor"
        :width="GRID_CM"
        :height="GRID_CM"
        patternUnits="userSpaceOnUse"
      >
        <path
          :d="`M${GRID_CM} 0H0V${GRID_CM}`"
          fill="none"
          stroke="var(--ui-border)"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </pattern>
      <pattern
        id="plan-grid"
        width="100"
        height="100"
        patternUnits="userSpaceOnUse"
      >
        <rect
          width="100"
          height="100"
          fill="url(#plan-grid-minor)"
        />
        <path
          d="M100 0H0V100"
          fill="none"
          stroke="var(--ui-border-accented)"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </pattern>
    </defs>
    <rect
      :x="view.x - view.width"
      :y="view.y - view.height"
      :width="view.width * 3"
      :height="view.height * 3"
      fill="url(#plan-grid)"
      style="background: var(--ui-bg-muted)"
    />

    <!-- The floor below, faint: stairs and walls line up with it (9A). -->
    <g
      v-if="below"
      opacity="0.7"
      fill="none"
      stroke="var(--ui-text-dimmed)"
      stroke-dasharray="14 10"
      stroke-width="4"
      pointer-events="none"
      data-testid="plan-below"
    >
      <polygon :points="points(below.outline)" />
      <rect
        v-for="stairs in belowStairs"
        :key="stairs.id"
        :x="-stairs.width / 2"
        :y="-stairs.depth / 2"
        :width="stairs.width"
        :height="stairs.depth"
        :transform="transform(stairs)"
        stroke-dasharray="8 8"
      />
    </g>

    <polygon
      v-if="shape.outline.length >= 3"
      :points="points(shape.outline)"
      :fill="mode === 'outline' ? 'color-mix(in oklab, var(--ui-primary) 10%, var(--ui-bg))' : 'var(--ui-bg)'"
    />

    <!-- Edges to click (3B): wide and invisible, under furniture, inside walls and tables, so a
         piece against a wall is picked, not the wall (D278). -->
    <template v-if="mode !== 'wall'">
      <line
        v-for="edge in edges"
        :key="edge.index"
        :x1="edge.from.x"
        :y1="edge.from.y"
        :x2="edge.to.x"
        :y2="edge.to.y"
        stroke="transparent"
        :stroke-width="Math.max(40, perPixel * 16)"
        data-kind="edge"
        :data-id="edge.index"
        :data-testid="`plan-edge-${edge.index}`"
        class="cursor-pointer"
      />
    </template>

    <!-- Furniture, tables and inside walls fade back while the outline is edited (3A). -->
    <g
      :opacity="mode === 'outline' ? 0.35 : 1"
      :pointer-events="piecesActive ? undefined : 'none'"
    >
      <!-- Inside walls (D278): a wall, railing, half wall or glass, with doors (gaps) and windows. -->
      <g
        v-for="wall in innerWalls"
        :key="wall.id"
        data-kind="wall"
        :data-id="wall.id"
        :data-testid="`plan-wall-${wall.id}`"
        :data-wall-kind="wall.kind"
        class="cursor-move"
      >
        <line
          v-if="isSelected('wall', wall.id)"
          :x1="wall.from.x"
          :y1="wall.from.y"
          :x2="wall.to.x"
          :y2="wall.to.y"
          stroke="color-mix(in oklab, var(--ui-primary) 35%, transparent)"
          stroke-width="30"
          stroke-linecap="round"
        />
        <line
          v-for="(span, index) in wall.spans"
          :key="index"
          :x1="span.from.x"
          :y1="span.from.y"
          :x2="span.to.x"
          :y2="span.to.y"
          :stroke="wall.kind === 'glass' ? 'var(--ui-info)' : wall.kind === 'wall' ? 'var(--ui-text-toned)' : 'var(--ui-text-muted)'"
          :stroke-width="wall.kind === 'glass' ? 5 : wall.kind === 'railing' ? 6 : wall.kind === 'half' ? 9 : 12"
          :stroke-dasharray="wall.kind === 'railing' ? '14 8' : wall.kind === 'half' ? '24 6' : undefined"
          stroke-linecap="square"
        />
        <line
          v-for="pane in wall.windows"
          :key="pane.id"
          :x1="pane.from.x"
          :y1="pane.from.y"
          :x2="pane.to.x"
          :y2="pane.to.y"
          stroke="var(--ui-info)"
          stroke-width="5"
        />
        <path
          v-for="door in wall.doors"
          :key="door.id"
          :d="`M${door.hinge.x} ${door.hinge.y} L${door.swing.x} ${door.swing.y}`"
          stroke="var(--ui-text-muted)"
          stroke-width="3"
          stroke-dasharray="6 6"
        />
        <line
          :x1="wall.from.x"
          :y1="wall.from.y"
          :x2="wall.to.x"
          :y2="wall.to.y"
          stroke="transparent"
          :stroke-width="Math.max(36, perPixel * 14)"
        />
      </g>
      <!-- A selected inside wall's ends: drag one to stretch or turn the wall (D278). -->
      <template
        v-for="wall in innerWalls"
        :key="`ends-${wall.id}`"
      >
        <template v-if="mode === 'select' && isSelected('wall', wall.id)">
          <circle
            v-for="end in (['from', 'to'] as const)"
            :key="end"
            :cx="wall[end].x"
            :cy="wall[end].y"
            :r="9 * perPixel"
            fill="var(--ui-bg)"
            stroke="var(--ui-primary)"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
            data-kind="wall-end"
            :data-id="wall.id"
            :data-end="end"
            :data-testid="`wall-end-${end}`"
            class="cursor-crosshair"
          />
        </template>
      </template>

      <!-- Furniture and fixtures (grey: no QR). -->
      <g
        v-for="item in items"
        :key="item.id"
        :transform="transform(item)"
        data-kind="item"
        :data-id="item.id"
        :data-testid="`plan-item-${item.kind}`"
        class="cursor-grab"
      >
        <template v-if="item.kind === 'plant'">
          <circle
            :r="item.width / 2"
            fill="color-mix(in oklab, var(--ui-success) 22%, var(--ui-bg))"
            stroke="var(--ui-success)"
            stroke-width="3"
          />
          <circle
            :r="item.width / 5"
            fill="var(--ui-success)"
            opacity="0.6"
          />
        </template>
        <!-- People and pets (step 3g): seen from above, the front (head) towards +y. -->
        <g
          v-else-if="isFigureKind(item.kind)"
          fill="color-mix(in oklab, var(--ui-secondary) 22%, var(--ui-bg))"
          stroke="var(--ui-secondary)"
          stroke-width="3"
        >
          <template v-if="ITEM_SPECS[item.kind].figure === 'hammock'">
            <rect
              :x="-item.width / 2 + 6"
              :y="-item.depth / 2 + 6"
              :width="item.width - 12"
              :height="item.depth - 12"
              rx="6"
              fill="none"
            />
            <ellipse
              :rx="item.width / 2 - 24"
              :ry="item.depth / 2 - 14"
            />
            <circle
              :cx="-item.width / 2 + 60"
              r="11"
              fill="var(--ui-secondary)"
              stroke="none"
              opacity="0.7"
            />
          </template>
          <template v-else-if="ITEM_SPECS[item.kind].figure === 'animal'">
            <ellipse
              :rx="item.width / 2 - 3"
              :ry="item.depth / 2 - 10"
              cy="-6"
            />
            <circle
              :cy="item.depth / 2 - 10"
              :r="item.width / 3"
              fill="var(--ui-secondary)"
              stroke="none"
              opacity="0.7"
            />
          </template>
          <template v-else>
            <ellipse
              :rx="item.width / 2 - 4"
              :ry="Math.min(item.depth, 35) / 2 - 4"
            />
            <circle
              r="10"
              fill="var(--ui-secondary)"
              stroke="none"
              opacity="0.7"
            />
          </template>
        </g>
        <!-- Overhead (step 3f: a pendant lamp, a parasol): a dashed outline over what stands below,
             grabbed by its middle. -->
        <g v-else-if="ITEM_SPECS[item.kind].overhead">
          <circle
            :r="item.width / 2"
            fill="none"
            stroke="var(--ui-border-accented)"
            stroke-width="3"
            stroke-dasharray="12 8"
          />
          <circle
            :r="Math.min(14, item.width / 4)"
            fill="var(--ui-bg-elevated)"
            stroke="var(--ui-border-accented)"
            stroke-width="3"
          />
        </g>
        <circle
          v-else-if="ITEM_SPECS[item.kind].footprint === 'round'"
          :r="item.width / 2"
          fill="var(--ui-bg-elevated)"
          stroke="var(--ui-border-accented)"
          stroke-width="3"
        />
        <template v-else>
          <rect
            :x="-item.width / 2"
            :y="-item.depth / 2"
            :width="item.width"
            :height="item.depth"
            :rx="item.kind === 'service-counter' || item.kind === 'stairs' ? 3 : 8"
            fill="var(--ui-bg-elevated)"
            :stroke="item.kind === 'service-counter' || item.kind === 'stairs' ? 'var(--ui-text-muted)' : 'var(--ui-border-accented)'"
            stroke-width="3"
          />
          <g
            v-if="item.kind === 'stairs'"
            stroke="var(--ui-border-accented)"
            stroke-width="2"
          >
            <line
              v-for="y in stairLines(item.depth)"
              :key="y"
              :x1="-item.width / 2"
              :x2="item.width / 2"
              :y1="y"
              :y2="y"
            />
            <path
              :d="`M0 ${item.depth / 2 - 30} V${-item.depth / 2 + 40} M-14 ${-item.depth / 2 + 58} L0 ${-item.depth / 2 + 40} L14 ${-item.depth / 2 + 58}`"
              fill="none"
              stroke="var(--ui-text-muted)"
              stroke-width="3"
              stroke-linecap="round"
            />
          </g>
          <g
            v-else-if="item.kind === 'room-divider'"
            stroke="var(--ui-border-accented)"
            stroke-width="2"
          >
            <line
              v-for="x in slatLines(item.width)"
              :key="x"
              :x1="x"
              :x2="x"
              :y1="-item.depth / 2"
              :y2="item.depth / 2"
            />
          </g>
          <g v-else-if="item.kind === 'planter'">
            <circle
              v-for="x in slatLines(item.width).filter((_, index) => index % 3 === 1)"
              :key="x"
              :cx="x"
              :r="Math.min(16, item.depth / 2 - 2)"
              fill="color-mix(in oklab, var(--ui-success) 35%, var(--ui-bg))"
            />
          </g>
          <line
            v-else-if="item.kind === 'cafe-chair' || item.kind === 'bentwood-chair'"
            :x1="-item.width / 2 + 6"
            :x2="item.width / 2 - 6"
            :y1="-item.depth / 2 + 6"
            :y2="-item.depth / 2 + 6"
            stroke="var(--ui-text-muted)"
            stroke-width="4"
            stroke-linecap="round"
          />
          <text
            v-if="item.kind === 'service-counter' || item.kind === 'display-shelf'"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="20"
            fill="var(--ui-text-muted)"
            :transform="`rotate(${-item.rotation})`"
          >{{ item.kind === 'service-counter' ? 'Counter' : 'Shelf' }}</text>
        </template>
      </g>
    </g>

    <!-- Walls, railings, doors and windows on the outline. -->
    <g
      v-for="edge in edges"
      :key="edge.index"
      pointer-events="none"
    >
      <line
        v-if="isSelected('edge', String(edge.index))"
        :x1="edge.from.x"
        :y1="edge.from.y"
        :x2="edge.to.x"
        :y2="edge.to.y"
        stroke="color-mix(in oklab, var(--ui-warning) 40%, transparent)"
        stroke-width="44"
        data-testid="plan-edge-selected"
      />
      <line
        v-if="edge.kind === 'wall'"
        :x1="edge.from.x"
        :y1="edge.from.y"
        :x2="edge.to.x"
        :y2="edge.to.y"
        stroke="var(--ui-text-toned)"
        :stroke-width="WALL_THICKNESS_CM"
        stroke-linecap="square"
      />
      <template v-else-if="edge.kind === 'railing'">
        <line
          :x1="edge.from.x"
          :y1="edge.from.y"
          :x2="edge.to.x"
          :y2="edge.to.y"
          stroke="var(--ui-text-muted)"
          stroke-width="8"
        />
        <line
          :x1="edge.from.x"
          :y1="edge.from.y"
          :x2="edge.to.x"
          :y2="edge.to.y"
          stroke="var(--ui-bg)"
          stroke-width="3"
          stroke-dasharray="3 22"
        />
      </template>
      <line
        v-else
        :x1="edge.from.x"
        :y1="edge.from.y"
        :x2="edge.to.x"
        :y2="edge.to.y"
        stroke="var(--ui-border-accented)"
        stroke-width="3"
        stroke-dasharray="10 10"
      />
      <template
        v-for="opening in edge.openings"
        :key="opening.id"
      >
        <line
          :x1="opening.start.x"
          :y1="opening.start.y"
          :x2="opening.end.x"
          :y2="opening.end.y"
          stroke="var(--ui-bg)"
          :stroke-width="WALL_THICKNESS_CM + 3"
        />
        <template v-if="opening.kind === 'window'">
          <line
            :x1="opening.start.x"
            :y1="opening.start.y"
            :x2="opening.end.x"
            :y2="opening.end.y"
            stroke="color-mix(in oklab, var(--ui-info) 35%, var(--ui-bg))"
            stroke-width="16"
          />
          <line
            :x1="opening.start.x"
            :y1="opening.start.y"
            :x2="opening.end.x"
            :y2="opening.end.y"
            stroke="var(--ui-info)"
            stroke-width="3"
          />
        </template>
        <path
          v-else
          :d="`M${opening.hinge.x} ${opening.hinge.y} L${opening.swing.x} ${opening.swing.y}`"
          stroke="var(--ui-text-toned)"
          stroke-width="5"
        />
      </template>
    </g>

    <!-- The real dining tables (amber: each has a QR), their chairs from their seats. -->
    <g
      :opacity="mode === 'outline' ? 0.35 : 1"
      :pointer-events="piecesActive ? undefined : 'none'"
    >
      <g
        v-for="table in placed"
        :key="table.tableId"
        :transform="transform(table)"
        data-kind="table"
        :data-id="table.tableId"
        :data-testid="`plan-table-${table.label}`"
        class="cursor-grab"
      >
        <rect
          v-for="(chair, index) in table.chairs"
          :key="index"
          v-bind="chairRect(table.look.chair)"
          rx="8"
          :transform="transform(chair)"
          fill="var(--ui-bg-elevated)"
          stroke="var(--ui-border-accented)"
          stroke-width="2.5"
        />
        <template v-if="table.look.shape === 'booth'">
          <rect
            v-for="side in [1, -1]"
            :key="side"
            :x="-table.width / 2 - 5"
            :y="side > 0 ? table.depth / 2 : -table.depth / 2 - BOOTH_BENCH_DEPTH_CM"
            :width="table.width + 10"
            :height="BOOTH_BENCH_DEPTH_CM"
            rx="12"
            fill="color-mix(in oklab, var(--ui-primary) 8%, var(--ui-bg-elevated))"
            stroke="var(--ui-text-muted)"
            stroke-width="2.5"
          />
        </template>
        <ellipse
          v-if="table.look.shape === 'round'"
          :rx="table.width / 2"
          :ry="table.depth / 2"
          fill="color-mix(in oklab, var(--ui-primary) 14%, var(--ui-bg))"
          stroke="var(--ui-primary)"
          stroke-width="3"
        />
        <rect
          v-else
          :x="-table.width / 2"
          :y="-table.depth / 2"
          :width="table.width"
          :height="table.depth"
          rx="10"
          fill="color-mix(in oklab, var(--ui-primary) 14%, var(--ui-bg))"
          stroke="var(--ui-primary)"
          stroke-width="3"
        />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          font-size="26"
          font-weight="600"
          fill="var(--ui-text-highlighted)"
          :transform="`rotate(${-table.rotation})`"
        >{{ table.label }}</text>
      </g>
    </g>

    <!-- Placement warnings are advisory. -->
    <g
      fill="color-mix(in oklab, var(--ui-warning) 10%, transparent)"
      stroke="var(--ui-warning)"
      stroke-width="4"
      stroke-dasharray="12 8"
      pointer-events="none"
    >
      <template
        v-for="table in placed"
        :key="table.tableId"
      >
        <polygon
          v-if="warnings.has(table.tableId)"
          :points="warningCorners(table, table.extent.width, table.extent.depth)"
        />
      </template>
      <template
        v-for="item in items"
        :key="item.id"
      >
        <polygon
          v-if="warnings.has(item.id)"
          :points="warningCorners(item, item.width, item.depth)"
        />
      </template>
    </g>

    <!-- The Room tool's rectangle (D278): primary to add, error to cut out. -->
    <g
      v-if="roomPreview"
      pointer-events="none"
      data-testid="room-preview"
    >
      <rect
        :x="roomPreview.bounds.minX"
        :y="roomPreview.bounds.minY"
        :width="roomPreview.bounds.maxX - roomPreview.bounds.minX"
        :height="roomPreview.bounds.maxY - roomPreview.bounds.minY"
        :fill="roomPreview.cut ? 'color-mix(in oklab, var(--ui-error) 12%, transparent)' : 'color-mix(in oklab, var(--ui-primary) 12%, transparent)'"
        :stroke="roomPreview.cut ? 'var(--ui-error)' : 'var(--ui-primary)'"
        stroke-width="2"
        stroke-dasharray="8 6"
        vector-effect="non-scaling-stroke"
      />
      <text
        :x="(roomPreview.bounds.minX + roomPreview.bounds.maxX) / 2"
        :y="(roomPreview.bounds.minY + roomPreview.bounds.maxY) / 2"
        text-anchor="middle"
        dominant-baseline="central"
        :font-size="12 * perPixel"
        fill="var(--ui-text-highlighted)"
      >{{ roomPreview.bounds.maxX - roomPreview.bounds.minX }} × {{ roomPreview.bounds.maxY - roomPreview.bounds.minY }} cm</text>
    </g>

    <!-- What a click would pick (D278). -->
    <g
      v-if="hoverOutline"
      pointer-events="none"
      data-testid="plan-hover"
    >
      <rect
        v-if="hoverOutline.kind === 'frame'"
        :transform="transform(hoverOutline.pose)"
        :x="-hoverOutline.width / 2"
        :y="-hoverOutline.depth / 2"
        :width="hoverOutline.width"
        :height="hoverOutline.depth"
        fill="none"
        stroke="var(--ui-primary)"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-else
        :x1="hoverOutline.from.x"
        :y1="hoverOutline.from.y"
        :x2="hoverOutline.to.x"
        :y2="hoverOutline.to.y"
        stroke="color-mix(in oklab, var(--ui-primary) 45%, transparent)"
        :stroke-width="Math.max(20, perPixel * 6)"
        stroke-linecap="round"
      />
    </g>

    <!-- The selection, with its turn handle and corner handles (2B). -->
    <template v-if="mode === 'select'">
      <template
        v-for="table in placed"
        :key="table.tableId"
      >
        <g
          v-if="isSelected('table', table.tableId)"
          :transform="transform(table)"
        >
          <rect
            :x="-table.extent.width / 2 - 6"
            :y="-table.extent.depth / 2 - 6"
            :width="table.extent.width + 12"
            :height="table.extent.depth + 12"
            fill="none"
            stroke="var(--ui-primary)"
            stroke-width="3"
            vector-effect="non-scaling-stroke"
            pointer-events="none"
          />
          <line
            x1="0"
            x2="0"
            :y1="-table.extent.depth / 2 - 6"
            :y2="-table.extent.depth / 2 - 44"
            stroke="var(--ui-primary)"
            stroke-width="3"
            pointer-events="none"
          />
          <circle
            :cy="-table.extent.depth / 2 - 56"
            r="14"
            fill="var(--ui-bg)"
            stroke="var(--ui-primary)"
            stroke-width="4"
            data-kind="table"
            :data-id="table.tableId"
            data-handle="rotate"
            data-testid="rotate-handle"
            class="cursor-alias"
          />
          <g
            v-for="(point, handle) in handleCorners(table.extent.width + 12, table.extent.depth + 12)"
            :key="handle"
          >
            <rect
              :x="point.x - 6 * perPixel"
              :y="point.y - 6 * perPixel"
              :width="12 * perPixel"
              :height="12 * perPixel"
              fill="var(--ui-bg)"
              stroke="var(--ui-primary)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              pointer-events="none"
            />
            <rect
              :x="point.x - 16 * perPixel"
              :y="point.y - 16 * perPixel"
              :width="32 * perPixel"
              :height="32 * perPixel"
              fill="transparent"
              data-kind="table"
              :data-id="table.tableId"
              data-handle="resize"
              :data-corner="handle"
              :data-testid="`resize-handle-${handle}`"
              :class="handle % 2 ? 'cursor-nesw-resize' : 'cursor-nwse-resize'"
            />
          </g>
        </g>
      </template>
      <template
        v-for="item in items"
        :key="item.id"
      >
        <g
          v-if="isSelected('item', item.id)"
          :transform="transform(item)"
        >
          <rect
            :x="-item.width / 2 - 8"
            :y="-item.depth / 2 - 8"
            :width="item.width + 16"
            :height="item.depth + 16"
            fill="none"
            stroke="var(--ui-primary)"
            stroke-width="3"
            vector-effect="non-scaling-stroke"
            pointer-events="none"
          />
          <circle
            :cy="-item.depth / 2 - 50"
            r="14"
            fill="var(--ui-bg)"
            stroke="var(--ui-primary)"
            stroke-width="4"
            data-kind="item"
            :data-id="item.id"
            data-handle="rotate"
            class="cursor-alias"
          />
          <g
            v-for="(point, handle) in (isFigureKind(item.kind) ? [] : handleCorners(item.width + 16, item.depth + 16))"
            :key="handle"
          >
            <rect
              :x="point.x - 6 * perPixel"
              :y="point.y - 6 * perPixel"
              :width="12 * perPixel"
              :height="12 * perPixel"
              fill="var(--ui-bg)"
              stroke="var(--ui-primary)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              pointer-events="none"
            />
            <rect
              :x="point.x - 16 * perPixel"
              :y="point.y - 16 * perPixel"
              :width="32 * perPixel"
              :height="32 * perPixel"
              fill="transparent"
              data-kind="item"
              :data-id="item.id"
              data-handle="resize"
              :data-corner="handle"
              :class="handle % 2 ? 'cursor-nesw-resize' : 'cursor-nwse-resize'"
            />
          </g>
        </g>
      </template>
    </template>

    <!-- Draw outline, editing (3A): the shape's lines, edge lengths, corner and edge handles. -->
    <template v-if="mode === 'outline' && !drawing">
      <polygon
        :points="points(shape.outline)"
        fill="none"
        stroke="var(--ui-primary)"
        stroke-width="3"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
      <g
        v-for="edge in edges"
        :key="`label-${edge.index}`"
        data-kind="edge-length"
        :data-id="edge.index"
        class="cursor-text"
      >
        <title>Click to type the length</title>
        <rect
          :x="edge.label.x - chipSize(metres(edge.length)).width / 2"
          :y="edge.label.y - chipSize(metres(edge.length)).height / 2"
          :width="chipSize(metres(edge.length)).width"
          :height="chipSize(metres(edge.length)).height"
          :rx="4 * perPixel"
          fill="var(--ui-bg)"
          stroke="var(--ui-border-accented)"
          vector-effect="non-scaling-stroke"
        />
        <text
          :x="edge.label.x"
          :y="edge.label.y"
          text-anchor="middle"
          dominant-baseline="central"
          :font-size="chipSize('').font"
          font-weight="600"
          fill="var(--ui-text-highlighted)"
          :data-testid="`plan-edge-length-${edge.index}`"
        >{{ metres(edge.length) }}</text>
      </g>
      <circle
        v-for="edge in edges"
        :key="`mid-${edge.index}`"
        :cx="edge.middle.x"
        :cy="edge.middle.y"
        :r="7 * perPixel"
        fill="var(--ui-bg)"
        stroke="var(--ui-primary)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        data-kind="midpoint"
        :data-id="edge.index"
        :data-testid="`plan-midpoint-${edge.index}`"
        class="cursor-copy"
      >
        <title>Add a corner here</title>
      </circle>
      <rect
        v-for="(point, index) in shape.outline"
        :key="`corner-${index}`"
        :x="point.x - 9 * perPixel"
        :y="point.y - 9 * perPixel"
        :width="18 * perPixel"
        :height="18 * perPixel"
        :rx="3 * perPixel"
        :fill="corner === index ? 'var(--ui-primary)' : 'var(--ui-bg)'"
        stroke="var(--ui-primary)"
        stroke-width="2.5"
        vector-effect="non-scaling-stroke"
        data-kind="corner"
        :data-id="index"
        :data-testid="`plan-corner-${index}`"
        class="cursor-move"
      />
    </template>

    <!-- Draw outline, a new shape: corners so far and the next one under the pointer. -->
    <template v-if="drawing">
      <polyline
        :points="points(drawingPreview)"
        fill="none"
        stroke="var(--ui-primary)"
        stroke-width="3"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
      <rect
        v-for="(point, index) in drawn"
        :key="index"
        :x="point.x - 9 * perPixel"
        :y="point.y - 9 * perPixel"
        :width="18 * perPixel"
        :height="18 * perPixel"
        :rx="3 * perPixel"
        :fill="index === 0 && drawn.length >= 3 ? 'var(--ui-primary)' : 'var(--ui-bg)'"
        stroke="var(--ui-primary)"
        stroke-width="2.5"
        vector-effect="non-scaling-stroke"
        :data-kind="index === 0 && drawn.length >= 3 ? 'first-corner' : undefined"
        :class="index === 0 && drawn.length >= 3 && 'cursor-pointer'"
      />
    </template>

    <!-- Draw wall: the wall so far, with its length. -->
    <g
      v-if="wallPreview"
      pointer-events="none"
    >
      <line
        :x1="wallPreview.from.x"
        :y1="wallPreview.from.y"
        :x2="wallPreview.to.x"
        :y2="wallPreview.to.y"
        stroke="var(--ui-primary)"
        stroke-width="12"
        stroke-linecap="square"
        opacity="0.7"
      />
      <rect
        :x="(wallPreview.from.x + wallPreview.to.x) / 2 - chipSize(metres(wallPreview.length)).width / 2"
        :y="(wallPreview.from.y + wallPreview.to.y) / 2 - 40 * perPixel"
        :width="chipSize(metres(wallPreview.length)).width"
        :height="chipSize('').height"
        :rx="4 * perPixel"
        fill="var(--ui-text-highlighted)"
      />
      <text
        :x="(wallPreview.from.x + wallPreview.to.x) / 2"
        :y="(wallPreview.from.y + wallPreview.to.y) / 2 - 40 * perPixel + chipSize('').height / 2"
        text-anchor="middle"
        dominant-baseline="central"
        :font-size="chipSize('').font"
        fill="var(--ui-bg)"
      >{{ metres(wallPreview.length) }}</text>
    </g>
    <circle
      v-if="mode === 'wall' && wallStart"
      :cx="wallStart.x"
      :cy="wallStart.y"
      :r="7 * perPixel"
      fill="var(--ui-primary)"
      pointer-events="none"
    />
    <circle
      v-if="(drawing || mode === 'wall') && hover"
      :cx="hover.x"
      :cy="hover.y"
      :r="5 * perPixel"
      fill="none"
      stroke="var(--ui-primary)"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
      pointer-events="none"
    />

    <!-- A piece on its way from the library: see-through, snapped. -->
    <g
      v-if="ghostView"
      :transform="`translate(${ghostView.x} ${ghostView.y})`"
      opacity="0.6"
      pointer-events="none"
      stroke-dasharray="8 5"
      :stroke="ghostWarning ? 'var(--ui-warning)' : 'var(--ui-primary)'"
      data-testid="plan-ghost"
    >
      <template v-if="ghostView.kind === 'table'">
        <rect
          v-for="(chair, index) in ghostView.chairs"
          :key="index"
          v-bind="chairRect(ghostView.look.chair)"
          rx="8"
          :transform="transform(chair)"
          fill="var(--ui-bg)"
          stroke-width="2.5"
        />
        <template v-if="ghostView.look.shape === 'booth'">
          <rect
            v-for="side in [1, -1]"
            :key="side"
            :x="-ghostView.width / 2 - 5"
            :y="side > 0 ? ghostView.depth / 2 : -ghostView.depth / 2 - BOOTH_BENCH_DEPTH_CM"
            :width="ghostView.width + 10"
            :height="BOOTH_BENCH_DEPTH_CM"
            rx="12"
            fill="var(--ui-bg)"
            stroke-width="2.5"
          />
        </template>
        <ellipse
          v-if="ghostView.look.shape === 'round'"
          :rx="ghostView.width / 2"
          :ry="ghostView.depth / 2"
          fill="color-mix(in oklab, var(--ui-primary) 25%, var(--ui-bg))"
          stroke-width="3"
        />
        <rect
          v-else
          :x="-ghostView.width / 2"
          :y="-ghostView.depth / 2"
          :width="ghostView.width"
          :height="ghostView.depth"
          rx="10"
          fill="color-mix(in oklab, var(--ui-primary) 25%, var(--ui-bg))"
          stroke-width="3"
        />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          font-size="26"
          font-weight="600"
          fill="var(--ui-text-highlighted)"
          stroke="none"
        >{{ ghostView.label }}</text>
      </template>
      <ellipse
        v-else-if="ITEM_SPECS[ghostView.itemKind].footprint === 'round'"
        :rx="ghostView.width / 2"
        :ry="ghostView.depth / 2"
        fill="var(--ui-bg-elevated)"
        stroke-width="3"
      />
      <rect
        v-else
        :x="-ghostView.width / 2"
        :y="-ghostView.depth / 2"
        :width="ghostView.width"
        :height="ghostView.depth"
        rx="8"
        fill="var(--ui-bg-elevated)"
        stroke-width="3"
      />
    </g>
  </svg>
  <span
    v-if="cornerChip"
    class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-inverted px-2 py-1 text-xs font-medium text-inverted tabular-nums"
    data-testid="corner-chip"
  >{{ cornerChip }}</span>
  <p
    v-if="mode === 'wall'"
    class="sr-only"
    aria-live="polite"
  >
    {{ wallStart ? 'Click where the wall ends.' : 'Click where the wall starts.' }}
  </p>
</template>
