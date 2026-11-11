/**
 * A fixed simulation step (D275, docs/plans/explore.md → The loop): frames come at whatever rate
 * the screen draws, the simulation always advances in equal steps, so movement and jumps are the
 * same at 30, 60 or 120 frames a second. A long gap (a slow frame, a tab in the background) runs at
 * most `maxSteps` steps and drops the rest instead of jumping ahead; `reset()` forgets any backlog
 * when the world resumes.
 */

export interface FixedStep {
  /** Runs `run(step)` as many times as `elapsed` seconds allow; returns the leftover fraction of a step. */
  advance: (elapsed: number, run: (step: number) => void) => number
  reset: () => void
}

export const SIMULATION_STEP = 1 / 60

export function createFixedStep(step = SIMULATION_STEP, maxSteps = 5): FixedStep {
  let backlog = 0
  return {
    advance(elapsed, run) {
      if (!Number.isFinite(elapsed) || elapsed <= 0) return backlog / step
      backlog = Math.min(backlog + elapsed, step * maxSteps)
      while (backlog >= step) {
        run(step)
        backlog -= step
      }
      return backlog / step
    },
    reset() {
      backlog = 0
    },
  }
}
