/**
 * Explore's input, decoupled from devices (D275, docs/plans/explore.md → Controls). Keyboard,
 * mouse and touch write actions here; the simulation reads them once per step. Held actions (move,
 * sprint) are values; one-shot actions (jump, interact, camera) are queued once per press and taken
 * once. `clear()` drops everything held or queued: on blur, page hide, pointer cancel and whenever
 * an overlay takes focus, so nobody keeps walking after a dialog.
 */

export type OneShot = 'jump' | 'interact' | 'camera'

/** Keys (KeyboardEvent.code) and what they hold. */
const MOVE_KEYS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

const SPRINT_KEYS = new Set(['ShiftLeft', 'ShiftRight'])

export interface Move {
  /** Right is positive. */
  x: number
  /** Forward is positive. */
  y: number
}

export interface Actions {
  /** The move asked for, length at most 1 (diagonals are clamped). */
  move: () => Move
  sprint: () => boolean
  /** A key went down or up. Returns whether it is one of Explore's keys. */
  key: (code: string, down: boolean) => boolean
  /** The touch stick: a tilt (length up to 1), and whether it is held at its rim for a sprint. */
  stick: (move: Move | null, sprint?: boolean) => void
  press: (action: OneShot) => void
  /** Whether `action` was pressed since it was last taken. */
  take: (action: OneShot) => boolean
  look: (dx: number, dy: number) => void
  /** The look movement since the last call, in pixels. */
  takeLook: () => Move
  clear: () => void
}

export function createActions(): Actions {
  const held = new Set<string>()
  const queued = new Set<OneShot>()
  let stickMove: Move | null = null
  let stickSprint = false
  let lookX = 0
  let lookY = 0

  function move(): Move {
    const has = (direction: string) => [...held].some(code => MOVE_KEYS[code] === direction)
    const keys = { x: Number(has('right')) - Number(has('left')), y: Number(has('forward')) - Number(has('back')) }
    const raw = stickMove && (stickMove.x !== 0 || stickMove.y !== 0) ? stickMove : keys
    const size = Math.hypot(raw.x, raw.y)
    return size > 1 ? { x: raw.x / size, y: raw.y / size } : { x: raw.x, y: raw.y }
  }

  function key(code: string, down: boolean): boolean {
    if (code in MOVE_KEYS || SPRINT_KEYS.has(code)) {
      if (down) held.add(code)
      else held.delete(code)
      return true
    }
    if (!down) return code === 'Space' || code === 'KeyE' || code === 'KeyF' || code === 'KeyV'
    if (code === 'Space') press('jump')
    else if (code === 'KeyE' || code === 'KeyF') press('interact')
    else if (code === 'KeyV') press('camera')
    else return false
    return true
  }

  function press(action: OneShot) {
    queued.add(action)
  }

  function take(action: OneShot): boolean {
    return queued.delete(action)
  }

  function clear() {
    held.clear()
    queued.clear()
    stickMove = null
    stickSprint = false
    lookX = 0
    lookY = 0
  }

  return {
    move,
    sprint: () => stickSprint || [...held].some(code => SPRINT_KEYS.has(code)),
    key,
    stick: (next, sprint = false) => {
      stickMove = next
      stickSprint = Boolean(next) && sprint
    },
    press,
    take,
    look: (dx, dy) => {
      lookX += dx
      lookY += dy
    },
    takeLook: () => {
      const result = { x: lookX, y: lookY }
      lookX = 0
      lookY = 0
      return result
    },
    clear,
  }
}
