import * as v from 'valibot'

/**
 * A branch's shop layout (D273, docs/plans/shop-designer.md): floors drawn as outlines with walls,
 * railings, doors and windows, the furniture on them, and where each real dining table stands.
 * One document drives the 2D editor and the 3D building. The layout never holds a table's label,
 * seats or QR: a placement names the table's id, and the table record stays the source of truth.
 *
 * Units: lengths are whole centimetres, angles whole degrees clockwise in the top-down view (y
 * points down, like the editor's SVG). Ids are client-made strings, unique in their layout.
 *
 * Step 1 (the prototype) validates its demo data with these schemas; step 2a's save route uses the
 * same ones, so every rule here is also a server rule.
 */

export const LAYOUT_MAX_FLOORS = 10
export const LAYOUT_MAX_CORNERS = 64
export const LAYOUT_MAX_ITEMS_PER_FLOOR = 200
export const LAYOUT_MAX_WALLS_PER_FLOOR = 100
/** No building is larger than this in either direction (100 m). */
export const LAYOUT_MAX_EXTENT_CM = 10_000
export const FLOOR_HEIGHT_MIN_CM = 200
export const FLOOR_HEIGHT_MAX_CM = 800
export const FLOOR_NAME_MAX = 30

/** The fixed finish palette (D273): looks store keys, never free colors. */
export const FINISHES = [
  'warm-oak', 'walnut', 'pale-oak', 'dark-wood',
  'graphite', 'steel', 'brass',
  'olive', 'linen', 'chocolate', 'terracotta', 'navy',
  'limestone', 'taupe-stone', 'black-stone', 'white-marble',
] as const
export type Finish = typeof FINISHES[number]

/** Furniture and fixtures that are not dining tables: they carry no QR. */
export const ITEM_KINDS = [
  'cafe-chair', 'bentwood-chair', 'bar-stool', 'dining-bench',
  'service-counter', 'display-shelf', 'planter', 'plant', 'room-divider', 'stairs',
] as const
export type ItemKind = typeof ITEM_KINDS[number]

/** A table look's top (D273): round, rectangle (square is a rectangle) or a booth with benches. */
export const TABLE_SHAPES = ['round', 'rect', 'booth'] as const
export type TableShape = typeof TABLE_SHAPES[number]
export const TABLE_BASES = ['pedestal', 'legs'] as const
export type TableBase = typeof TABLE_BASES[number]
/** The chairs a look places around its table, as many as the table's seats. */
export const LOOK_CHAIRS = ['cafe-chair', 'bentwood-chair', 'bar-stool', 'none'] as const
export type LookChair = typeof LOOK_CHAIRS[number]

export const EDGE_KINDS = ['wall', 'railing', 'open'] as const
export type EdgeKind = typeof EDGE_KINDS[number]
export const OPENING_KINDS = ['door', 'window'] as const
export type OpeningKind = typeof OPENING_KINDS[number]

const idSchema = v.pipe(v.string(), v.regex(/^[\w-]{1,40}$/, 'Not an id'))
const cmSchema = v.pipe(v.number(), v.integer(), v.minValue(-LAYOUT_MAX_EXTENT_CM), v.maxValue(LAYOUT_MAX_EXTENT_CM))
const sizeSchema = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max))
const rotationSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(359))
const finishSchema = v.picklist(FINISHES)

export const pointSchema = v.strictObject({ x: cmSchema, y: cmSchema })
export type Point = v.InferOutput<typeof pointSchema>

export const openingSchema = v.strictObject({
  id: idSchema,
  kind: v.picklist(OPENING_KINDS),
  /** From the edge's start corner to the opening's start, along the edge. */
  offset: sizeSchema(0, LAYOUT_MAX_EXTENT_CM),
  width: sizeSchema(40, 1_000),
})
export type Opening = v.InferOutput<typeof openingSchema>

/** Edge `i` runs from corner `i` to corner `i + 1` (the last one back to the first). */
export const edgeSchema = v.strictObject({
  kind: v.picklist(EDGE_KINDS),
  openings: v.pipe(v.array(openingSchema), v.maxLength(20)),
})
export type Edge = v.InferOutput<typeof edgeSchema>

/** A wall inside a floor (a stair kiosk, a kitchen), drawn with Draw wall. */
export const innerWallSchema = v.strictObject({ id: idSchema, from: pointSchema, to: pointSchema })
export type InnerWall = v.InferOutput<typeof innerWallSchema>

const finishesSchema = v.pipe(
  v.record(v.pipe(v.string(), v.regex(/^[a-z]{1,20}$/)), finishSchema),
  v.check(finishes => Object.keys(finishes).length <= 6, 'Too many finishes'),
)

