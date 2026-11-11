import * as v from 'valibot'
import { MAX_BRANCH_TABLES } from './branches'
import { idSchema as uploadIdSchema } from './common'

/**
 * A branch's shop layout (D273, docs/plans/shop-designer.md): floors drawn as outlines with walls,
 * railings, doors and windows, the furniture on them, and where each real dining table stands.
 * One document drives the 2D editor and the 3D building. The layout never holds a table's label,
 * seats or QR: a placement names the table's id, and the table record stays the source of truth.
 *
 * Units: lengths are whole centimetres, angles whole degrees clockwise in the top-down view (y
 * points down, like the editor's SVG). Ids are client-made strings, unique in their layout.
 *
 * Step 1 (the prototype) validates its demo data with these schemas; the save route
 * (`PUT /api/c/<slug>/admin/branches/{branchId}/layout`, step 2a) uses the same ones, so every rule
 * here is also a server rule.
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
/**
 * A floor's drawing as JSON, at most (D273). One floor is one database value written by its own
 * statement, so this bounds every value and statement a save writes, whatever the mix of corners,
 * doors and furniture. A café floor is a few kilobytes.
 */
export const LAYOUT_MAX_FLOOR_BYTES = 64 * 1024
/** The save's body, at most: every floor full, every table placed, with room for the JSON around them. */
export const LAYOUT_MAX_BODY_BYTES = 768 * 1024

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

export const ITEM_SIZE_MIN_CM = 10
export const ITEM_SIZE_MAX_CM = 2_000

/** Furniture or a fixture: its centre, turn and footprint. Height is the kind's own. */
export const itemSchema = v.strictObject({
  id: idSchema,
  kind: v.picklist(ITEM_KINDS),
  x: cmSchema,
  y: cmSchema,
  rotation: rotationSchema,
  width: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
  depth: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
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
  // Valibot runs every check of a pipe, even after one failed: a check that reads both lists runs
  // only when they match, so a malformed floor is a 400, never a thrown error.
  v.check(floor => floor.edges.length === floor.outline.length, 'Every outline edge needs its kind'),
  v.check(floor => floor.edges.length !== floor.outline.length || floor.edges.every((edge, index) => openingsFit(edge, edgeLength(floor.outline, index))), 'A door or window does not fit its edge'),
  v.check(floor => floor.edges.every(edge => edge.kind !== 'open' || edge.openings.length === 0), 'An open edge has no doors or windows'),
  v.check(floor => floor.edges.every(edge => edge.kind !== 'railing' || edge.openings.every(opening => opening.kind === 'door')), 'A window needs a wall'),
  v.check(floor => Math.abs(signedArea(floor.outline)) >= 10_000, 'The outline has no area'),
  v.check(floor => jsonBytes(floor) <= LAYOUT_MAX_FLOOR_BYTES, 'This floor holds too much: move some furniture to another floor'),
)
export type Floor = v.InferOutput<typeof floorSchema>
/** What a floor stores as its drawing: everything but its id, name, height and roof. */
export type FloorGeometry = Pick<Floor, 'outline' | 'edges' | 'walls' | 'items'>

/** The built-in table looks (D273); the app's catalog describes each. */
export const BUILT_IN_LOOK_IDS = ['round-cafe', 'square-bistro', 'oak-rectangle', 'communal', 'green-booth'] as const
export type BuiltInLookId = typeof BUILT_IN_LOOK_IDS[number]
export const isBuiltInLook = (id: string): id is BuiltInLookId => (BUILT_IN_LOOK_IDS as readonly string[]).includes(id)

/** A cafe's own table looks (step 3a), at most. */
export const MAX_CUSTOM_LOOKS = 50
export const LOOK_NAME_MAX = 40
export const TABLE_SIZE_MIN_CM = 40
export const TABLE_SIZE_MAX_CM = 600

/**
 * Where a real dining table stands, and how it looks: `lookId` is a built-in look's key or the id
 * of one of the cafe's custom looks (the save answers 409 `LAYOUT_LOOK_UNAVAILABLE` for any other).
 */
export const placementSchema = v.strictObject({
  tableId: idSchema,
  floorId: idSchema,
  x: cmSchema,
  y: cmSchema,
  rotation: rotationSchema,
  width: sizeSchema(TABLE_SIZE_MIN_CM, TABLE_SIZE_MAX_CM),
  depth: sizeSchema(TABLE_SIZE_MIN_CM, TABLE_SIZE_MAX_CM),
  lookId: idSchema,
})
export type Placement = v.InferOutput<typeof placementSchema>

export const layoutSchema = v.pipe(
  v.strictObject({
    floors: v.pipe(v.array(floorSchema), v.minLength(1, 'A layout needs a floor'), v.maxLength(LAYOUT_MAX_FLOORS)),
    placements: v.pipe(v.array(placementSchema), v.maxLength(MAX_BRANCH_TABLES)),
  }),
  v.check(layout => unique(layout.floors.map(floor => floor.id)), 'Floor ids repeat'),
  v.check(layout => unique(layout.placements.map(placement => placement.tableId)), 'A table is placed twice'),
  v.check(layout => layout.placements.every(placement => layout.floors.some(floor => floor.id === placement.floorId)), 'A table is on a floor that does not exist'),
  v.check(layout => unique(layout.floors.flatMap(floor => [...floor.items.map(item => item.id), ...floor.walls.map(wall => wall.id)])), 'Item ids repeat'),
)
export type ShopLayout = v.InferOutput<typeof layoutSchema>

/**
 * `PUT …/layout`: the whole layout and the version read (0 when the branch has none yet). A stale
 * version is 409 `VERSION_CONFLICT` and nothing is saved; a placed table that is no longer active
 * in this branch is 409 `LAYOUT_TABLE_UNAVAILABLE` on `layout.placements.<i>.tableId`.
 */
export const saveLayoutSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(0)),
  layout: layoutSchema,
})
export type SaveLayoutInput = v.InferOutput<typeof saveLayoutSchema>

