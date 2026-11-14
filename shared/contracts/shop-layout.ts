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
/** Contract v2 (D282): outer and inside walls are one list, so an upgraded floor keeps its 100 inside walls and up to 64 outer ones. */
export const LAYOUT_MAX_WALLS_PER_FLOOR = 200
/** Floor surfaces (slabs) on one floor (D282). */
export const LAYOUT_MAX_SLABS_PER_FLOOR = 20
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

/**
 * The finish palette (D273). A finish is one of its keys or, since D285 (owner D2, free colours), a
 * colour of the owner's own, `#rrggbb` in lowercase: drawn with the material of the slot it is in.
 */
export const FINISHES = [
  'warm-oak', 'walnut', 'pale-oak', 'dark-wood',
  'graphite', 'steel', 'brass',
  'olive', 'linen', 'chocolate', 'terracotta', 'navy',
  'limestone', 'taupe-stone', 'black-stone', 'white-marble',
] as const
export type FinishKey = typeof FINISHES[number]
/** A colour of the owner's own (D285): `#` and six lowercase hex digits. */
export type FinishColor = `#${string}`
export type Finish = FinishKey | FinishColor
export const FINISH_COLOR_PATTERN = /^#[0-9a-f]{6}$/
export const isFinishColor = (value: string): value is FinishColor => FINISH_COLOR_PATTERN.test(value)

/**
 * People and pets (step 3g, D274): decoration the owner places like furniture. A figure is a model
 * of a fixed size: no table, QR code, seats or ordering state, no look and no finishes. Its
 * footprint is the model's own, so the plan and the 3D view always agree.
 */
export const FIGURE_SIZES = {
  'person': { width: 50, depth: 35 },
  'girl': { width: 40, depth: 30 },
  'boy': { width: 40, depth: 30 },
  'old-man': { width: 55, depth: 45 },
  'barista': { width: 50, depth: 50 },
  'seated-person': { width: 50, depth: 65 },
  'lazing-person': { width: 240, depth: 90 },
  'cat': { width: 25, depth: 40 },
  'dog': { width: 30, depth: 70 },
} as const satisfies Record<string, { width: number, depth: number }>
export type FigureKind = keyof typeof FIGURE_SIZES
export const FIGURE_KINDS = Object.keys(FIGURE_SIZES) as FigureKind[]
export const isFigureKind = (kind: string): kind is FigureKind => Object.hasOwn(FIGURE_SIZES, kind)

/**
 * Shapes (D278): a piece the owner draws for anything the catalog lacks (a stage, a planter box, a
 * raised platform): a rectangle or a circle of any size, with a name, a height and one finish.
 */
export const SHAPE_KINDS = ['block', 'block-round', 'block-poly'] as const
export type ShapeKind = typeof SHAPE_KINDS[number]
export const isShapeKind = (kind: string): kind is ShapeKind => (SHAPE_KINDS as readonly string[]).includes(kind)
export const SHAPE_HEIGHT = { default: 90, min: 20, max: 300 } as const
export const SHAPE_NAME_MAX = 40
/**
 * A round shape's arc (ED-06, Figma's arc): where the opening starts (degrees clockwise from the
 * right, like the plan's turns), how much of the circle is drawn, and the inner hole as a percent
 * of the outer size (a ring). Left out: 0°, the whole circle, no hole.
 */
export const SHAPE_ARC = { sweepMin: 1, sweepMax: 359, innerMax: 95 } as const
/** A rectangle shape's corner radius (ED-05): at most half its shorter side. */
export const SHAPE_RADIUS_MAX_CM = 1_000
/**
 * A polygon shape's corners (plan Phase 4): in thousandths of its width and depth from its middle
 * (−500 to 500), so resizing it stretches it like any shape. At least 3, at most 64.
 */
export const SHAPE_POINT_MAX = 500
export const SHAPE_POINTS_MAX = 64

/** Furniture, fixtures and figures that are not dining tables: they carry no QR. */
export const ITEM_KINDS = [
  'cafe-chair', 'bentwood-chair', 'bar-stool', 'dining-bench',
  'service-counter', 'display-shelf', 'planter', 'plant', 'room-divider', 'stairs',
  // Step 3f: lounge seating, bar and service, decor and lighting, outdoor.
  'armchair', 'sofa', 'coffee-table',
  'coffee-station', 'pastry-case', 'menu-board',
  'pendant-lamp', 'floor-lamp', 'water-jar',
  'parasol', 'bicycle',
  ...FIGURE_KINDS,
  ...SHAPE_KINDS,
] as const
export type ItemKind = typeof ITEM_KINDS[number]
/**
 * The kinds a cafe can save its own look for (step 3d): every chair and fixture, not stairs (a
 * structure). Adding a kind here needs no migration: the database stores it as text.
 */
