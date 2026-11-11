type TapPointer = Pick<PointerEvent, 'pointerId' | 'button' | 'clientX' | 'clientY'>

const TAP_SLOP = 6

/** Tracks a single tap separately from the camera's drag and pinch gestures. */
export function createTapTracker() {
  const active = new Set<number>()
  let candidate: TapPointer | undefined

  function moved(event: TapPointer) {
    return candidate?.pointerId === event.pointerId
      && Math.hypot(event.clientX - candidate.clientX, event.clientY - candidate.clientY) > TAP_SLOP
  }

  return {
    down(event: TapPointer) {
      if (event.button !== 0) {
        candidate = undefined
        return
      }
      active.add(event.pointerId)
      candidate = active.size === 1 ? event : undefined
    },
    move(event: TapPointer) {
      if (moved(event)) candidate = undefined
    },
    up(event: TapPointer) {
      const tracked = active.delete(event.pointerId)
      if (!tracked) return false
      const tap = event.button === 0 && candidate?.pointerId === event.pointerId && !moved(event)
      candidate = undefined
      return tap
    },
    cancel(event: Pick<TapPointer, 'pointerId'>) {
      active.delete(event.pointerId)
      if (candidate?.pointerId === event.pointerId) candidate = undefined
    },
  }
}
