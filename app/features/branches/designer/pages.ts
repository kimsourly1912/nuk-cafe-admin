import { floorPageId, LAYOUT_MAX_PAGES, layoutPages } from '#shared/contracts/shop-layout'
import type { Floor, LayoutPage, Point, ShopLayout } from '#shared/contracts/shop-layout'
import { boundsOf } from './geometry'

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
export function besideFrames(frames: readonly Pick<Floor, 'outline' | 'canvasX' | 'canvasY'>[], outline: readonly Point[]): Point {
  const placed = frames.filter(frame => frame.outline.length >= 3)
  if (!placed.length) return { x: 0, y: 0 }
  const right = Math.max(...placed.map(frame => (frame.canvasX ?? 0) + boundsOf(frame.outline).maxX))
  const left = outline.length >= 3 ? boundsOf(outline).minX : 0
  const first = placed[0]!
  const top = (first.canvasY ?? 0) + boundsOf(first.outline).minY - (outline.length >= 3 ? boundsOf(outline).minY : 0)
  return { x: Math.round(right + FRAME_GAP_CM - left), y: Math.round(top) }
}

/**
 * Where each floor's frame stands on its page (ISS-036): its saved offset, or, for a floor never
 * placed (saved before frames, all at (0, 0)), beside the frames before it in floor order, so floors
 * don't sit on top of each other. Display only: the editor writes them all out the first time one
 * of them moves, so none jumps.
 */
export function effectiveFrames(floors: readonly Pick<Floor, 'id' | 'outline' | 'canvasX' | 'canvasY'>[]): Record<string, Point> {
  const placed: { outline: Point[], canvasX: number, canvasY: number }[] = []
  const offsets: Record<string, Point> = {}
  for (const floor of floors) {
    const at = floor.canvasX !== undefined || floor.canvasY !== undefined
      ? { x: floor.canvasX ?? 0, y: floor.canvasY ?? 0 }
      : besideFrames(placed, floor.outline)
    offsets[floor.id] = at
    placed.push({ outline: floor.outline, canvasX: at.x, canvasY: at.y })
  }
  return offsets
}