export const ITEM_LOOK_KINDS = [
  'cafe-chair', 'bentwood-chair', 'bar-stool', 'dining-bench',
  'service-counter', 'display-shelf', 'planter', 'plant', 'room-divider',
  'armchair', 'sofa', 'coffee-table',
  'coffee-station', 'pastry-case', 'menu-board',
  'pendant-lamp', 'floor-lamp', 'water-jar',
  'parasol', 'bicycle',
] as const satisfies readonly ItemKind[]
export type ItemLookKind = typeof ITEM_LOOK_KINDS[number]
export const isItemLookKind = (kind: string): kind is ItemLookKind => (ITEM_LOOK_KINDS as readonly string[]).includes(kind)

/**
 * How tall each chair and fixture is, and how tall the owner can make it (step 3e, QS2), in cm: a
 * piece or a look without its own height has `default`. The range is what the kind's model can
 * draw well (a bar stool from a low stool to bar height). Stairs take their floor's height; people
 * and pets keep their own.
 */
export const ITEM_HEIGHTS = {
  'cafe-chair': { default: 82, min: 70, max: 115 },
  'bentwood-chair': { default: 88, min: 75, max: 115 },
  'bar-stool': { default: 75, min: 45, max: 90 },
  'dining-bench': { default: 46, min: 35, max: 80 },
  'service-counter': { default: 92, min: 75, max: 120 },
  'display-shelf': { default: 190, min: 80, max: 260 },
  // A planter's and a plant's height is to the top of the leaves.
  'planter': { default: 75, min: 45, max: 135 },
  'plant': { default: 125, min: 50, max: 220 },
  'room-divider': { default: 180, min: 80, max: 250 },
  'armchair': { default: 80, min: 65, max: 100 },
  'sofa': { default: 82, min: 65, max: 100 },
  'coffee-table': { default: 42, min: 30, max: 60 },
  // A coffee station's is its counter's: the machine and grinder stand on it.
  'coffee-station': { default: 92, min: 80, max: 110 },
  'pastry-case': { default: 125, min: 95, max: 150 },
  'menu-board': { default: 105, min: 70, max: 140 },
  // A pendant lamp's is how low its shade hangs; its cord goes up to the ceiling.
  'pendant-lamp': { default: 200, min: 140, max: 260 },
  'floor-lamp': { default: 160, min: 120, max: 190 },
  'water-jar': { default: 75, min: 45, max: 110 },
  'parasol': { default: 230, min: 200, max: 280 },
  'bicycle': { default: 100, min: 90, max: 115 },
} as const satisfies Record<ItemLookKind, { default: number, min: number, max: number }>
/** The database's bound for any kind's height; each kind's own range is narrower. */
export const ITEM_HEIGHT_MIN_CM = 20
export const ITEM_HEIGHT_MAX_CM = 300

/** The heights a kind can take: a chair's or fixture's (`ITEM_HEIGHTS`), a shape's; none for the others. */
export function itemHeightRange(kind: string): { default: number, min: number, max: number } | undefined {
  if (isItemLookKind(kind)) return ITEM_HEIGHTS[kind]
  if (isShapeKind(kind)) return SHAPE_HEIGHT
  return undefined
}

/** Whether `height` is in the kind's range (false for a kind with no height of its own). */
export function heightFits(kind: string, height: number): boolean {
  const range = itemHeightRange(kind)
  return !!range && height >= range.min && height <= range.max
}

/** The kind's height range, as a message. */
export const heightRangeMessage = (kind: ItemLookKind) => `${ITEM_HEIGHTS[kind].min} to ${ITEM_HEIGHTS[kind].max} cm`

/** A table look's top (D273): round, rectangle (square is a rectangle) or a booth with benches. */
export const TABLE_SHAPES = ['round', 'rect', 'booth'] as const
export type TableShape = typeof TABLE_SHAPES[number]
export const TABLE_BASES = ['pedestal', 'legs'] as const
export type TableBase = typeof TABLE_BASES[number]
/** The chairs a look places around its table, as many as the table's seats. */
export const LOOK_CHAIRS = ['cafe-chair', 'bentwood-chair', 'bar-stool', 'none'] as const
export type LookChair = typeof LOOK_CHAIRS[number]

/**
 * What a wall is (D278, D282): a full wall, a railing (a mezzanine's or a patio's edge), a half
 * wall (a bar's back, 110 cm) or a glass partition. Left out: a wall.
 */
export const WALL_KINDS = ['wall', 'railing', 'half', 'glass'] as const
export type WallKind = typeof WALL_KINDS[number]
/** Which side of its line a wall stands (D282), looking from `from` to `to` on the plan. Left out: centred on it. */
export const WALL_SIDES = ['left', 'right'] as const
export type WallSide = typeof WALL_SIDES[number]
export const WALL_THICKNESS_MIN_CM = 2
export const WALL_THICKNESS_MAX_CM = 100
export const WALL_HEIGHT_MIN_CM = 20
export const OPENING_KINDS = ['door', 'window'] as const
export type OpeningKind = typeof OPENING_KINDS[number]

const idSchema = v.pipe(v.string(), v.regex(/^[\w-]{1,40}$/, 'Not an id'))
/**
 * Hidden or locked in Studio's 2D view (ISS-021, like Figma's layers): design-only, left out when
 * off. 3D, Explore, QR codes and orders ignore them.
 */
