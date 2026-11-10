import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { LAYOUT_MAX_FLOORS } from '#shared/contracts/shop-layout'
import { newLayoutId } from './geometry'

/**
 * Where a branch's layout starts (D273, frame 6C), and new floors. A starter only draws outlines,
 * doors, windows, stairs and a counter: it never creates or places tables (the branch's tables
 * wait in Unplaced tables).
 */

export const FLOOR_HEIGHT_DEFAULT_CM = 300

/** A floor's name by its position: the ground floor, then First, Second… */
const FLOOR_NAMES = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'] as const

export type StarterId = 'blank' | 'shophouse' | 'wide' | 'rooftop'

export interface Starter {
  id: StarterId
  name: string
  description: string
  layout: () => ShopLayout
}

const wall = () => ({ kind: 'wall' as const, openings: [] })

export const STARTERS: Starter[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Draw your own outline',
    // No corners yet: the editor opens Draw outline on it.
    layout: () => ({ floors: [{ id: 'ground', name: 'Ground', height: FLOOR_HEIGHT_DEFAULT_CM, hasRoof: true, outline: [], edges: [], walls: [], items: [] }], placements: [] }),
  },
  {
    id: 'shophouse',
    name: 'Narrow shophouse',
    description: '4 × 15 m · stairs at the back',
    layout: () => ({
      floors: [{
        id: 'ground',
        name: 'Ground',
        height: 320,
        hasRoof: true,
        outline: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 1500 }, { x: 0, y: 1500 }],
        // Back, right, front (from the right-hand corner), left.
        edges: [wall(), wall(), { kind: 'wall', openings: [{ id: 'front-window', kind: 'window', offset: 25, width: 150 }, { id: 'front-door', kind: 'door', offset: 250, width: 100 }] }, wall()],
        walls: [],
        items: [{ id: 'stairs', kind: 'stairs', x: 325, y: 195, rotation: 0, width: 100, depth: 340, finishes: {} }],
      }],
      placements: [],
    }),
  },
  {
    id: 'wide',
    name: 'Wide café',
    description: '12 × 7 m · long shop window',
    layout: () => ({
      floors: [{
        id: 'ground',
        name: 'Ground',
        height: 320,
        hasRoof: true,
        outline: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 700 }, { x: 0, y: 700 }],
        edges: [wall(), wall(), { kind: 'wall', openings: [{ id: 'front-door', kind: 'door', offset: 150, width: 100 }, { id: 'shop-window', kind: 'window', offset: 350, width: 700 }] }, wall()],
        walls: [],
        items: [{ id: 'counter', kind: 'service-counter', x: 900, y: 70, rotation: 0, width: 320, depth: 70, finishes: {} }],
      }],
      placements: [],
    }),
  },
  {
    id: 'rooftop',
    name: 'Rooftop café',
    description: '2 floors · open patio on top',
    layout: () => ({
      floors: [
        {
          id: 'ground',
          name: 'Ground',
          height: 320,
          hasRoof: true,
          outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 0, y: 600 }],
          edges: [wall(), wall(), { kind: 'wall', openings: [{ id: 'ground-window', kind: 'window', offset: 100, width: 400 }, { id: 'front-door', kind: 'door', offset: 650, width: 100 }] }, wall()],
          walls: [],
          items: [{ id: 'ground-stairs', kind: 'stairs', x: 75, y: 195, rotation: 0, width: 100, depth: 340, finishes: {} }],
        },
        {
          id: 'rooftop',
          name: 'Rooftop',
          height: 280,
          hasRoof: false,
          outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 0, y: 600 }],
          edges: [{ kind: 'railing', openings: [] }, { kind: 'railing', openings: [] }, { kind: 'railing', openings: [] }, { kind: 'railing', openings: [] }],
          // The stair kiosk: walls around the stairs, open towards the patio.
          walls: [
            { id: 'kiosk-back', from: { x: 0, y: 0 }, to: { x: 175, y: 0 } },
            { id: 'kiosk-side', from: { x: 175, y: 0 }, to: { x: 175, y: 400 } },
            { id: 'kiosk-front', from: { x: 0, y: 400 }, to: { x: 75, y: 400 } },
            { id: 'kiosk-left', from: { x: 0, y: 0 }, to: { x: 0, y: 400 } },
          ],
          items: [{ id: 'rooftop-planter', kind: 'planter', x: 600, y: 40, rotation: 0, width: 160, depth: 40, finishes: {} }],
        },
      ],
      placements: [],
    }),
  },
]

/** The name a new floor gets at `position` (0 is the ground floor). */
export function floorName(position: number): string {
  return FLOOR_NAMES[position] ?? `Floor ${position}`
}

export function canAddFloor(layout: ShopLayout): boolean {
  return layout.floors.length < LAYOUT_MAX_FLOORS
}

/**
 * A floor on top of the others: the top floor's outline (so the walls line up), every edge a wall
 * without doors or windows, nothing on it.
 */
export function newFloor(layout: ShopLayout): Floor {
  const top = layout.floors.at(-1)
  return {
    id: newLayoutId('floor'),
    name: floorName(layout.floors.length),
    height: FLOOR_HEIGHT_DEFAULT_CM,
    hasRoof: true,
    outline: (top?.outline ?? []).map(point => ({ ...point })),
    edges: (top?.outline ?? []).map(() => ({ kind: 'wall' as const, openings: [] })),
    walls: [],
    items: [],
  }
}
