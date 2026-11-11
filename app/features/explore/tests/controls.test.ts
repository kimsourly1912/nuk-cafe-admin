import { describe, expect, it } from 'vitest'
import { createActions } from '../runtime/actions'
import { formatWalkReport } from '../runtime/bench'
import { CAMERA, cameraPose, createFollowCamera, lookBy, updateFollow, worldMove } from '../runtime/camera'
import { createFixedStep } from '../runtime/fixed-step'
import type { Target } from '../runtime/interaction'
import { chooseTarget, FACING_LIMIT } from '../runtime/interaction'
import { nextMode, TRANSITIONS, WALKING } from '../runtime/player'
import type { WalkWorld } from '../runtime/walk-world'

// Explore's input, interaction, player modes, loop and camera (D275, docs/plans/explore.md).

describe('actions', () => {
  it('clamps diagonal keys to the speed of one key', () => {
    const actions = createActions()
    actions.key('KeyW', true)
    actions.key('KeyD', true)
    const move = actions.move()
    expect(Math.hypot(move.x, move.y)).toBeCloseTo(1)
    expect(move.x).toBeCloseTo(Math.SQRT1_2)
  })

  it('lets the stick decide while it is held, keeping its tilt', () => {
    const actions = createActions()
    actions.key('KeyW', true)
    actions.stick({ x: 0.3, y: 0 })
    expect(actions.move()).toEqual({ x: 0.3, y: 0 })
    actions.stick(null)
    expect(actions.move()).toEqual({ x: 0, y: 1 })
  })

  it('takes a one-shot press once, and clears everything held or queued', () => {
    const actions = createActions()
    actions.key('KeyE', true)
    actions.key('Space', true)
    expect(actions.take('interact')).toBe(true)
    expect(actions.take('interact')).toBe(false)
    actions.key('KeyW', true)
    actions.key('ShiftLeft', true)
    actions.stick({ x: 1, y: 0 }, true)
    actions.look(0.2, 0.1)
    actions.clear()
    expect(actions.move()).toEqual({ x: 0, y: 0 })
    expect(actions.sprint()).toBe(false)
    expect(actions.take('jump')).toBe(false)
    expect(actions.takeLook()).toEqual({ x: 0, y: 0 })
  })

  it('sprints from Shift or the stick held at its rim', () => {
    const actions = createActions()
    actions.key('ShiftRight', true)
    expect(actions.sprint()).toBe(true)
    actions.key('ShiftRight', false)
    actions.stick({ x: 0, y: 1 }, true)
    expect(actions.sprint()).toBe(true)
    expect(actions.key('KeyQ', true)).toBe(false)
  })
})

describe('the player\'s modes', () => {
  it('sits, ignores a second Sit while sitting down, and is seated when the animation ends', () => {
    const sitting = nextMode(WALKING, { type: 'sit', seatId: 'sofa', now: 1 })
    expect(sitting).toEqual({ kind: 'sitting-down', seatId: 'sofa', until: 1 + TRANSITIONS.sit + TRANSITIONS.grace })
    expect(nextMode(sitting, { type: 'sit', seatId: 'armchair', now: 1.1 })).toBe(sitting)
    expect(nextMode(sitting, { type: 'stand', now: 1.1 })).toBe(sitting)
    expect(nextMode(sitting, { type: 'finished' })).toEqual({ kind: 'seated', seatId: 'sofa' })
  })

  it('completes a transition at its deadline when the animation never ends', () => {
    const sitting = nextMode(WALKING, { type: 'sit', seatId: 'sofa', now: 0 })
    expect(nextMode(sitting, { type: 'tick', now: 1 })).toBe(sitting)
    expect(nextMode(sitting, { type: 'tick', now: TRANSITIONS.sit + TRANSITIONS.grace })).toEqual({ kind: 'seated', seatId: 'sofa' })
    const standing = nextMode({ kind: 'seated', seatId: 'sofa' }, { type: 'stand', now: 5 })
    expect(standing.kind).toBe('standing-up')
    expect(nextMode(standing, { type: 'tick', now: 7 })).toBe(WALKING)
  })

  it('stands only when seated', () => {
    expect(nextMode(WALKING, { type: 'stand', now: 0 })).toBe(WALKING)
    expect(nextMode(WALKING, { type: 'finished' })).toBe(WALKING)
  })
})