const flagSchema = v.optional(v.literal(true))
/** A layer's own name in Studio's Layers list (ISS-021); left out: named by its kind. */
const layerNameSchema = v.optional(v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(SHAPE_NAME_MAX)))
const cmSchema = v.pipe(v.number(), v.integer(), v.minValue(-LAYOUT_MAX_EXTENT_CM), v.maxValue(LAYOUT_MAX_EXTENT_CM))
const sizeSchema = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max))
const rotationSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(359))
/** A free colour (D285), for a finish slot, a wall, a floor surface or a door. */
const colorSchema = v.custom<FinishColor>(value => typeof value === 'string' && isFinishColor(value), 'A colour is written #rrggbb')
const finishSchema = v.union([v.picklist(FINISHES), colorSchema], 'Not a finish or a colour')

export const pointSchema = v.strictObject({ x: cmSchema, y: cmSchema })
export type Point = v.InferOutput<typeof pointSchema>

/** A door's leaf opens into the room (`in`, away from its wall's side) or out of it. */
export const DOOR_SWINGS = ['in', 'out'] as const
export type DoorSwing = typeof DOOR_SWINGS[number]
/** The end of the doorway a door's leaf hangs from, along the wall: its start or its end. */
export const DOOR_HINGES = ['start', 'end'] as const
export type DoorHinge = typeof DOOR_HINGES[number]
export const OPENING_HEIGHT_MIN_CM = 50
export const WINDOW_SILL_MAX_CM = 700

/**
 * A door or window on a wall (D282). Left out, the shape is today's (owner D3, plan Phase 3):
 * `height` (a door's, or a window's from its sill) 210 cm or 130 cm, a window's `sill` 90 cm; a
 * door's leaf hangs at the doorway's `start` and opens `in`; `leaf: false` is an open doorway.
 */
export const openingSchema = v.pipe(
  v.strictObject({
    id: idSchema,
    kind: v.picklist(OPENING_KINDS),
    /** From the wall's start to the opening's start, along the wall. */
    offset: sizeSchema(0, LAYOUT_MAX_EXTENT_CM),
    width: sizeSchema(40, 1_000),
    height: v.optional(sizeSchema(OPENING_HEIGHT_MIN_CM, FLOOR_HEIGHT_MAX_CM)),
    sill: v.optional(sizeSchema(0, WINDOW_SILL_MAX_CM)),
    swing: v.optional(v.picklist(DOOR_SWINGS)),
    hinge: v.optional(v.picklist(DOOR_HINGES)),
    leaf: v.optional(v.literal(false)),
  }),
  v.check(opening => opening.kind === 'window' || opening.sill === undefined, 'Only a window has a sill'),
  v.check(opening => opening.kind === 'door' || (opening.swing === undefined && opening.hinge === undefined && opening.leaf === undefined), 'Only a door has a leaf'),
)
export type Opening = v.InferOutput<typeof openingSchema>

export const OUTLINE_CROSSES = 'The outline crosses itself'

/** What a floor surface is laid with (D285). */
export const FLOOR_SURFACES = ['planks', 'tiles', 'concrete'] as const
export type FloorSurface = typeof FLOOR_SURFACES[number]

/**
 * A floor surface (D282): one simple polygon, at least 1 m². A floor has 0..n of them; the roof
 * covers the same ones. Clockwise or not, as drawn.
 */
export const slabSchema = v.pipe(
  v.strictObject({
    id: idSchema,
    outline: v.pipe(v.array(pointSchema), v.minLength(3, 'An outline needs 3 corners'), v.maxLength(LAYOUT_MAX_CORNERS)),
    /** What the floor is laid with (D285); left out: planks under a roof, tiles in the open. */
    floor: v.optional(v.picklist(FLOOR_SURFACES)),
    /** Its colour (D285, owner D2); left out: the surface's own. */
    color: v.optional(colorSchema),
    name: layerNameSchema,
    hidden: flagSchema,
    locked: flagSchema,
  }),
  v.check(slab => Math.abs(signedArea(slab.outline)) >= 10_000, 'The outline has no area'),
  v.check(slab => isSimpleOutline(slab.outline), OUTLINE_CROSSES),
)
export type Slab = v.InferOutput<typeof slabSchema>

/**
 * A wall (D278, D282): one straight segment, outer or inside alike. `kind` and `openings` are left
 * out for a plain wall without doors; a door's offset runs from `from`. Only a full wall takes
 * windows; a door in a railing is a gate, in a half wall or glass a gap. `side` stands the wall
 * beside its line instead of on it (an outer wall outside its floor, so the room keeps the size
 * drawn); `thickness` and `height` replace the kind's own (geometry: `wallThickness`, `wallHeight`).
 */
