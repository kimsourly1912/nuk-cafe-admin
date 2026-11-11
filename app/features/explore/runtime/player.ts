/**
 * The player's mode on foot (D275, docs/plans/explore.md → The avatar): walking, sitting down,
 * seated, standing up. A pure function of the mode and an event, so double presses and a lost
 * animation are tested directly. Sitting and standing hold locomotion; each has a deadline (its
 * length plus a grace), after which the transition completes even if the animation never said so:
 * nobody stays stuck half-seated.
 */

export type PlayerMode
  = | { kind: 'walking' }
    | { kind: 'sitting-down', seatId: string, until: number }
    | { kind: 'seated', seatId: string }
    | { kind: 'standing-up', seatId: string, until: number }

export type PlayerEvent
  = | { type: 'sit', seatId: string, now: number }
    | { type: 'stand', now: number }
  /** The transition's animation ended. */
    | { type: 'finished' }
    | { type: 'tick', now: number }

/** Seconds. */
export const TRANSITIONS = { sit: 0.6, stand: 0.5, grace: 0.5 } as const

export const WALKING: PlayerMode = { kind: 'walking' }

export function nextMode(mode: PlayerMode, event: PlayerEvent): PlayerMode {
  switch (event.type) {
    case 'sit':
      return mode.kind === 'walking' ? { kind: 'sitting-down', seatId: event.seatId, until: event.now + TRANSITIONS.sit + TRANSITIONS.grace } : mode
    case 'stand':
      return mode.kind === 'seated' ? { kind: 'standing-up', seatId: mode.seatId, until: event.now + TRANSITIONS.stand + TRANSITIONS.grace } : mode
    case 'finished':
      return complete(mode)
    case 'tick':
      return (mode.kind === 'sitting-down' || mode.kind === 'standing-up') && event.now >= mode.until ? complete(mode) : mode
  }
}

function complete(mode: PlayerMode): PlayerMode {
  if (mode.kind === 'sitting-down') return { kind: 'seated', seatId: mode.seatId }
  if (mode.kind === 'standing-up') return WALKING
  return mode
}

/** The motor moves the character only while walking. */
export function canWalk(mode: PlayerMode): boolean {
  return mode.kind === 'walking'
}
