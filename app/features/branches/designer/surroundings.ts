import type { Point, ShopLayout } from '#shared/contracts/shop-layout'
import { streetDoor, edgeLength } from '#shared/contracts/shop-layout'
import { findOpening, outwardNormal, pointOnEdge } from './geometry'

/**
 * Where the surroundings go (step 3h, D274, docs/plans/shop-designer-scenes.md): a pure function of
 * the layout and a seed, so everyone who opens the branch sees the same street. No three.js here.
 *
 * Everything is worked out in the café's **front frame**, in centimetres: `n` points out of the
 * front edge (the ground floor's first door, or its longest wall), towards the street; `u` runs
 * along the street. `toPlan` turns a frame point into the plan's coordinates, and `angle` is the
 * plan turn (degrees, clockwise) that points a piece's front (+y) out of the café.
 */

export interface FrontFrame {
  origin: Point
  /** Out of the café, towards the street (the frame's +n). */
  out: Point
  /** Along the street (the frame's +u): the out direction turned 90° anticlockwise on screen. */
  right: Point
  /** The plan turn that points a piece's front out of the café. */
  angle: number
  /** How the front was chosen. */
  from: 'door' | 'longest-wall'
}

/** A rectangle in the front frame. */
export interface Span {
  u0: number
  u1: number
  n0: number
  n1: number
}

export type RoofKind = 'gable' | 'flat'

/** A shophouse beside the café. */
export interface Neighbour extends Span {
  id: string
  side: 'left' | 'right'
  floors: number
  floorHeight: number
  /** Which pastel plaster (an index into the builder's palette). */
  paint: number
  /** Which shutter color. */
  shutters: number
  roof: RoofKind
  /** A balcony with a grille on the first floor. */
  balcony: boolean
  /** A corrugated awning over the shop front. */
  awning: number
}

export type PropKind = 'moto' | 'street-lamp' | 'pole' | 'tree' | 'water-jar' | 'pot' | 'bougainvillea' | 'bowl' | 'crates'

export interface Prop {
  id: string
  kind: PropKind
  u: number
  n: number
  /** Degrees in the frame (0: facing the street). */
  turn: number
}

export interface WalkPath {
  from: { u: number, n: number }
  to: { u: number, n: number }
}

export interface SurroundingsPlan {
  frame: FrontFrame
  /** Every floor of the café, in the frame. */
  building: Span
  /** The diorama's base: everything stands on it. */
  base: Span
  pavement: Span
  lane: Span
  /** The far side of the lane: a low wall with plants, never tall enough to block the view. */
  farSide: Span
  /** The service yard behind the café. */
  yard: Span
  neighbours: Neighbour[]
  props: Prop[]
  /** Where the passer-by walks, back and forth. */
  walk: WalkPath
  /** Where the cat sits at its bowl, facing it. */
  cat: Prop
}

export const LANE = {
  pavement: 150,
  lane: 420,
  farSide: 110,
  yard: 320,
  margin: 70,
  /** Shophouse fronts, like Phnom Penh's: 3.5–5.5 m wide. */
  neighbourWidth: [350, 550] as const,
  floorHeight: 320,
} as const

/** A small deterministic random source from a text seed (FNV-1a, then xorshift). */
export function seededRandom(seed: string): () => number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

/**
 * The café's front: the ground floor's first door, or, without one, its longest wall (any edge if
 * it has no wall). Null when the layout has no drawn floor.
 */
export function frontFrame(layout: Pick<ShopLayout, 'floors' | 'scene'>): FrontFrame | null {
  const ground = layout.floors.find(floor => floor.outline.length >= 3)
  if (!ground) return null
  const door = (ground === layout.floors[0] ? streetDoor(layout.floors, layout.scene?.entrance) : undefined)
    ?? findOpening(ground.edges, 'door')
  let index: number
  let along: number
  if (door) {
    index = door.index
    along = door.opening.offset + door.opening.width / 2
  }
  else {
    const lengths = ground.outline.map((_, edge) => ({ edge, length: edgeLength(ground.outline, edge), wall: ground.edges[edge]?.kind === 'wall' }))
    const walls = lengths.filter(entry => entry.wall)
    const longest = (walls.length ? walls : lengths).reduce((best, entry) => (entry.length > best.length ? entry : best))
    index = longest.edge
    along = longest.length / 2
  }
  const origin = pointOnEdge(ground.outline, index, along)
  const out = outwardNormal(ground.outline, index)
  const angle = (Math.atan2(-out.x, out.y) * 180) / Math.PI
  return { origin, out, right: { x: out.y, y: -out.x }, angle, from: door ? 'door' : 'longest-wall' }
}

/** A frame point in the plan's coordinates. */
export function toPlan(frame: FrontFrame, u: number, n: number): Point {
  return { x: frame.origin.x + frame.right.x * u + frame.out.x * n, y: frame.origin.y + frame.right.y * u + frame.out.y * n }
}

/** A plan point in the frame. */
export function toFrame(frame: FrontFrame, point: Point): { u: number, n: number } {
  const dx = point.x - frame.origin.x
  const dy = point.y - frame.origin.y
  return { u: dx * frame.right.x + dy * frame.right.y, n: dx * frame.out.x + dy * frame.out.y }
}