export const wallSchema = v.strictObject({
  id: idSchema,
  from: pointSchema,
  to: pointSchema,
  kind: v.optional(v.picklist(WALL_KINDS)),
  openings: v.optional(v.pipe(v.array(openingSchema), v.maxLength(20))),
  side: v.optional(v.picklist(WALL_SIDES)),
  thickness: v.optional(sizeSchema(WALL_THICKNESS_MIN_CM, WALL_THICKNESS_MAX_CM)),
  height: v.optional(sizeSchema(WALL_HEIGHT_MIN_CM, FLOOR_HEIGHT_MAX_CM)),
  /** Its colour (D285, owner D2): a wall's or half wall's plaster, a railing's or glass's frame. */
  color: v.optional(colorSchema),
  name: layerNameSchema,
  hidden: flagSchema,
  locked: flagSchema,
})
export type Wall = v.InferOutput<typeof wallSchema>

/** A wall's kind, a plain wall when left out. */
export const wallKind = (wall: Pick<Wall, 'kind'>): WallKind => wall.kind ?? 'wall'
/** A wall's length in centimetres. */
export const wallLength = (wall: Pick<Wall, 'from' | 'to'>) => Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y)

const finishesSchema = v.pipe(
  v.record(v.pipe(v.string(), v.regex(/^[a-z]{1,20}$/)), finishSchema),
  v.check(finishes => Object.keys(finishes).length <= 6, 'Too many finishes'),
)

export const ITEM_SIZE_MIN_CM = 10
export const ITEM_SIZE_MAX_CM = 2_000

/** Furniture or a fixture: its centre, turn, footprint and, for a chair or fixture, its height. */
export const itemSchema = v.pipe(
  v.strictObject({
    id: idSchema,
    kind: v.picklist(ITEM_KINDS),
    x: cmSchema,
    y: cmSchema,
    rotation: rotationSchema,
    width: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
    depth: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
    /** By the kind's finish slots (`frame`, `seat`, `top`…); a missing slot uses the kind's default. */
    finishes: finishesSchema,
    /**
     * One of the cafe's own looks for this kind (step 3d): its finishes then win over the item's own,
     * and editing the look changes every piece that uses it. Left out: the item's own finishes.
     * A look that isn't the cafe's, or is of another kind, is 409 `LAYOUT_LOOK_UNAVAILABLE`.
     */
    lookId: v.optional(idSchema),
    /**
     * Its own height (step 3e), in the kind's range (`ITEM_HEIGHTS`). Left out: the kind's
     * default. Stairs and people and pets have none.
     */
    height: v.optional(sizeSchema(ITEM_HEIGHT_MIN_CM, ITEM_HEIGHT_MAX_CM)),
    /**
     * How far above its floor it stands (D282, plan Phase 4): a shelf on a wall, a sign, a lamp
     * over a counter. Left out: on the floor. Stairs and people and pets stand on it.
     */
    z: v.optional(sizeSchema(1, FLOOR_HEIGHT_MAX_CM)),
    /**
     * Its name (D278 for shapes; any piece since ISS-021, like a Figma layer), shown in Layers, and
     * on the plan and in 3D's card for a shape. Left out: named by its kind.
     */
    name: layerNameSchema,
    hidden: flagSchema,
    locked: flagSchema,
    /**
     * Mirrored left to right or front to back (ED-07, Figma's flips), before the turn. Left out:
     * not flipped. On the plan and in 3D alike.
     */
    flipX: flagSchema,
    flipY: flagSchema,
    /** A rectangle shape's corner radius in cm (ED-05). Left out: square corners. */
    radius: v.optional(sizeSchema(1, SHAPE_RADIUS_MAX_CM)),
    /** A round shape's arc (ED-06, see `SHAPE_ARC`). */
    arcStart: v.optional(rotationSchema),
    arcSweep: v.optional(sizeSchema(SHAPE_ARC.sweepMin, SHAPE_ARC.sweepMax)),
    arcInner: v.optional(sizeSchema(1, SHAPE_ARC.innerMax)),
    /** A polygon shape's corners (`SHAPE_POINT_MAX`); only it has them, and it needs them. */
    points: v.optional(v.pipe(
      v.array(v.strictObject({ x: sizeSchema(-SHAPE_POINT_MAX, SHAPE_POINT_MAX), y: sizeSchema(-SHAPE_POINT_MAX, SHAPE_POINT_MAX) })),
      v.minLength(3, 'An outline needs 3 corners'),
      v.maxLength(SHAPE_POINTS_MAX),
    )),
  }),
  v.forward(v.check(item => item.radius === undefined || item.kind === 'block', 'Only a rectangle shape has a corner radius'), ['radius']),
  v.forward(v.check(item => item.radius === undefined || item.radius * 2 <= Math.min(item.width, item.depth), 'The radius is more than half the shorter side'), ['radius']),
  v.check(item => item.kind === 'block-round' || (item.arcStart === undefined && item.arcSweep === undefined && item.arcInner === undefined), 'Only a round shape has an arc'),
  v.check(item => (item.kind === 'block-poly') === (item.points !== undefined), 'A polygon shape needs its corners, and only it has them'),
  v.check(item => item.points === undefined || (Math.abs(signedArea(item.points)) > 0 && isSimpleOutline(item.points)), OUTLINE_CROSSES),
  v.check(item => item.lookId === undefined || isItemLookKind(item.kind), 'Stairs, people and pets have no custom look'),
  v.forward(v.check(item => item.height === undefined || itemHeightRange(item.kind) !== undefined, 'Stairs, people and pets keep their own height'), ['height']),
  v.forward(v.check(item => item.height === undefined || itemHeightRange(item.kind) === undefined || heightFits(item.kind, item.height), 'Out of this kind\'s height range'), ['height']),
  v.check(item => !isFigureKind(item.kind) || (item.width === FIGURE_SIZES[item.kind].width && item.depth === FIGURE_SIZES[item.kind].depth), 'People and pets keep their own size'),
  v.check(item => !isFigureKind(item.kind) || Object.keys(item.finishes).length === 0, 'People and pets have no finishes'),
  v.check(item => item.z === undefined || (item.kind !== 'stairs' && !isFigureKind(item.kind)), 'Stairs and people stand on the floor'),
)
export type LayoutItem = v.InferOutput<typeof itemSchema>

