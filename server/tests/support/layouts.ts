import type { Floor, LayoutItem, Placement, SaveLayoutInput } from '#shared/contracts/shop-layout'
import { LAYOUT_MAX_CORNERS, LAYOUT_MAX_FLOOR_BYTES, LAYOUT_MAX_FLOORS, LAYOUT_MAX_ITEMS_PER_FLOOR, LAYOUT_MAX_WALLS_PER_FLOOR } from '#shared/contracts/shop-layout'

/**
 * The largest shop layout the contract allows (D273): every floor as close to
 * `LAYOUT_MAX_FLOOR_BYTES` as the per-floor limits reach, with long ids and every finish slot.
 */

export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

const longId = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`.padEnd(40, 'x')

function item(floorId: string, n: number): LayoutItem {
  return {
    id: longId(`${floorId}i`, n),
    kind: 'service-counter',
    x: -3000 + (n % 40) * 150,
    y: -3000 + Math.floor(n / 40) * 150,
    rotation: 359,
    width: 2000,
    depth: 2000,
    finishes: { frame: 'white-marble', seat: 'taupe-stone', top: 'black-stone', base: 'terracotta', accent: 'chocolate', cushion: 'limestone' },
  }
}

/** A 64-corner floor (a circle of 40 m) with doors and windows on every edge, inside walls and furniture. */
export function largestFloor(id: string): Floor {
  const outline = Array.from({ length: LAYOUT_MAX_CORNERS }, (_, i) => {
    const angle = (2 * Math.PI * i) / LAYOUT_MAX_CORNERS
    // `+ 0`: JSON has no negative zero, so a saved -0 reads back as 0.
    return { x: Math.round(4000 * Math.cos(angle)) + 0, y: Math.round(4000 * Math.sin(angle)) + 0 }
  })
  const floor: Floor = {
    id: longId(id, 0),
    name: 'F'.repeat(30),
    height: 800,
    hasRoof: true,
    outline,
    edges: outline.map((_, edge) => ({
      kind: 'wall' as const,
      openings: [0, 1, 2].map(n => ({ id: longId(`${id}o${edge}`, n), kind: n === 1 ? 'window' as const : 'door' as const, offset: n * 125, width: 120 })),
    })),
    walls: Array.from({ length: LAYOUT_MAX_WALLS_PER_FLOOR }, (_, n) => ({ id: longId(`${id}w`, n), from: { x: -2000, y: n * 10 }, to: { x: 2000, y: n * 10 } })),
    items: Array.from({ length: LAYOUT_MAX_ITEMS_PER_FLOOR }, (_, n) => item(id, n)),
  }
  while (jsonBytes(floor) > LAYOUT_MAX_FLOOR_BYTES) floor.items.pop()
  return floor
}

/** Every floor at its largest, every table placed (pass the branch's active tables). */
export function largestLayout(tableIds: string[], version = 0): SaveLayoutInput {
  const floors = Array.from({ length: LAYOUT_MAX_FLOORS }, (_, n) => largestFloor(`f${n}`))
  const placements: Placement[] = tableIds.map((tableId, n) => ({
    tableId,
    floorId: floors[n % floors.length]!.id,
    x: -9999 + n,
    y: 9999 - n,
    rotation: 359,
    width: 600,
    depth: 600,
    lookId: 'oak-rectangle',
  }))
  return { version, layout: { floors, placements } }
}
