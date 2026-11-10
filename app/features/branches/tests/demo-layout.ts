import type { LayoutTable, ShopLayout } from '#shared/contracts/shop-layout'

/**
 * A sample layout for the designer's tests (D273; the step 1 prototype's demo): a three-floor
 * shophouse matching the mockups' sample data.
 * Ground: T01–T05, counter, stairs, front door, two windows. First: T06–T08. Rooftop: an open
 * patio with railings, a stair kiosk, T09 and T10. T11 and T12 wait unplaced. Nothing here is a
 * real table.
 */

export const DEMO_TABLES: LayoutTable[] = [
  { id: 'demo-t01', label: 'T01', seats: 2 },
  { id: 'demo-t02', label: 'T02', seats: 2 },
  { id: 'demo-t03', label: 'T03', seats: 4 },
  { id: 'demo-t04', label: 'T04', seats: 4 },
  { id: 'demo-t05', label: 'T05', seats: 4 },
  { id: 'demo-t06', label: 'T06', seats: 4 },
  { id: 'demo-t07', label: 'T07', seats: 2 },
  { id: 'demo-t08', label: 'T08', seats: 2 },
  { id: 'demo-t09', label: 'T09', seats: 2 },
  { id: 'demo-t10', label: 'T10', seats: 4 },
  { id: 'demo-t11', label: 'T11', seats: 4 },
  { id: 'demo-t12', label: 'T12', seats: 2 },
]

/** The ground and first floors' L-shape, clockwise on screen. */
const L_SHAPE = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 500 },
  { x: 600, y: 500 },
  { x: 600, y: 900 },
  { x: 0, y: 900 },
]

export function demoLayout(): ShopLayout {
  return {
    floors: [
      {
        id: 'ground',
        name: 'Ground',
        height: 320,
        hasRoof: true,
        outline: L_SHAPE.map(point => ({ ...point })),
        edges: [
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'g-w1', kind: 'window', offset: 120, width: 260 }] },
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'g-w2', kind: 'window', offset: 40, width: 180 }, { id: 'g-d1', kind: 'door', offset: 280, width: 100 }] },
          { kind: 'wall', openings: [] },
        ],
        walls: [],
        items: [
          { id: 'g-counter', kind: 'service-counter', x: 800, y: 70, rotation: 0, width: 320, depth: 70, finishes: {} },
          { id: 'g-stairs', kind: 'stairs', x: 75, y: 200, rotation: 0, width: 110, depth: 340, finishes: {} },
          { id: 'g-plant1', kind: 'plant', x: 60, y: 840, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'g-plant2', kind: 'plant', x: 545, y: 840, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'g-plant3', kind: 'plant', x: 945, y: 445, rotation: 0, width: 50, depth: 50, finishes: { pot: 'limestone' } },
          { id: 'g-shelf', kind: 'display-shelf', x: 540, y: 30, rotation: 0, width: 120, depth: 40, finishes: {} },
        ],
      },
      {
        id: 'first',
        name: 'First',
        height: 300,
        hasRoof: true,
        outline: L_SHAPE.map(point => ({ ...point })),
        edges: [
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'f-w1', kind: 'window', offset: 100, width: 300 }] },
          { kind: 'wall', openings: [{ id: 'f-w2', kind: 'window', offset: 80, width: 240 }] },
          { kind: 'wall', openings: [] },
          { kind: 'wall', openings: [{ id: 'f-w3', kind: 'window', offset: 60, width: 480 }] },
          { kind: 'wall', openings: [{ id: 'f-w4', kind: 'window', offset: 120, width: 200 }] },
        ],
        walls: [],
        items: [
          { id: 'f-stairs', kind: 'stairs', x: 75, y: 200, rotation: 0, width: 110, depth: 340, finishes: {} },
          { id: 'f-shelf', kind: 'display-shelf', x: 880, y: 30, rotation: 0, width: 160, depth: 40, finishes: { frame: 'walnut' } },
          { id: 'f-plant1', kind: 'plant', x: 945, y: 445, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'f-plant2', kind: 'plant', x: 60, y: 840, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'f-plant3', kind: 'plant', x: 545, y: 560, rotation: 0, width: 50, depth: 50, finishes: { pot: 'limestone' } },
          { id: 'f-divider', kind: 'room-divider', x: 300, y: 600, rotation: 90, width: 160, depth: 20, finishes: {} },
        ],
      },
      {
        id: 'rooftop',
        name: 'Rooftop',
        height: 280,
        hasRoof: false,
        outline: [
          { x: 0, y: 0 },
          { x: 220, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 500 },
          { x: 600, y: 500 },
          { x: 600, y: 900 },
          { x: 0, y: 900 },
          { x: 0, y: 420 },
        ],
        edges: [
          { kind: 'wall', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'railing', openings: [] },
          { kind: 'wall', openings: [] },
        ],
        walls: [
          { id: 'r-kiosk1', from: { x: 220, y: 0 }, to: { x: 220, y: 420 } },
          { id: 'r-kiosk2', from: { x: 0, y: 420 }, to: { x: 110, y: 420 } },
        ],
        items: [
          { id: 'r-plant1', kind: 'plant', x: 545, y: 845, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'r-plant2', kind: 'plant', x: 55, y: 845, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'r-plant3', kind: 'plant', x: 945, y: 55, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'r-plant4', kind: 'plant', x: 945, y: 445, rotation: 0, width: 50, depth: 50, finishes: {} },
          { id: 'r-planter', kind: 'planter', x: 620, y: 40, rotation: 0, width: 160, depth: 40, finishes: {} },
        ],
      },
    ],
    placements: [
      { tableId: 'demo-t01', floorId: 'ground', x: 300, y: 150, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' },
      { tableId: 'demo-t02', floorId: 'ground', x: 300, y: 380, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' },
      { tableId: 'demo-t03', floorId: 'ground', x: 700, y: 300, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
      { tableId: 'demo-t04', floorId: 'ground', x: 880, y: 300, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
      { tableId: 'demo-t05', floorId: 'ground', x: 300, y: 650, rotation: 0, width: 140, depth: 75, lookId: 'green-booth' },
      { tableId: 'demo-t06', floorId: 'first', x: 480, y: 260, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
      { tableId: 'demo-t07', floorId: 'first', x: 760, y: 150, rotation: 0, width: 70, depth: 70, lookId: 'square-bistro' },
      { tableId: 'demo-t08', floorId: 'first', x: 760, y: 360, rotation: 0, width: 70, depth: 70, lookId: 'square-bistro' },
      { tableId: 'demo-t09', floorId: 'rooftop', x: 400, y: 650, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' },
      { tableId: 'demo-t10', floorId: 'rooftop', x: 720, y: 250, rotation: 0, width: 120, depth: 80, lookId: 'oak-rectangle' },
    ],
  }
}