export const floorSchema = v.pipe(
  v.strictObject({
    id: idSchema,
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(FLOOR_NAME_MAX)),
    height: sizeSchema(FLOOR_HEIGHT_MIN_CM, FLOOR_HEIGHT_MAX_CM),
    hasRoof: v.boolean(),
    /** Its floor surfaces (D282): none on an empty floor. */
    slabs: v.pipe(v.array(slabSchema), v.maxLength(LAYOUT_MAX_SLABS_PER_FLOOR)),
    walls: v.pipe(v.array(wallSchema), v.maxLength(LAYOUT_MAX_WALLS_PER_FLOOR)),
    items: v.pipe(v.array(itemSchema), v.maxLength(LAYOUT_MAX_ITEMS_PER_FLOOR)),
    /**
     * The floor as a frame on Studio's canvas (ISS-035): where its own (0, 0) sits, in cm. Its
     * drawing keeps its own coordinates, so moving the frame changes only these. Left out: 0.
     * Design-only: 3D stacks floors by their order, QR codes and orders never read it.
     */
    canvasX: v.optional(cmSchema),
    canvasY: v.optional(cmSchema),
    /** Its Studio page (ISS-036), one of the layout's `pages`. Left out: the first page. */
    pageId: v.optional(idSchema),
    hidden: flagSchema,
    locked: flagSchema,
  }),
  v.check(floor => floor.walls.every(wall => openingsFit({ openings: wall.openings ?? [] }, wallLength(wall))), 'A door or window does not fit its wall'),
  v.check(floor => floor.walls.every(wall => wallKind(wall) === 'wall' || (wall.openings ?? []).every(opening => opening.kind === 'door')), 'A window needs a full wall'),
  v.check(floor => jsonBytes(floor) <= LAYOUT_MAX_FLOOR_BYTES, 'This floor holds too much: move some furniture to another floor'),
)
export type Floor = v.InferOutput<typeof floorSchema>
/** What a floor stores as its drawing: everything but its id, name, height, roof and Studio frame. */
export type FloorGeometry = Pick<Floor, 'slabs' | 'walls' | 'items'>

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
  hidden: flagSchema,
  locked: flagSchema,
})
export type Placement = v.InferOutput<typeof placementSchema>

/** Studio's pages (ISS-036, like Figma's): groups of floors by purpose. At most this many. */
export const LAYOUT_MAX_PAGES = 20
export const PAGE_NAME_MAX = 30
/** The page floors without a `pageId` are on, and the one a layout without pages shows. */
export const DEFAULT_PAGE = { id: 'floors', name: 'Floors' } as const
export const pageSchema = v.strictObject({
  id: idSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(PAGE_NAME_MAX)),
})
export type LayoutPage = v.InferOutput<typeof pageSchema>

// --- The branch's scene (step 4a, D274) ---

/**
 * The surroundings around the café in 3D, the same for everyone who opens the branch. Checked here,
 * not by a `CHECK`: a new preset would otherwise need a table rebuild (as for item kinds, step 3d).
 */
export const SCENE_PRESETS = ['none', 'neighborhood-lane'] as const
export type ScenePreset = typeof SCENE_PRESETS[number]
/** The saved scene's JSON: room for later fields (sign text, awning, entrance), never a drawing. */
export const LAYOUT_SCENE_MAX_BYTES = 2 * 1024

export const layoutSceneSchema = v.pipe(
  v.strictObject({
    preset: v.picklist(SCENE_PRESETS, 'Unknown scene'),
    entrance: v.optional(v.nullable(idSchema)),
    explore: v.optional(v.boolean()),
  }),
  v.forward(v.check(scene => !scene.explore || scene.entrance != null, 'Choose a ground-floor street door to show this layout in Explore.'), ['entrance']),
  v.check(scene => jsonBytes(scene) <= LAYOUT_SCENE_MAX_BYTES, 'The scene is too large'),
)
export type LayoutScene = v.InferOutput<typeof layoutSceneSchema>
/** A branch that never chose one. */
export const NO_SCENE: LayoutScene = { preset: 'none' }