/** `GET …/layout`: the saved layout and the branch's active tables, placed or not. */
export interface BranchLayout {
  /** 0 until the first save. */
  version: number
  updatedAt: string | null
  floors: Floor[]
  placements: Placement[]
  /** The branch's active tables by label; the unplaced ones are the editor's Unplaced list. */
  tables: LayoutTable[]
}

/** A table look (built in, or one of the cafe's custom looks). Shared by the tables using it. */
export interface TableLook {
  /** A built-in look's key, or a custom look's id. */
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
  /** A custom look's photo (step 3b), shown in the picker and the table's details; built-in looks have none. */
  photo?: LookPhoto | null
}

/** A look's photo: an upload of the cafe's (`id`, for `photoId`) and where it's served. */
export interface LookPhoto {
  id: string
  url: string
}

/** A look's finishes by part: the table's top and base, and its chairs' frame and upholstery. */
export const lookFinishesSchema = v.strictObject({
  top: finishSchema,
  base: finishSchema,
  frame: v.optional(finishSchema),
  seat: v.optional(finishSchema),
})
export type LookFinishes = v.InferOutput<typeof lookFinishesSchema>

const lookFields = {
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(LOOK_NAME_MAX)),
  shape: v.picklist(TABLE_SHAPES),
  base: v.picklist(TABLE_BASES),
  chair: v.picklist(LOOK_CHAIRS),
  finishes: lookFinishesSchema,
  defaultWidth: sizeSchema(TABLE_SIZE_MIN_CM, TABLE_SIZE_MAX_CM),
  defaultDepth: sizeSchema(TABLE_SIZE_MIN_CM, TABLE_SIZE_MAX_CM),
  /**
   * An upload of the cafe's (`POST …/admin/media`) to show the real piece by; `null` or left out
   * for none. Each look has its own: one upload is never two looks' photo (422 `MEDIA_NOT_AVAILABLE`).
   */
  photoId: v.optional(v.nullable(uploadIdSchema), null),
}

/** `POST …/admin/furniture-looks`: a new custom look for the whole cafe (every branch). */
export const createLookSchema = v.strictObject(lookFields)
export type CreateLookInput = v.InferOutput<typeof createLookSchema>

/**
 * `PATCH …/admin/furniture-looks/{id}`: the whole look again, at the version read. Every table
 * using the look changes with it; their own width, depth and rotation stay. `photoId` too: left
 * out or `null`, the look's photo is removed (its upload released).
 */
export const updateLookSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  ...lookFields,
})
export type UpdateLookInput = v.InferOutput<typeof updateLookSchema>

/** One of the cafe's custom looks, as `GET …/admin/furniture-looks` lists them by name. */
export interface CustomLook extends TableLook {
  /** `null` without one, or when its upload is gone (the sample menu's reset deletes every upload). */
  photo: LookPhoto | null
  version: number
  /** How many placed tables use it, in every branch's saved layout. It can't be deleted while any does. */
  tables: number
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

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}
