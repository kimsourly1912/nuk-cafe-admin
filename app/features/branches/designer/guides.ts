import type { Point } from '#shared/contracts/shop-layout'
import type { Bounds } from './geometry'

/**
 * Smart guides and measurements (D278, Figma's): while a piece is dragged its bounds snap to the
 * left, middle or right (top, middle or bottom) of the pieces around it and of the floor's corners,
 * and a line shows what it lines up with; holding Alt shows the gaps to a hovered piece, or to the
 * walls around it. Pure functions in plan centimetres.
 */

/** A guide line: `axis` x is a vertical line at x = `at`, from y = `from` to y = `to`. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/** A measured gap, drawn as a line with its length. */
export interface Gap {
  from: Point
  to: Point
  length: number
}

const lines = (bounds: Bounds, axis: 'x' | 'y') => axis === 'x'
  ? [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX]
  : [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY]

/**
 * How far to shift `moving` so one of its lines meets a target's nearest line, per axis, if one is
 * within `threshold`; and the guides to draw after the shift.
 */
export function snapToGuides(moving: Bounds, targets: readonly Bounds[], threshold: number): { dx: number, dy: number, guides: Guide[] } {
  const shift = { x: 0, y: 0 }
  for (const axis of ['x', 'y'] as const) {
    let best: number | null = null
    for (const target of targets) {
      for (const line of lines(target, axis)) {
        for (const own of lines(moving, axis)) {
          const difference = line - own
          if (Math.abs(difference) <= threshold && (best === null || Math.abs(difference) < Math.abs(best))) best = difference
        }
      }
    }
    if (best !== null) shift[axis] = best
  }
  const moved: Bounds = { minX: moving.minX + shift.x, maxX: moving.maxX + shift.x, minY: moving.minY + shift.y, maxY: moving.maxY + shift.y }
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    if (!targets.length) continue
    const other = axis === 'x' ? 'y' : 'x'
    for (const own of lines(moved, axis)) {
      const matching = targets.filter(target => lines(target, axis).some(line => Math.abs(line - own) < 0.5))
      if (!matching.length) continue
      const spans = [moved, ...matching].map(bounds => lines(bounds, other))
      guides.push({ axis, at: own, from: Math.min(...spans.map(span => span[0]!)), to: Math.max(...spans.map(span => span[2]!)) })
    }
  }
  return { dx: shift.x, dy: shift.y, guides }
}

/** A floor's corners as zero-size bounds, so pieces line up with its walls' corners too. */
export const cornerBounds = (outline: readonly Point[]): Bounds[] => outline.map(point => ({ minX: point.x, maxX: point.x, minY: point.y, maxY: point.y }))

/**
 * The gaps between two pieces' bounds: across when they are side by side, down when one is above
 * the other; from each side to the other's when one is inside the other. None when they overlap.
 */
export function gapsBetween(a: Bounds, b: Bounds): Gap[] {
  const gaps: Gap[] = []
  const middle = (low: number, high: number) => (low + high) / 2
  const overlapY = { low: Math.max(a.minY, b.minY), high: Math.min(a.maxY, b.maxY) }
  const overlapX = { low: Math.max(a.minX, b.minX), high: Math.min(a.maxX, b.maxX) }
  const y = overlapY.low <= overlapY.high ? middle(overlapY.low, overlapY.high) : middle(a.minY, a.maxY)
  const x = overlapX.low <= overlapX.high ? middle(overlapX.low, overlapX.high) : middle(a.minX, a.maxX)
  const add = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length > 0.5) gaps.push({ from, to, length })
  }
  const inside = (inner: Bounds, outer: Bounds) => inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY
  if (inside(a, b) || inside(b, a)) {
    const [inner, outer] = inside(a, b) ? [a, b] : [b, a]
    const cy = middle(inner.minY, inner.maxY)
    const cx = middle(inner.minX, inner.maxX)
    add({ x: outer.minX, y: cy }, { x: inner.minX, y: cy })
    add({ x: inner.maxX, y: cy }, { x: outer.maxX, y: cy })
    add({ x: cx, y: outer.minY }, { x: cx, y: inner.minY })
    add({ x: cx, y: inner.maxY }, { x: cx, y: outer.maxY })
    return gaps
  }
  if (a.maxX <= b.minX) add({ x: a.maxX, y }, { x: b.minX, y })
  else if (b.maxX <= a.minX) add({ x: b.maxX, y }, { x: a.minX, y })
  if (a.maxY <= b.minY) add({ x, y: a.maxY }, { x, y: b.minY })
  else if (b.maxY <= a.minY) add({ x, y: b.maxY }, { x, y: a.minY })
  return gaps
}

/**
 * From each side of `box`, straight out to the floor's outline: how far the piece is from the
 * walls around it (left, right, up and down). Only for a piece inside the floor.
 */
export function distancesToOutline(box: Bounds, outline: readonly Point[]): Gap[] {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const gaps: Gap[] = []
  const rays: { start: Point, direction: Point }[] = [
    { start: { x: box.minX, y: cy }, direction: { x: -1, y: 0 } },
    { start: { x: box.maxX, y: cy }, direction: { x: 1, y: 0 } },
    { start: { x: cx, y: box.minY }, direction: { x: 0, y: -1 } },
    { start: { x: cx, y: box.maxY }, direction: { x: 0, y: 1 } },
  ]
  for (const { start, direction } of rays) {
    let nearest = Number.POSITIVE_INFINITY
    outline.forEach((from, index) => {
      const to = outline[(index + 1) % outline.length]!
      const hit = crossing(start, direction, from, to)
      if (hit !== null && hit < nearest) nearest = hit
    })
    if (Number.isFinite(nearest) && nearest > 0.5) gaps.push({ from: start, to: { x: start.x + direction.x * nearest, y: start.y + direction.y * nearest }, length: nearest })
  }
  return gaps
}

/** How far along an axis-aligned ray it meets the segment, or null. */
function crossing(start: Point, direction: Point, from: Point, to: Point): number | null {
  if (direction.x !== 0) {
    if ((from.y - start.y) * (to.y - start.y) > 0 || from.y === to.y) return null
    const x = from.x + ((start.y - from.y) / (to.y - from.y)) * (to.x - from.x)
    const distance = (x - start.x) * direction.x
    return distance >= 0 ? distance : null
  }
  if ((from.x - start.x) * (to.x - start.x) > 0 || from.x === to.x) return null
  const y = from.y + ((start.x - from.x) / (to.x - from.x)) * (to.y - from.y)
  const distance = (y - start.y) * direction.y
  return distance >= 0 ? distance : null
}

/** Whether a wall from `from` to `to` touches the box (a box selection picks walls it crosses). */
export function segmentTouches(box: Bounds, from: Point, to: Point): boolean {
  // Liang–Barsky: clip the segment to the box; it touches when something is left.
  let low = 0
  let high = 1
  const dx = to.x - from.x
  const dy = to.y - from.y
  const edges: [number, number][] = [[-dx, from.x - box.minX], [dx, box.maxX - from.x], [-dy, from.y - box.minY], [dy, box.maxY - from.y]]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) low = Math.max(low, t)
    else high = Math.min(high, t)
    if (low > high) return false
  }
  return true
}
