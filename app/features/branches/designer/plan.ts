import type { ItemKind } from '#shared/contracts/shop-layout'

/**
 * What the floor plan's editor talks about (D273): what's selected, the plan's tool, and a piece on
 * its way from the library. Plain types, shared by the editor, the canvas and the editor's state.
 */

/**
 * What's selected on the plan: a placed table (by its table id), furniture or an inside wall (by
 * id), or an outline edge (by its index, as a string).
 */
export interface PlanSelection {
  kind: 'table' | 'item' | 'wall' | 'edge'
  id: string
}

/** Pick and move (`select`), Draw outline (frame 3A) or Draw wall (9A). */
export type PlanMode = 'select' | 'outline' | 'wall'

/**
 * A piece being dragged from the library, drawn see-through where it would land: a table (with the
 * look it will get; `tableId` null when a look was dragged and the table is asked on drop) or
 * furniture.
 */
export type PlanGhost
  = | { kind: 'table', tableId: string | null, lookId: string, x: number, y: number }
    | { kind: 'item', itemKind: ItemKind, width: number, depth: number, x: number, y: number }