/** The uniquely identified door on the ground floor's walls, with its wall for the street frame. */
export function streetDoor(floors: readonly Pick<Floor, 'walls'>[], entrance: string | null | undefined): { wall: Wall, opening: Opening } | undefined {
  const ground = floors[0]
  if (!ground || entrance == null) return
  const matches = ground.walls.flatMap(wall => (wall.openings ?? [])
    .filter(opening => opening.kind === 'door' && opening.id === entrance)
    .map(opening => ({ wall, opening })))
  return matches.length === 1 ? matches[0] : undefined
}

export const INVALID_STREET_DOOR = 'Choose a door on the ground floor.'

export const layoutSchema = v.pipe(
  v.strictObject({
    floors: v.pipe(v.array(floorSchema), v.minLength(1, 'A layout needs a floor'), v.maxLength(LAYOUT_MAX_FLOORS)),
    placements: v.pipe(v.array(placementSchema), v.maxLength(MAX_BRANCH_TABLES)),
    /** Saved with the layout, at its version (step 4a). Left out: the saved scene stays (an app tab from before 4a). */
    scene: v.optional(layoutSceneSchema),
    /** Studio's pages (ISS-036). Left out: one page, `DEFAULT_PAGE`. */
    pages: v.optional(v.pipe(v.array(pageSchema), v.minLength(1, 'A layout needs a page'), v.maxLength(LAYOUT_MAX_PAGES))),
  }),
  v.forward(v.check(layout => layout.scene?.entrance == null || Boolean(streetDoor(layout.floors, layout.scene.entrance)), INVALID_STREET_DOOR), ['scene', 'entrance']),
  v.check(layout => unique(layout.floors.map(floor => floor.id)), 'Floor ids repeat'),
  v.check(layout => unique(layout.placements.map(placement => placement.tableId)), 'A table is placed twice'),
  v.check(layout => layout.placements.every(placement => layout.floors.some(floor => floor.id === placement.floorId)), 'A table is on a floor that does not exist'),
  v.check(layout => unique(layout.floors.flatMap(floor => [...floor.items.map(item => item.id), ...floor.walls.map(wall => wall.id), ...floor.slabs.map(slab => slab.id)])), 'Item ids repeat'),
  v.check(layout => unique((layout.pages ?? []).map(page => page.id)), 'Page ids repeat'),
  v.check(layout => unique(layout.floors.flatMap(floor => floor.walls.flatMap(wall => (wall.openings ?? []).map(opening => opening.id)))), 'Door and window ids repeat'),
  v.check(layout => layout.floors.every(floor => floor.pageId === undefined || (layout.pages ?? [DEFAULT_PAGE]).some(page => page.id === floor.pageId)), 'A floor is on a page that does not exist'),
)
export type ShopLayout = v.InferOutput<typeof layoutSchema>

/** A floor's page (ISS-036): its own, or the first page. */
export const floorPageId = (floor: Pick<Floor, 'pageId'>, pages: readonly LayoutPage[]) => floor.pageId ?? pages[0]?.id ?? DEFAULT_PAGE.id
/** The layout's pages: its own, or the one default page. */
export const layoutPages = (layout: Pick<ShopLayout, 'pages'>): LayoutPage[] => layout.pages?.length ? layout.pages : [{ ...DEFAULT_PAGE }]

/**
 * `PUT …/layout`: the whole layout and the version read (0 when the branch has none yet). A stale
 * version is 409 `VERSION_CONFLICT` and nothing is saved; a placed table that is no longer active
 * in this branch is 409 `LAYOUT_TABLE_UNAVAILABLE` on `layout.placements.<i>.tableId`.
 */
export const saveLayoutSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(0)),
  // A tab opened before contract v2 (D282) still sends floors with an outline: upgraded first.
  layout: v.pipe(v.unknown(), v.transform(upgradeLayout), layoutSchema),
})
export type SaveLayoutInput = v.InferOutput<typeof saveLayoutSchema>

/** `GET …/layout/history` (ISS-027): a version the layout can go back to. */
export interface LayoutHistoryEntry {
  version: number
  savedAt: string
  savedByName: string | null
}

/** `GET …/layout`: the saved layout and the branch's active tables, placed or not. */
export interface BranchLayout {
  /** 0 until the first save. */
  version: number
  updatedAt: string | null
  /** Who saved it last; null before the first save or once that account is gone. */
  updatedByName: string | null
  floors: Floor[]
  placements: Placement[]
  /** The surroundings everyone sees in 3D (step 4a); `NO_SCENE` until one is chosen. */
  scene: LayoutScene
  /** Studio's pages (ISS-036); left out until a layout saves its own. */
  pages?: LayoutPage[]
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
  /**
   * Shown in the picker and the table's details: a custom look's upload (step 3b), or the picture
   * a built-in look ships with (step 3d, a static file of the app's).
   */
  photo?: LookImage | null
}

