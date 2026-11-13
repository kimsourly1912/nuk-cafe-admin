import type { Point } from '#shared/contracts/shop-layout'

/**
 * Where a selected piece's handles go, in its own unturned coordinates (plan centimetres, centre
 * at 0, 0), like Figma's (ED-01 to ED-03): a corner resizes, a side resizes one way, and just
 * outside a corner turns it. Sizes are kept in screen pixels, so they look the same at any zoom.
 *
 * A piece big enough on screen gets corner targets centred on its corners and side strips between
 * them. A small one keeps its middle for moving: its corner targets sit outside the corners and it
 * has no side strips. A tiny one (a dot on screen) only moves and turns.
 */

/** The drawn square of a handle. */
export const HANDLE_MARK_PX = 8
/** A corner's target, centred on the corner. */
const CORNER_HIT_PX = 16
/** A small piece's corner target, outside the corner. */
const SMALL_CORNER_HIT_PX = 12
/** A side's target: a strip this thick along the side, half inside and half outside. */
const SIDE_HIT_PX = 8
/** The turn area outside each corner. */
const ROTATE_ZONE_PX = 20
/** Below this, on screen, a piece's middle stays for moving: corner targets go outside it, no sides. */
export const SMALL_PIECE_PX = 40
/** Below this, on screen, a piece has no resize handles (it would be all handle). */
export const TINY_PIECE_PX = 8

export interface HandleTarget {
  /** The handle's number, as `resizeFromCorner` takes it: 0–3 corners, 4–7 sides. */
  handle: number
  x: number
  y: number
  width: number
  height: number
}

export interface HandleLayout {
  /** Where each corner's square is drawn: none on a tiny piece. */
  marks: Point[]
  /** The drawn square's size, in plan centimetres. */
  markSize: number
  resize: HandleTarget[]
  rotate: { x: number, y: number, size: number }[]
}

/** `width` and `depth` in plan centimetres; `perPixel`: plan centimetres per screen pixel. */
export function handleLayout(width: number, depth: number, perPixel: number, resizable = true): HandleLayout {
  const corners = [
    { x: -width / 2, y: -depth / 2 },
    { x: width / 2, y: -depth / 2 },
    { x: width / 2, y: depth / 2 },
    { x: -width / 2, y: depth / 2 },
  ]
  const shortest = Math.min(width, depth) / perPixel
  const small = shortest < SMALL_PIECE_PX
  const tiny = !resizable || shortest < TINY_PIECE_PX
  const outward = (corner: Point) => ({ x: Math.sign(corner.x) || 1, y: Math.sign(corner.y) || 1 })
  // How far past the corner the resize target reaches: the turn area starts there.
  const reach = (tiny ? 2 : small ? SMALL_CORNER_HIT_PX : CORNER_HIT_PX / 2) * perPixel
  const rotateSize = ROTATE_ZONE_PX * perPixel
  const rotate = corners.map((corner) => {
    const out = outward(corner)
    return { x: out.x > 0 ? corner.x + reach : corner.x - reach - rotateSize, y: out.y > 0 ? corner.y + reach : corner.y - reach - rotateSize, size: rotateSize }
  })
  if (tiny) return { marks: [], markSize: 0, resize: [], rotate }

  const resize: HandleTarget[] = corners.map((corner, handle) => {
    if (!small) {
      const size = CORNER_HIT_PX * perPixel
      return { handle, x: corner.x - size / 2, y: corner.y - size / 2, width: size, height: size }
    }
    const size = SMALL_CORNER_HIT_PX * perPixel
    const out = outward(corner)
    return { handle, x: out.x > 0 ? corner.x : corner.x - size, y: out.y > 0 ? corner.y : corner.y - size, width: size, height: size }
  })
  if (!small) {
    const strip = SIDE_HIT_PX * perPixel
    const inset = (CORNER_HIT_PX / 2) * perPixel
    const across = width - 2 * inset
    const down = depth - 2 * inset
    resize.push(
      { handle: 4, x: -width / 2 + inset, y: -depth / 2 - strip / 2, width: across, height: strip },
      { handle: 5, x: width / 2 - strip / 2, y: -depth / 2 + inset, width: strip, height: down },
      { handle: 6, x: -width / 2 + inset, y: depth / 2 - strip / 2, width: across, height: strip },
      { handle: 7, x: -width / 2 - strip / 2, y: -depth / 2 + inset, width: strip, height: down },
    )
  }
  return { marks: corners, markSize: HANDLE_MARK_PX * perPixel, resize, rotate }
}