/**
 * The Neighborhood lane around this layout (D274): a pavement and a lane along the front, one or
 * two shophouses on each side of the café's box, a yard behind, and the small things a Phnom Penh
 * lane has. The café's box covers every floor (an upper floor can overhang), so nothing stands in
 * it; an L-shaped café's empty corner stays open pavement.
 */
export function planLane(layout: Pick<ShopLayout, 'floors' | 'scene'>, seed: string): SurroundingsPlan | null {
  const frame = frontFrame(layout)
  if (!frame) return null
  const random = seededRandom(`lane:${seed}`)
  const between = (min: number, max: number) => Math.round(min + random() * (max - min))
  const points = layout.floors.filter(floor => floor.outline.length >= 3).flatMap(floor => floor.outline).map(point => toFrame(frame, point))
  const building: Span = {
    u0: Math.min(...points.map(point => point.u)),
    u1: Math.max(...points.map(point => point.u)),
    n0: Math.min(...points.map(point => point.n)),
    n1: Math.max(...points.map(point => point.n)),
  }
  const floorCount = layout.floors.filter(floor => floor.outline.length >= 3).length

  // Shophouses: their fronts in line with the café's, as deep as it, one or two a side.
  const neighbours: Neighbour[] = []
  for (const side of ['left', 'right'] as const) {
    const count = random() < 0.5 ? 1 : 2
    let edge = side === 'left' ? building.u0 : building.u1
    for (let index = 0; index < count; index++) {
      const width = between(LANE.neighbourWidth[0], LANE.neighbourWidth[1])
      const span = side === 'left' ? { u0: edge - width, u1: edge } : { u0: edge, u1: edge + width }
      edge = side === 'left' ? span.u0 : span.u1
      neighbours.push({
        id: `${side}-${index}`,
        side,
        ...span,
        n0: building.n0 + between(0, 80),
        n1: building.n1 - between(0, 30),
        floors: Math.max(2, Math.min(4, floorCount + between(-1, 1))),
        floorHeight: LANE.floorHeight,
        paint: between(0, 4),
        shutters: between(0, 2),
        roof: random() < 0.6 ? 'gable' : 'flat',
        balcony: random() < 0.7,
        awning: between(0, 2),
      })
    }
  }
  const u0 = Math.min(building.u0, ...neighbours.map(block => block.u0))
  const u1 = Math.max(building.u1, ...neighbours.map(block => block.u1))
  const pavement: Span = { u0, u1, n0: building.n1, n1: building.n1 + LANE.pavement }
  const lane: Span = { u0, u1, n0: pavement.n1, n1: pavement.n1 + LANE.lane }
  const farSide: Span = { u0, u1, n0: lane.n1, n1: lane.n1 + LANE.farSide }
  const yard: Span = { u0, u1, n0: building.n0 - LANE.yard, n1: building.n0 }
  const base: Span = { u0: u0 - LANE.margin, u1: u1 + LANE.margin, n0: yard.n0 - LANE.margin, n1: farSide.n1 + LANE.margin }

  // The lane's details: a moto parked in front of a neighbour, a lamp and a power pole on the
  // pavement, trees in the yard and across the lane, pots by the shop fronts.
  const props: Prop[] = []
  const add = (kind: PropKind, u: number, n: number, turn = 0) => props.push({ id: `${kind}-${props.length}`, kind, u, n, turn })
  const left = neighbours.find(block => block.id === 'left-0')!
  const right = neighbours.find(block => block.id === 'right-0')!
  add('moto', (left.u0 + left.u1) / 2, pavement.n0 + 75, 90)
  add('street-lamp', right.u0 + 40, pavement.n1 - 25)
  add('pole', u0 + 50, pavement.n1 - 25)
  add('pole', u1 - 50, pavement.n1 - 25)
  for (const block of neighbours) {
    add('pot', block.u0 + 45, block.n1 + 30)
    if (random() < 0.6) add('bougainvillea', block.u1 - 50, block.n1 + 32)
  }
  add('tree', u0 + 140, yard.n0 + 130)
  add('tree', u1 - 170, yard.n0 + 150)
  add('water-jar', (building.u0 + building.u1) / 2 + 60, yard.n0 + 120)
  add('crates', (building.u0 + building.u1) / 2 - 90, yard.n0 + 110, 20)
  for (let u = u0 + 120; u < u1 - 80; u += between(260, 380)) add(random() < 0.5 ? 'tree' : 'pot', u, farSide.n0 + LANE.farSide / 2)

  // The cat at its bowl beside the café's door, the passer-by on the lane's near side.
  const cat: Prop = { id: 'cat', kind: 'bowl', u: Math.min(building.u1 - 30, 85), n: pavement.n0 + 40, turn: -90 }
  const walkN = lane.n0 + 90
  const walk: WalkPath = { from: { u: u0 + 80, n: walkN }, to: { u: u1 - 80, n: walkN } }
  return { frame, building, base, pavement, lane, farSide, yard, neighbours, props, walk, cat }
}

/** Every span of the plan, for bounds and overlap checks. */
export function planSpans(plan: SurroundingsPlan): Span[] {
  return [plan.base, plan.pavement, plan.lane, plan.farSide, plan.yard, ...plan.neighbours]
}