/** Furniture or a fixture: its centre, turn and footprint. Height is the kind's own. */
export const itemSchema = v.strictObject({
  id: idSchema,
  kind: v.picklist(ITEM_KINDS),
  x: cmSchema,
  y: cmSchema,
  rotation: rotationSchema,
  width: sizeSchema(10, 2_000),
  depth: sizeSchema(10, 2_000),
  /** By the kind's finish slots (`frame`, `seat`, `top`…); a missing slot uses the kind's default. */
  finishes: finishesSchema,
})
export type LayoutItem = v.InferOutput<typeof itemSchema>

export const floorSchema = v.pipe(
  v.strictObject({
    id: idSchema,
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(FLOOR_NAME_MAX)),
    height: sizeSchema(FLOOR_HEIGHT_MIN_CM, FLOOR_HEIGHT_MAX_CM),
    hasRoof: v.boolean(),
    outline: v.pipe(v.array(pointSchema), v.minLength(3, 'An outline needs 3 corners'), v.maxLength(LAYOUT_MAX_CORNERS)),
    edges: v.array(edgeSchema),
    walls: v.pipe(v.array(innerWallSchema), v.maxLength(LAYOUT_MAX_WALLS_PER_FLOOR)),
    items: v.pipe(v.array(itemSchema), v.maxLength(LAYOUT_MAX_ITEMS_PER_FLOOR)),
  }),
  v.check(floor => floor.edges.length === floor.outline.length, 'Every outline edge needs its kind'),
  v.check(floor => floor.edges.every((edge, index) => openingsFit(edge, edgeLength(floor.outline, index))), 'A door or window does not fit its edge'),
  v.check(floor => floor.edges.every(edge => edge.kind !== 'open' || edge.openings.length === 0), 'An open edge has no doors or windows'),
  v.check(floor => floor.edges.every(edge => edge.kind !== 'railing' || edge.openings.every(opening => opening.kind === 'door')), 'A window needs a wall'),
  v.check(floor => Math.abs(signedArea(floor.outline)) >= 10_000, 'The outline has no area'),
)
export type Floor = v.InferOutput<typeof floorSchema>

/** Where a real dining table stands. Its look is a built-in key or a custom look's id. */
export const placementSchema = v.strictObject({
  tableId: idSchema,
  floorId: idSchema,
  x: cmSchema,
  y: cmSchema,
  rotation: rotationSchema,
  width: sizeSchema(40, 600),
  depth: sizeSchema(40, 600),
  lookId: idSchema,
})
export type Placement = v.InferOutput<typeof placementSchema>

export const layoutSchema = v.pipe(
  v.strictObject({
    floors: v.pipe(v.array(floorSchema), v.minLength(1, 'A layout needs a floor'), v.maxLength(LAYOUT_MAX_FLOORS)),
    placements: v.array(placementSchema),
  }),
  v.check(layout => unique(layout.floors.map(floor => floor.id)), 'Floor ids repeat'),
  v.check(layout => unique(layout.placements.map(placement => placement.tableId)), 'A table is placed twice'),
  v.check(layout => layout.placements.every(placement => layout.floors.some(floor => floor.id === placement.floorId)), 'A table is on a floor that does not exist'),
  v.check(layout => unique(layout.floors.flatMap(floor => [...floor.items.map(item => item.id), ...floor.walls.map(wall => wall.id)])), 'Item ids repeat'),
)
export type ShopLayout = v.InferOutput<typeof layoutSchema>

/** A table look (built in, or a cafe's custom look from step 3a). Shared by the tables using it. */
export interface TableLook {
  id: string
  name: string
  shape: TableShape
  base: TableBase
  chair: LookChair
  /** Slots: `top`, `base` and, for the chairs, `frame` and `seat`. */
  finishes: Partial<Record<string, Finish>>
  /** The size a newly placed table starts with; each placement keeps its own. */
  defaultWidth: number
  defaultDepth: number
}

/** What the layout needs to know about a dining table: the record stays the branches feature's. */
export interface LayoutTable {
  id: string
  label: string
  seats: number
}

export function edgeLength(outline: readonly Point[], index: number): number {
  const from = outline[index]!
  const to = outline[(index + 1) % outline.length]!
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** Positive when the corners run clockwise on screen (y down). */
export function signedArea(outline: readonly Point[]): number {
  let twice = 0
  for (let index = 0; index < outline.length; index++) {
    const from = outline[index]!
    const to = outline[(index + 1) % outline.length]!
    twice += from.x * to.y - to.x * from.y
  }
  return twice / 2
}

function openingsFit(edge: Edge, length: number): boolean {
  const sorted = [...edge.openings].sort((a, b) => a.offset - b.offset)
  let cursor = 0
  for (const opening of sorted) {
    if (opening.offset < cursor) return false
    cursor = opening.offset + opening.width
  }
  return cursor <= length + 0.5
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}