describe('choosing the context target', () => {
  const door: Target = { id: 'door', kind: 'door', position: { x: 0, z: 1 }, y: 0, reach: 1.6 }
  // Scores: the door 1.0 (straight ahead), the seat about 1.15 (a little farther and to the side).
  const seat: Target = { id: 'seat', kind: 'seat', position: { x: 0.15, z: 1.05 }, y: 0, reach: 1.3 }
  const facingForward = { position: { x: 0, z: 0 }, y: 0, heading: 0 }
  const anything = () => true

  it('offers the closest target the character faces, within reach, on its floor', () => {
    expect(chooseTarget([door], facingForward, null, anything)?.id).toBe('door')
    expect(chooseTarget([door], { ...facingForward, heading: Math.PI }, null, anything)).toBeNull()
    expect(chooseTarget([door], { ...facingForward, position: { x: 0, z: -1 } }, null, anything)).toBeNull()
    expect(chooseTarget([{ ...door, y: 3.2 }], facingForward, null, anything)).toBeNull()
    expect(chooseTarget([door], { ...facingForward, heading: FACING_LIMIT * 0.9 }, null, anything)?.id).toBe('door')
  })

  it('keeps the current target unless another is clearly better, so the button doesn\'t flicker', () => {
    expect(chooseTarget([door, seat], facingForward, null, anything)?.id).toBe('door')
    expect(chooseTarget([door, seat], facingForward, 'seat', anything)?.id).toBe('seat')
    expect(chooseTarget([door, { ...seat, position: { x: 1.2, z: 1.2 } }], facingForward, 'seat', anything)?.id).toBe('door')
  })

  it('skips a target with something in the way', () => {
    expect(chooseTarget([door, seat], facingForward, null, target => target.id !== 'door')?.id).toBe('seat')
  })
})

describe('the fixed step', () => {
  it('runs equal steps whatever the frame rate, keeping the remainder', () => {
    const fixed = createFixedStep(1 / 60, 5)
    const steps: number[] = []
    let alpha = 0
    for (let frame = 0; frame < 30; frame++) alpha = fixed.advance(1 / 30, step => steps.push(step))
    expect(steps).toHaveLength(60)
    expect(new Set(steps)).toEqual(new Set([1 / 60]))
    expect(alpha).toBeLessThan(1)
  })

  it('drops a long gap instead of jumping ahead, and forgets the backlog on reset', () => {
    const fixed = createFixedStep(1 / 60, 5)
    let count = 0
    fixed.advance(10, () => count++)
    expect(count).toBe(5)
    fixed.advance(1 / 120, () => count++)
    fixed.reset()
    fixed.advance(1 / 120, () => count++)
    expect(count).toBe(5)
    expect(fixed.advance(Number.NaN, () => count++)).toBeGreaterThanOrEqual(0)
    expect(count).toBe(5)
  })
})

