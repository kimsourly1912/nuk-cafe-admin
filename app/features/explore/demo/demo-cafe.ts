import { fromV1 } from '#shared/contracts/shop-layout'
import type { LayoutTable, ShopLayout } from '#shared/contracts/shop-layout'

/**
 * Explore's demo café (step E1, D275): a two-floor shophouse to walk through before real branches
 * join in step E4. A front door with the counter facing it, tables with chairs, a sofa corner and
 * stairs to the first floor. Nothing here is a real table or branch.
 */

export const DEMO_CAFE_NAME = 'Demo café'
/** The demo street's place id in the world: it isn't a branch, and has no gateways. */
export const DEMO_PLACE = 'demo'
/** The surroundings' seed: the same street every visit. */
export const DEMO_SEED = 'explore-demo'

export const DEMO_TABLES: LayoutTable[] = [
  { id: 'demo-e1', label: 'E1', seats: 2 },
  { id: 'demo-e2', label: 'E2', seats: 2 },
  { id: 'demo-e3', label: 'E3', seats: 4 },
  { id: 'demo-e4', label: 'E4', seats: 4 },
  { id: 'demo-e5', label: 'E5', seats: 2 },
  { id: 'demo-e6', label: 'E6', seats: 4 },
]

const OUTLINE = [
  { x: 0, y: 0 },
  { x: 800, y: 0 },
  { x: 800, y: 1200 },
  { x: 0, y: 1200 },
]

export function demoCafe(): ShopLayout {
  // Written as an outline with edges (before contract v2, D282), as the starters are.
  return fromV1({
    floors: [
      {
        id: 'ground',
        name: 'Ground',
        height: 320,
        hasRoof: true,
        outline: OUTLINE.map(point => ({ ...point })),
        edges: [
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'side-window', kind: 'window', offset: 500, width: 240 }] },
          // The street front, from the right corner leftwards: a window, the door, a window.
          { kind: 'wall', openings: [{ id: 'front-window-right', kind: 'window', offset: 40, width: 220 }, { id: 'front-door', kind: 'door', offset: 330, width: 140 }, { id: 'front-window-left', kind: 'window', offset: 540, width: 220 }] },
          { kind: 'wall', openings: [] },
        ],
        walls: [],
        items: [
          { id: 'counter', kind: 'service-counter', x: 560, y: 180, rotation: 0, width: 320, depth: 70, finishes: {} },
          { id: 'back-shelf', kind: 'display-shelf', x: 560, y: 30, rotation: 0, width: 200, depth: 40, finishes: {} },
          { id: 'stairs', kind: 'stairs', x: 80, y: 260, rotation: 0, width: 110, depth: 340, finishes: {} },
          { id: 'sofa', kind: 'sofa', x: 50, y: 760, rotation: 270, width: 180, depth: 88, finishes: {} },
          { id: 'coffee-table', kind: 'coffee-table', x: 175, y: 760, rotation: 90, width: 100, depth: 60, finishes: {} },
          { id: 'armchair', kind: 'armchair', x: 300, y: 760, rotation: 90, width: 76, depth: 80, finishes: {} },
          { id: 'plant-left', kind: 'plant', x: 40, y: 1155, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'plant-right', kind: 'plant', x: 760, y: 1155, rotation: 0, width: 50, depth: 50, finishes: { pot: 'limestone' } },
        ],
      },
      {
        id: 'first',
        name: 'First',
        height: 300,
        hasRoof: true,
        outline: OUTLINE.map(point => ({ ...point })),
        edges: [
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'first-window-side', kind: 'window', offset: 400, width: 300 }] },
          { kind: 'wall', openings: [{ id: 'first-window-front', kind: 'window', offset: 120, width: 560 }] },
          { kind: 'wall', openings: [] },
        ],
        walls: [],
        items: [
          { id: 'first-plant', kind: 'plant', x: 760, y: 40, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'first-shelf', kind: 'display-shelf', x: 500, y: 25, rotation: 0, width: 160, depth: 40, finishes: { frame: 'walnut' } },
        ],
      },
    ],
    placements: [
      { tableId: 'demo-e1', floorId: 'ground', x: 190, y: 1010, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' },
      { tableId: 'demo-e2', floorId: 'ground', x: 670, y: 1010, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' },
      { tableId: 'demo-e3', floorId: 'ground', x: 670, y: 620, rotation: 90, width: 120, depth: 80, lookId: 'oak-rectangle' },
      { tableId: 'demo-e4', floorId: 'ground', x: 300, y: 480, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
      { tableId: 'demo-e5', floorId: 'first', x: 560, y: 360, rotation: 0, width: 70, depth: 70, lookId: 'square-bistro' },
      { tableId: 'demo-e6', floorId: 'first', x: 450, y: 820, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
    ],
  })
}
