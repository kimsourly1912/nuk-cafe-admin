import { floorPageId, LAYOUT_MAX_PAGES, layoutPages } from '#shared/contracts/shop-layout'
import type { Floor, LayoutPage, Point, ShopLayout } from '#shared/contracts/shop-layout'
import { boundsOf, floorPoints } from './geometry'

/**
 * Studio's pages (ISS-036, like Figma's): groups of floors by purpose. Each function changes the
 * draft's copy of the layout it is given, inside one `draft.change` (one undo step). A layout with
 * no `pages` has the one default page; adding a page writes the list out, the default first.
 */

/** The floors on a page, in floor order (bottom first). */
export function floorsOnPage(layout: Pick<ShopLayout, 'floors' | 'pages'>, pageId: string): Floor[] {
  const pages = layoutPages(layout)
  return layout.floors.filter(floor => floorPageId(floor, pages) === pageId)
}

/** A new page at the end; false at the limit. */
export function addPage(layout: ShopLayout, page: LayoutPage): boolean {
  const pages = layoutPages(layout)
  if (pages.length >= LAYOUT_MAX_PAGES) return false
  layout.pages = [...pages, page]
  return true
}

export function renamePage(layout: ShopLayout, pageId: string, name: string) {
  layout.pages = layoutPages(layout).map(page => (page.id === pageId ? { ...page, name } : page))
}

/**
 * Removes a page with no floors; false otherwise, and for the last page. A page with floors is
 * never removed with them: their tables would leave the plan.
 */
export function removePage(layout: ShopLayout, pageId: string): boolean {
  const pages = layoutPages(layout)
  if (pages.length <= 1 || floorsOnPage(layout, pageId).length) return false
  const kept = pages.filter(page => page.id !== pageId)
  // Only an empty page goes, so no floor was on it. Floors on the new first page leave their page
  // out, as stored. The list stays written out: a save without pages keeps the saved ones.
  const first = kept[0]!.id
  for (const floor of layout.floors) {
    if (floor.pageId === first) delete floor.pageId
  }
  layout.pages = kept
  return true
}

/** Puts a floor on a page: stored on the floor, left out for the first page. */
export function setFloorPage(layout: ShopLayout, floorId: string, pageId: string) {
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return
  if (layoutPages(layout)[0]?.id === pageId) delete floor.pageId
  else floor.pageId = pageId
}

/** How far apart frames stand when a new one is placed beside the others, in cm. */
export const FRAME_GAP_CM = 400

/**
 * Where a new floor's frame goes on a page (ISS-036): to the right of the frames already there,
 * top-aligned with the first, like Figma placing a new frame beside the others. (0, 0) on an empty page.
 */
export function besideFrames(frames: readonly FramePlace[], points: readonly Point[]): Point {
  const placed = frames.filter(frame => frame.points.length > 0)
  if (!placed.length) return { x: 0, y: 0 }
  const right = Math.max(...placed.map(frame => (frame.canvasX ?? 0) + boundsOf(frame.points).maxX))
  const left = points.length ? boundsOf(points).minX : 0
  const first = placed[0]!
  const top = (first.canvasY ?? 0) + boundsOf(first.points).minY - (points.length ? boundsOf(points).minY : 0)
  return { x: Math.round(right + FRAME_GAP_CM - left), y: Math.round(top) }
}

/** A frame already on the page: its drawing's corners and wall ends (`floorPoints`) and its offset. */
export interface FramePlace {
  points: readonly Point[]
  canvasX?: number
  canvasY?: number
}

/** A floor as a frame to place: its corners and wall ends (D282: an empty floor has none). */
export function framePlace(floor: Pick<Floor, 'slabs' | 'walls' | 'canvasX' | 'canvasY'>): FramePlace {
  return { points: floorPoints(floor), canvasX: floor.canvasX, canvasY: floor.canvasY }
}

/**
 * Where each floor's frame stands on its page (ISS-036): its saved offset, or, for a floor never
 * placed (saved before frames, all at (0, 0)), beside the frames before it in floor order, so floors
 * don't sit on top of each other. Display only: the editor writes them all out the first time one
 * of them moves, so none jumps.
 */
export function effectiveFrames(floors: readonly Pick<Floor, 'id' | 'slabs' | 'walls' | 'canvasX' | 'canvasY'>[]): Record<string, Point> {
  const placed: FramePlace[] = []
  const offsets: Record<string, Point> = {}
  for (const floor of floors) {
    const points = floorPoints(floor)
    const at = floor.canvasX !== undefined || floor.canvasY !== undefined
      ? { x: floor.canvasX ?? 0, y: floor.canvasY ?? 0 }
      : besideFrames(placed, points)
    offsets[floor.id] = at
    placed.push({ points, canvasX: at.x, canvasY: at.y })
  }
  return offsets
}
