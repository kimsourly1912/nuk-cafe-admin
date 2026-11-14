import { SHAPE_ARC } from '#shared/contracts/shop-layout'

/**
 * Shapes (D278) drawn on the plan: the name's size inside the shape (ED-09).
 */

/** A shape name's largest and smallest font size, in plan centimetres. */
const LABEL_MAX_CM = 22
const LABEL_MIN_CM = 4
/** About how wide a character of the plan's font is, for its size. */
const CHAR_WIDTH = 0.6

/**
 * The font size that fits `text` inside a shape (ED-09): within 85 % of its width (70 % for a round
 * one, whose middle is narrower than its box) and a third of its depth. Null when even the smallest
 * size would not fit: the name stays in Layers and Properties.
 */
export function shapeLabelSize(text: string, width: number, depth: number, round: boolean): number | null {
  const room = width * (round ? 0.7 : 0.85)
  const size = Math.min(LABEL_MAX_CM, depth / 3, room / (Math.max(1, text.length) * CHAR_WIDTH))
  return size >= LABEL_MIN_CM ? size : null
}

/** What the shape drawings below read from a piece. */
export interface ShapeFields {
  kind: string
  width: number
  depth: number
  radius?: number
  arcStart?: number
  arcSweep?: number
  arcInner?: number
  /** A polygon shape's corners, in thousandths of its width and depth (plan Phase 4). */
  points?: readonly { x: number, y: number }[]
}

/** A round shape's arc (ED-06), filled in: start and sweep in degrees, inner as a 0–0.95 ratio. */
export interface ShapeArc {
  start: number
  sweep: number
  inner: number
}

export function arcOf(shape: ShapeFields): ShapeArc {
  return { start: shape.arcStart ?? 0, sweep: shape.arcSweep ?? 360, inner: (shape.arcInner ?? 0) / 100 }
}

/** The largest corner radius a rectangle of this size takes (ED-05). */
export const maxRadius = (width: number, depth: number) => Math.floor(Math.min(width, depth) / 2)

/** The radius kept within the shape after a resize (ED-05): none once it rounds down to nothing. */
export function fittedRadius(radius: number | undefined, width: number, depth: number): number | undefined {
  if (!radius) return undefined
  const fitted = Math.min(radius, maxRadius(width, depth))
  return fitted >= 1 ? fitted : undefined
}

/** A point on the shape's ellipse at `degrees` clockwise from the right (the plan's y is down). */
function onEllipse(rx: number, ry: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return { x: rx * Math.cos(radians), y: ry * Math.sin(radians) }
}

function arcPoints(rx: number, ry: number, start: number, sweep: number) {
  const steps = Math.max(2, Math.ceil(sweep / 6))
  return Array.from({ length: steps + 1 }, (_, index) => onEllipse(rx, ry, start + (sweep * index) / steps))
}

/**
 * The outline of a shape that a plain rectangle or ellipse can't draw, around its middle: a
 * rounded rectangle (ED-05), or a round shape's sector, ring or ring segment (ED-06). `hole` is a
 * whole ring's inside. Null for a plain shape. The plan and 3D draw the same points.
 */
export function shapeOutline(shape: ShapeFields): { outer: { x: number, y: number }[], hole: { x: number, y: number }[] | null } | null {
  const rx = shape.width / 2
  const ry = shape.depth / 2
  if (shape.kind === 'block') {
    const radius = fittedRadius(shape.radius, shape.width, shape.depth)
    if (!radius) return null
    const corner = (cx: number, cy: number, from: number) => Array.from({ length: 7 }, (_, index) => {
      const point = onEllipse(radius, radius, from + index * 15)
      return { x: cx + point.x, y: cy + point.y }
    })
    return {
      outer: [...corner(rx - radius, ry - radius, 0), ...corner(-rx + radius, ry - radius, 90), ...corner(-rx + radius, -ry + radius, 180), ...corner(rx - radius, -ry + radius, 270)],
      hole: null,
    }
  }
  // A polygon (plan Phase 4): its corners stretched to its size.
  if (shape.kind === 'block-poly') return shape.points ? { outer: shape.points.map(point => ({ x: point.x / 1000 * shape.width, y: point.y / 1000 * shape.depth })), hole: null } : null
  if (shape.kind !== 'block-round') return null
  const { start, sweep, inner } = arcOf(shape)
  if (sweep >= 360 && !inner) return null
  if (sweep >= 360) return { outer: arcPoints(rx, ry, 0, 360).slice(0, -1), hole: arcPoints(rx * inner, ry * inner, 0, 360).slice(0, -1).reverse() }
  const outer = arcPoints(rx, ry, start, sweep)
  const back = inner ? arcPoints(rx * inner, ry * inner, start, sweep).reverse() : [{ x: 0, y: 0 }]
  return { outer: [...outer, ...back], hole: null }
}

/** An SVG path for `shapeOutline`, the hole drawn the other way round (evenodd). */
export function shapePath(outline: NonNullable<ReturnType<typeof shapeOutline>>): string {
  const ring = (list: { x: number, y: number }[]) => `M${list.map(point => `${round2(point.x)} ${round2(point.y)}`).join('L')}Z`
  return ring(outline.outer) + (outline.hole ? ring(outline.hole) : '')
}
const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * A corner's radius dot dragged (ED-05, Figma's): `local` is the pointer in the shape's own
 * coordinates; the radius is how far it is in from that corner, along both sides, in whole cm.
 */