/** Public geometry. A placed table's drawing carries its seat count instead of its dining record. */
export interface PublicExploreLayout {
  floors: Floor[]
  placements: (Omit<Placement, 'tableId'> & { seats: number })[]
  scene: Pick<LayoutScene, 'preset'> & { entrance: string, explore: true }
  looks: Omit<TableLook, 'name' | 'photo'>[]
  itemLooks: Omit<ItemLook, 'name' | 'photo'>[]
}

/** Where a look's picture is served. */
export interface LookImage {
  url: string
}

/** A custom look's photo: an upload of the cafe's (`id`, for `photoId`) and where it's served. */
export interface LookPhoto extends LookImage {
  id: string
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

/** A cafe's own chair and fixture looks (step 3d), at most. */
export const MAX_CUSTOM_ITEM_LOOKS = 50

/**
 * What a chair or fixture looks like (step 3d): a kind, its finishes by the kind's slots, and the
 * size a newly placed piece starts with. Shared by the pieces using it; each keeps its own size.
 */
export interface ItemLook {
  id: string
  name: string
  kind: ItemLookKind
  finishes: Record<string, Finish>
  defaultWidth: number
  defaultDepth: number
  /** The height a newly placed piece starts with (step 3e); each piece keeps its own. */
  defaultHeight: number
  photo?: LookImage | null
}

const itemLookFields = {
  name: lookFields.name,
  /** By the kind's finish slots (`frame`, `seat`, `cabinet`, `top`…); a missing slot uses the kind's default. */
  finishes: finishesSchema,
  defaultWidth: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
  defaultDepth: sizeSchema(ITEM_SIZE_MIN_CM, ITEM_SIZE_MAX_CM),
  /**
   * In the kind's range (`ITEM_HEIGHTS`, step 3e); `null` or left out: the kind's default. Out of
   * range is a 400 on `defaultHeight` (a create checks it here; an edit, whose body has no kind,
   * in the service against the look's kind).
   */
  defaultHeight: v.optional(v.nullable(sizeSchema(ITEM_HEIGHT_MIN_CM, ITEM_HEIGHT_MAX_CM)), null),
  /** As a table look's `photoId`: one upload is one look's photo only. */
  photoId: lookFields.photoId,
}

/** `POST …/admin/item-looks`: a new chair or fixture look for the whole cafe (every branch). */
export const createItemLookSchema = v.pipe(
  v.strictObject({
    kind: v.picklist(ITEM_LOOK_KINDS),
    ...itemLookFields,
  }),
  v.forward(
    v.check(look => look.defaultHeight === null || heightFits(look.kind, look.defaultHeight), 'Out of this kind\'s height range'),
    ['defaultHeight'],
  ),
)
export type CreateItemLookInput = v.InferOutput<typeof createItemLookSchema>

/**
 * `PATCH …/admin/item-looks/{id}`: the whole look again, at the version read, **without its kind**:
 * the pieces saved with it are of that kind, so another kind is another look.
 */
export const updateItemLookSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  ...itemLookFields,
})
export type UpdateItemLookInput = v.InferOutput<typeof updateItemLookSchema>

/** One of the cafe's chair and fixture looks, as `GET …/admin/item-looks` lists them by name. */
export interface CustomItemLook extends ItemLook {
  photo: LookPhoto | null
  version: number
  /** How many placed pieces use it, in every branch's saved layout. It can't be deleted while any does. */
  pieces: number
}

/**
 * A saved group (plan Phase 5): pieces and walls saved under a name for the whole cafe, placed
 * again on any floor of any branch as new copies. Positions are around the group's middle. Tables
 * are never in one: each has its own QR code.
 */
export const MAX_LAYOUT_GROUPS = 50
export const LAYOUT_GROUP_NAME_MAX = 40
export const createLayoutGroupSchema = v.pipe(
  v.strictObject({
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(LAYOUT_GROUP_NAME_MAX)),
    items: v.pipe(v.array(itemSchema), v.maxLength(LAYOUT_MAX_ITEMS_PER_FLOOR)),
    walls: v.pipe(v.array(wallSchema), v.maxLength(LAYOUT_MAX_WALLS_PER_FLOOR)),
  }),
  v.check(group => group.items.length + group.walls.length > 0, 'Select pieces or walls to save'),
  v.check(group => unique([...group.items.map(item => item.id), ...group.walls.map(wall => wall.id)]), 'Item ids repeat'),
  v.check(group => jsonBytes({ items: group.items, walls: group.walls }) <= LAYOUT_MAX_FLOOR_BYTES, 'This group holds too much'),
)
export type CreateLayoutGroupInput = v.InferOutput<typeof createLayoutGroupSchema>