describe('the follow camera', () => {
  const open: WalkWorld = { walls: [], solids: [], surfaces: [], openDoors: new Set() }

  it('moves relative to the camera: forward is where it looks', () => {
    const behindFacingPlusZ = createFollowCamera(0)
    const forward = worldMove(behindFacingPlusZ.yaw, { x: 0, y: 1 })
    expect(forward.x).toBeCloseTo(0)
    expect(forward.z).toBeCloseTo(1)
    const right = worldMove(behindFacingPlusZ.yaw, { x: 1, y: 0 })
    expect(right.x).toBeCloseTo(-1)
  })

  it('recentres behind a moving character after a moment without looking, never while looking', () => {
    const camera = createFollowCamera(0)
    lookBy(camera, 1, 0)
    const turned = camera.yaw
    for (let step = 0; step < 60; step++) updateFollow(camera, 1 / 60, { heading: 0, moving: true, indoors: false, reducedMotion: false })
    expect(camera.yaw).toBe(turned)
    for (let step = 0; step < 120; step++) updateFollow(camera, 1 / 60, { heading: 0, moving: true, indoors: false, reducedMotion: false })
    expect(Math.cos(camera.yaw - Math.PI)).toBeGreaterThan(0.99)
  })

  it('does not swing on its own with reduced motion, and comes closer indoors', () => {
    const camera = createFollowCamera(0)
    lookBy(camera, 1, 0)
    const turned = camera.yaw
    for (let step = 0; step < 300; step++) updateFollow(camera, 1 / 60, { heading: 0, moving: true, indoors: true, reducedMotion: true })
    expect(camera.yaw).toBe(turned)
    expect(camera.distance).toBe(CAMERA.indoorsDistance)
  })

  it('keeps the pitch within its limits', () => {
    const camera = createFollowCamera(0)
    lookBy(camera, 0, 10)
    expect(camera.pitch).toBe(CAMERA.pitchMax)
    lookBy(camera, 0, -10)
    expect(camera.pitch).toBe(CAMERA.pitchMin)
  })

  it('comes in front of a wall behind the character, and below the ceiling', () => {
    const camera = createFollowCamera(0)
    const feet = { x: 0, y: 0, z: 0 }
    const free = cameraPose(camera, { world: open, feet, ceiling: null })
    expect(free.position.z).toBeLessThan(-2.5)
    const wall: WalkWorld = { ...open, walls: [{ a: { x: -5, z: -1 }, b: { x: 5, z: -1 }, bottom: 0, top: 3 }] }
    const pulled = cameraPose(camera, { world: wall, feet, ceiling: null })
    expect(pulled.position.z).toBeGreaterThan(-1)
    const low = cameraPose({ ...camera, pitch: CAMERA.pitchMax }, { world: open, feet, ceiling: 2.4 })
    expect(low.position.y).toBeLessThanOrEqual(2.4 - CAMERA.ceilingGap + 1e-9)
    // Through an open doorway, under its lintel: the lintel (from 2.1 m) is above where the ray crosses.
    const doorway: WalkWorld = { ...open, walls: [{ a: { x: -5, z: -1 }, b: { x: 5, z: -1 }, bottom: 2.1, top: 3 }] }
    expect(cameraPose(camera, { world: doorway, feet, ceiling: null }).pulledIn).toBe(false)
    expect(pulled.pulledIn).toBe(true)
    // An open door doesn't stop it; a closed one does.
    const door: WalkWorld = { ...open, walls: [{ a: { x: -5, z: -1 }, b: { x: 5, z: -1 }, bottom: 0, top: 2.1, door: 'front' }], openDoors: new Set(['front']) }
    expect(cameraPose(camera, { world: door, feet, ceiling: null }).position.z).toBeLessThan(-2.5)
  })
})

describe('the walk benchmark report', () => {
  it('names every number and says whether the phone gate passed', () => {
    const run = { frames: 1200, medianMs: 16.7, p95Ms: 30.1 }
    const text = formatWalkReport({
      runs: [run, run, run],
      all: { ...run, frames: 3600 },
      quality: 'low',
      pixelRatio: 1,
      canvas: { width: 390, height: 844 },
      renderer: { calls: 140, triangles: 90_000, geometries: 300, textures: 12 },
      firstFrameMs: 812.4,
      userAgent: 'Test',
    })
    expect(text).toContain('Walk 3: median 16.7 ms, p95 30.1 ms (1200 frames)')
    expect(text).toContain('Phone gate (p95 ≤ 33.3 ms): passed')
    expect(text).toContain('First frame: 812 ms')
  })
})