export function radiusFromDrag(local: { x: number, y: number }, width: number, depth: number): number {
  const inX = width / 2 - Math.abs(local.x)
  const inY = depth / 2 - Math.abs(local.y)
  return Math.max(0, Math.min(maxRadius(width, depth), Math.round((Math.max(0, inX) + Math.max(0, inY)) / 2)))
}

/** Where a corner's radius dot sits (ED-05): in from the corner by the radius, at least `min`. */
export function radiusDot(corner: number, width: number, depth: number, radius: number, min: number) {
  const inset = Math.min(Math.max(radius, min), maxRadius(width, depth))
  const sx = corner === 1 || corner === 2 ? 1 : -1
  const sy = corner >= 2 ? 1 : -1
  return { x: sx * (width / 2 - inset), y: sy * (depth / 2 - inset) }
}

/** The angle of `local` on the shape's ellipse, in whole degrees 0–359 clockwise from the right. */
export function ellipseAngle(local: { x: number, y: number }, width: number, depth: number): number {
  const degrees = Math.round((Math.atan2(local.y / (depth / 2), local.x / (width / 2)) * 180) / Math.PI)
  return ((degrees % 360) + 360) % 360
}

/** How far out `local` is on the shape's ellipse: 0 at the middle, 1 on the edge. */
export function ellipseReach(local: { x: number, y: number }, width: number, depth: number): number {
  return Math.hypot(local.x / (width / 2), local.y / (depth / 2))
}

/** Which arc dot (ED-06): Figma's Arc (the sweep's end), Start and Ratio. */
export type ArcHandle = 'sweep' | 'start' | 'ratio'

/** What an arc handle's drag stores (ED-06): undefined where it is back to the default. */
export interface ArcChange {
  arcStart?: number | undefined
  arcSweep?: number | undefined
  arcInner?: number | undefined
}

/** A shape's own settings changed from its dots or Properties (ED-05 to ED-07); undefined clears one. */
export interface ShapeEdit extends ArcChange {
  radius?: number | undefined
  flipX?: true | undefined
  flipY?: true | undefined
}

/**
 * An arc handle dragged (ED-06, Figma's Arc, Start and Ratio): `sweep` moves the end and keeps the
 * start, `start` turns the opening and keeps the sweep, `ratio` sets the hole's size. Whole degrees
 * and percent; a full sweep, a 0° start and no hole are left out.
 */
export function arcFromDrag(handle: ArcHandle, local: { x: number, y: number }, shape: ShapeFields): ArcChange {
  const arc = arcOf(shape)
  const angle = ellipseAngle(local, shape.width, shape.depth)
  const keep = { arcStart: shape.arcStart, arcSweep: shape.arcSweep, arcInner: shape.arcInner }
  if (handle === 'start') return { ...keep, arcStart: angle || undefined }
  if (handle === 'sweep') {
    // From the sweep it has now, by the shortest turn to the pointer: a drag back from a whole
    // circle opens a wedge, and the end never jumps across the start.
    const turn = ((((angle - arc.start - arc.sweep) % 360) + 540) % 360) - 180
    const sweep = Math.round(Math.min(360, Math.max(SHAPE_ARC.sweepMin, arc.sweep + turn)))
    return { ...keep, arcSweep: sweep > SHAPE_ARC.sweepMax ? undefined : sweep }
  }
  const inner = Math.min(SHAPE_ARC.innerMax, Math.round(ellipseReach(local, shape.width, shape.depth) * 100))
  return { ...keep, arcInner: inner >= 1 ? inner : undefined }
}

/** Where the arc handles sit (ED-06), in the shape's own coordinates. */
export function arcHandles(shape: ShapeFields) {
  const { start, sweep, inner } = arcOf(shape)
  const rx = shape.width / 2
  const ry = shape.depth / 2
  const middle = start + sweep / 2
  return {
    // Figma's arc dot sits on the right edge while the circle is whole.
    sweep: onEllipse(rx * 0.92, ry * 0.92, sweep >= 360 ? start : start + sweep),
    // The start dot only once there is an opening to turn.
    start: sweep >= 360 ? null : onEllipse(rx * 0.92, ry * 0.92, start),
    ratio: onEllipse(rx * Math.max(inner, 0.12), ry * Math.max(inner, 0.12), sweep >= 360 ? 0 : middle),
  }
}

/**
 * A polygon shape from corners drawn on the plan (plan Phase 4): its middle, size and corners in
 * thousandths of that size, as the contract stores them. Null for fewer than 3 corners or no area.
 */
export function polygonShape(corners: readonly { x: number, y: number }[]): { x: number, y: number, width: number, depth: number, points: { x: number, y: number }[] } | null {
  if (corners.length < 3) return null
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const width = Math.round(maxX - minX)
  const depth = Math.round(maxY - minY)
  if (width < 1 || depth < 1) return null
  const x = Math.round((minX + maxX) / 2)
  const y = Math.round((minY + maxY) / 2)
  const clamp = (value: number) => Math.max(-500, Math.min(500, Math.round(value)))
  return { x, y, width, depth, points: corners.map(point => ({ x: clamp((point.x - x) / width * 1000), y: clamp((point.y - y) / depth * 1000) })) }
}
