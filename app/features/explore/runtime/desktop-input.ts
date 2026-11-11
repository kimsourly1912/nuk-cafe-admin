import type { Actions } from './actions'

/**
 * Keyboard and mouse for Explore (D275, docs/plans/explore.md → Controls): WASD or arrows, Shift,
 * Space, E (or F), V and M; the mouse looks while the pointer is locked (a click on the world locks
 * it, Esc releases it) or while dragging. Everything held clears when the window loses focus or the
 * page hides. Returns the cleanup.
 */

/** Radians a pixel of mouse movement turns the camera. */
export const MOUSE_LOOK = 0.0028

export interface DesktopInputOptions {
  canvas: HTMLCanvasElement
  actions: Actions
  /** Explore has the keyboard: no overlay open, nothing typed into. */
  active: () => boolean
  onMap: () => void
  /** Esc with the pointer free and nothing open. */
  onLeave: () => void
}

export function attachDesktopInput(options: DesktopInputOptions): () => void {
  const { canvas, actions } = options
  let drag: { x: number, y: number, moved: number } | null = null
  let unlockedAt = 0

  const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

  function keydown(event: KeyboardEvent) {
    if (!options.active() || typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.code === 'Escape') {
      // The Esc that released the pointer lock isn't also a request to leave.
      if (!document.pointerLockElement && performance.now() - unlockedAt > 400) options.onLeave()
      return
    }
    // Let keyboard activation reach a focused HUD button.
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if (event.code === 'KeyM') {
      if (!event.repeat) options.onMap()
      event.preventDefault()
      return
    }
    // One-shot keys act once per press, not on the keyboard's repeat.
    if (event.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      if (event.code === 'Space') event.preventDefault()
      return
    }
    if (actions.key(event.code, true)) event.preventDefault()
  }

  function keyup(event: KeyboardEvent) {
    actions.key(event.code, false)
  }

  function pointerdown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !options.active()) return
    drag = { x: event.clientX, y: event.clientY, moved: 0 }
  }

  function pointermove(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !options.active()) return
    if (document.pointerLockElement === canvas) {
      actions.look(event.movementX * MOUSE_LOOK, event.movementY * MOUSE_LOOK)
      return
    }
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag = { x: event.clientX, y: event.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) }
    actions.look(dx * MOUSE_LOOK, dy * MOUSE_LOOK)
  }

  function pointerup(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !drag) return
    const click = drag.moved < 4
    drag = null
    // A click (not a drag) locks the pointer for mouse look, where the browser allows it.
    if (click && options.active() && document.pointerLockElement !== canvas) {
      try {
        const request = canvas.requestPointerLock?.() as Promise<void> | undefined
        request?.catch?.(() => {})
      }
      catch {
        // Not allowed here (an iframe, an old browser): dragging still looks around.
      }
    }
  }

  function lockchange() {
    if (document.pointerLockElement !== canvas) unlockedAt = performance.now()
  }

  function clear() {
    drag = null
    actions.clear()
  }

  function visibility() {
    if (document.visibilityState === 'hidden') clear()
  }

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', clear)
  window.addEventListener('pagehide', clear)
  document.addEventListener('visibilitychange', visibility)
  document.addEventListener('pointerlockchange', lockchange)
  canvas.addEventListener('pointerdown', pointerdown)
  window.addEventListener('pointermove', pointermove)
  window.addEventListener('pointerup', pointerup)
  window.addEventListener('pointercancel', clear)

  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', clear)
    window.removeEventListener('pagehide', clear)
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('pointerlockchange', lockchange)
    canvas.removeEventListener('pointerdown', pointerdown)
    window.removeEventListener('pointermove', pointermove)
    window.removeEventListener('pointerup', pointerup)
    window.removeEventListener('pointercancel', clear)
    if (document.pointerLockElement === canvas) document.exitPointerLock()
  }
}