/** `GET …/layout-groups`: the cafe's saved groups by name. */
export interface LayoutGroup {
  id: string
  name: string
  items: LayoutItem[]
  walls: Wall[]
  version: number
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

/**
 * Whether an outline is a simple polygon (ISS-039): no side crosses or touches a side that is not
 * next to it, and no side folds back over the one before. A zero-length side (two equal corners in
 * a row) is ignored, as the editor keeps them. Whole centimetres, so the test is exact.
 */
export function isSimpleOutline(outline: readonly Point[]): boolean {
  const points = outline.filter((point, index) => {
    const next = outline[(index + 1) % outline.length]!
    return point.x !== next.x || point.y !== next.y
  })
  const count = points.length
  if (count < 3) return true
  const at = (index: number) => points[(index + count) % count]!
  for (let first = 0; first < count; first++) {
    // The side after this one shares a corner: it may only fold back onto it, never cross it.
    const [a, b, c] = [at(first), at(first + 1), at(first + 2)]
    if (turn(a, b, c) === 0 && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return false
    for (let second = first + 2; second < count; second++) {
      if (first === 0 && second === count - 1) continue
      if (segmentsMeet(at(first), at(first + 1), at(second), at(second + 1))) return false
    }
  }
  return true
}

/** Which way a → b → c turns: 1 or −1, 0 when they lie on one line. */
function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return Math.min(a.x, b.x) <= point.x && point.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= point.y && point.y <= Math.max(a.y, b.y)
}

/** Whether segments a–b and c–d share any point, touching included. */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const [abc, abd, cda, cdb] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)]
  if (abc * abd < 0 && cda * cdb < 0) return true
  return (abc === 0 && onSegment(a, b, c)) || (abd === 0 && onSegment(a, b, d)) || (cda === 0 && onSegment(c, d, a)) || (cdb === 0 && onSegment(c, d, b))
}

function openingsFit(edge: { openings: readonly Opening[] }, length: number): boolean {
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

// --- Contract v1 → v2 (D282) ---

/** An outline edge before contract v2: its outer wall (or railing, or nothing), with its doors and windows. */
export interface EdgeV1 {
  kind: 'wall' | 'railing' | 'open'
  openings: Opening[]
}

/** A floor as saved before contract v2: one outline whose edges are its outer walls. */
export type FloorV1 = Omit<Floor, 'slabs'> & { outline: Point[], edges: EdgeV1[] }
export type ShopLayoutV1 = Omit<ShopLayout, 'floors'> & { floors: FloorV1[] }

/** A floor written the v1 way (starters, fixtures), in v2. */
export function floorFromV1(floor: FloorV1): Floor {
  return upgradeFloor<unknown>(floor) as Floor
}

/** A layout written the v1 way (starters, fixtures), in v2. */
export function fromV1(layout: ShopLayoutV1): ShopLayout {
  return { ...layout, floors: layout.floors.map(floorFromV1) }
}

/** An outer wall's thickness before v2, and a railing's (it stood 3 cm outside the outline). */
const V1_OUTER_WALL_CM = 20
const V1_RAILING_CM = 6

/**
 * A floor in contract v2 (D282), whatever version it was saved in. A v1 floor's outline becomes its
 * one slab (none when it had no outline yet), each edge that was a wall or a railing a wall standing
 * outside the outline with its doors and windows, and its inside walls stay, after them. New ids are
 * made from the floor's id, so reading the same floor again gives the same ones. Anything that is
 * not a v1 floor comes back as it was, for the schema to check.
 */
export function upgradeFloor<T>(floor: T): T {
  if (!isFloorV1(floor)) return floor
  const { outline, edges, walls, ...rest } = floor
  const tag = shortHash(floor.id)
  const clockwise = signedArea(outline) >= 0
  const outer: Wall[] = outline.length >= 3
    ? edges.flatMap((edge, index): Wall[] => {
        if (edge.kind === 'open') return []
        const from = outline[index]!
        const to = outline[(index + 1) % outline.length]!
        return [{
          id: `e${index}-${tag}`,
          from: { ...from },
          to: { ...to },
          ...(edge.kind === 'railing' && { kind: 'railing' as const }),
          ...(edge.openings.length && { openings: edge.openings.map(opening => ({ ...opening })) }),
          // Outside the floor: on the screen's left of a clockwise outline's edges, its right otherwise.
          side: clockwise ? 'left' : 'right',
          thickness: edge.kind === 'railing' ? V1_RAILING_CM : V1_OUTER_WALL_CM,
        }]
      })
    : []
  return {
    ...rest,
    slabs: outline.length >= 3 ? [{ id: `s-${tag}`, outline: outline.map(point => ({ ...point })) }] : [],
    walls: [...outer, ...walls],
  } as T
}

/** A whole layout in contract v2 (D282): each floor upgraded. Anything else comes back as it was. */
export function upgradeLayout<T>(layout: T): T {
  if (!layout || typeof layout !== 'object' || !Array.isArray((layout as { floors?: unknown }).floors)) return layout
  return { ...layout, floors: (layout as unknown as { floors: unknown[] }).floors.map(upgradeFloor) }
}

function isFloorV1(floor: unknown): floor is FloorV1 {
  if (!floor || typeof floor !== 'object') return false
  const candidate = floor as Partial<FloorV1> & { slabs?: unknown }
  return candidate.slabs === undefined && Array.isArray(candidate.outline) && Array.isArray(candidate.edges) && typeof candidate.id === 'string'
    && Array.isArray(candidate.walls) && candidate.edges.length === candidate.outline.length
}

/** FNV-1a, base 36: a short, stable tag for ids made from another id. */
function shortHash(text: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
