/**
 * Studio's left sidebar width in px (D277): resizable in 2D between `min` and `max`; 3D shows its
 * sidebar at the width last set in 2D.
 */
export const STUDIO_SIDEBAR = { min: 232, initial: 288, max: 430 } as const

/**
 * Studio's 2D shortcuts (D278), for its shortcut list (`?`). Figma's keys where Figma has the same
 * action. Keep in sync with `DesignShopEditor`'s `onStudioKey`.
 */
export const STUDIO_SHORTCUTS = [
  { kbds: ['v'], label: 'Select' },
  { kbds: ['h'], label: 'Hand (or hold Space and drag)' },
  { kbds: ['r'], label: 'Room: drag a rectangle (Alt cuts it out)' },
  { kbds: ['s'], label: 'Shape: drag a block of any size' },
  { kbds: ['o'], label: 'Shape: drag a round block' },
  { kbds: ['p'], label: 'Edit points: corners and sides of the floor (Enter or a double-click on the floor too)' },
  { kbds: ['w'], label: 'Draw wall' },
  { kbds: ['escape'], label: 'Cancel, leave the tool, then clear the selection' },
  { kbds: ['delete'], label: 'Delete the selection (an outline wall or railing becomes Open)' },
  { kbds: ['meta', 'd'], label: 'Duplicate the selection' },
  { kbds: ['shift', 'r'], label: 'Turn the selection 90°' },
  { kbds: ['arrowright'], label: 'Move the selection 5 cm' },
  { kbds: ['shift', 'arrowright'], label: 'Move the selection 25 cm' },
  { kbds: ['shift', '1'], label: 'Zoom to fit' },
  { kbds: ['shift', '2'], label: 'Zoom to the selection' },
  { kbds: ['shift', '0'], label: 'Zoom to 100 %' },
  { kbds: ['meta', '+'], label: 'Zoom in (or Ctrl/⌘ and the wheel, or pinch)' },
  { kbds: ['meta', '-'], label: 'Zoom out' },
  { kbds: ['meta', 'z'], label: 'Undo' },
  { kbds: ['meta', 'shift', 'z'], label: 'Redo' },
  { kbds: ['?'], label: 'Show keyboard shortcuts' },
] as const

/** While dragging a piece: what the keys held change (shown in the same list). */
export const STUDIO_DRAG_KEYS = [
  { kbds: ['shift'], label: 'Drag: straight across or down' },
  { kbds: ['meta'], label: 'Drag or draw: 5 cm steps instead of 25 cm' },
  { kbds: ['alt'], label: 'Drag: leave a copy behind' },
  { kbds: ['alt'], label: 'Draw: any angle' },
] as const
