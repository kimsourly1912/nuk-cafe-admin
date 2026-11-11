import { describe, expect, it } from 'vitest'
import type { MotorInput } from '../runtime/motor'
import { createMotor, MOTOR, stepMotor, targetSpeed } from '../runtime/motor'
import type { WalkWorld } from '../runtime/walk-world'
import { groundAt, pushOut, rampHeight, STEP_HEIGHT } from '../runtime/walk-world'

// The character on foot (D275, docs/plans/explore.md → Controls and Collision).

const DT = 1 / 60

/** A 20 × 20 m floor at y = 0 with nothing on it, plus whatever a test adds. */
function room(extra: Partial<WalkWorld> = {}): WalkWorld {
  return {
    walls: [],
    solids: [],
    surfaces: [{ shape: 'area', outline: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }], holes: [], y: 0 }],
    openDoors: new Set(),
    ...extra,
  }
}

const still: MotorInput = { move: { x: 0, z: 0 }, sprint: false, jump: false, indoors: false }

function run(world: WalkWorld, motor: ReturnType<typeof createMotor>, input: Partial<MotorInput>, seconds: number) {
  for (let step = 0; step < Math.round(seconds / DT); step++) stepMotor(world, motor, { ...still, ...input }, DT)
  return motor
}

describe('speeds', () => {
  it('walks on a small tilt, jogs on a full one, sprints when asked, and is slower indoors', () => {
    expect(targetSpeed(0, false, false)).toBe(0)
    expect(targetSpeed(0.3, false, false)).toBeCloseTo(MOTOR.walk * (0.3 / MOTOR.walkTilt))
    expect(targetSpeed(1, false, false)).toBe(MOTOR.jog)
    expect(targetSpeed(1, true, false)).toBe(MOTOR.sprint)
    expect(targetSpeed(1, true, true)).toBe(MOTOR.indoors)
  })

  it('reaches the jog speed and covers the right distance on a fixed step', () => {
    const motor = run(room(), createMotor({ x: 0, z: 0 }, 0, 0), { move: { x: 0, z: 1 } }, 2)
    expect(Math.hypot(motor.velocity.x, motor.velocity.z)).toBeCloseTo(MOTOR.jog, 1)
    // Two seconds at jog, minus the short ramp up.
    expect(motor.position.z).toBeGreaterThan(MOTOR.jog * 2 - 0.5)
    expect(motor.position.z).toBeLessThan(MOTOR.jog * 2)
  })

  it('stops quickly when the input goes', () => {
    const motor = run(room(), createMotor({ x: 0, z: 0 }, 0, 0), { move: { x: 0, z: 1 } }, 1)
    run(room(), motor, {}, 0.3)
    expect(motor.velocity).toEqual({ x: 0, z: 0 })
  })

  it('turns the body toward the move at a limited rate, not at once', () => {
    const motor = createMotor({ x: 0, z: 0 }, 0, 0)
    stepMotor(room(), motor, { ...still, move: { x: 0, z: -1 } }, DT)
    expect(Math.abs(motor.heading)).toBeCloseTo(MOTOR.turnRate * DT, 5)
    run(room(), motor, { move: { x: 0, z: -1 } }, 0.5)
    expect(Math.abs(Math.cos(motor.heading) + 1)).toBeLessThan(1e-6)
  })
})

describe('collision', () => {
  it('slides along a wall instead of stopping', () => {
    const world = room({ walls: [{ a: { x: -10, z: 2 }, b: { x: 10, z: 2 }, bottom: 0, top: 3 }] })
    const motor = run(world, createMotor({ x: 0, z: 0 }, 0, 0), { move: { x: Math.SQRT1_2, z: Math.SQRT1_2 } }, 3)
    expect(motor.position.z).toBeLessThanOrEqual(2 - MOTOR.radius + 1e-6)
    expect(motor.position.x).toBeGreaterThan(3)
  })

  it('never overlaps a turned table: it slides along the slanted side and around it', () => {
    const world = room({ solids: [{ shape: 'box', center: { x: 4, z: 2 }, halfWidth: 0.6, halfDepth: 0.4, rotation: 30, bottom: 0, top: 0.76 }] })
    const motor = createMotor({ x: 4, z: 0 }, 0, 0)
    for (let step = 0; step < 180; step++) {
      stepMotor(world, motor, { ...still, move: { x: 0, z: 1 } }, DT)
      const settled = pushOut(world, motor.position, motor.y, MOTOR.radius, MOTOR.height)
      expect(Math.hypot(settled.x - motor.position.x, settled.z - motor.position.z)).toBeLessThan(1e-6)
    }
  })

  it('never passes a wall or a closed door, and passes the door once it is open', () => {
    const door = { a: { x: -1, z: 2 }, b: { x: 1, z: 2 }, bottom: 0, top: 2.1, door: 'front' }
    const world = room({ walls: [door, { a: { x: -10, z: 2 }, b: { x: -1, z: 2 }, bottom: 0, top: 3 }, { a: { x: 1, z: 2 }, b: { x: 10, z: 2 }, bottom: 0, top: 3 }] })
    const blocked = run(world, createMotor({ x: 0, z: 0 }, 0, 0), { move: { x: 0, z: 1 } }, 3)
    expect(blocked.position.z).toBeLessThan(2)
    world.openDoors.add('front')
    const through = run(world, createMotor({ x: 0, z: 0 }, 0, 0), { move: { x: 0, z: 1 } }, 3)
    expect(through.position.z).toBeGreaterThan(3)
  })

  it('pushes a body out of a circle the way it came from, not through it', () => {
    const world = room({ solids: [{ shape: 'circle', center: { x: 0, z: 0 }, radius: 0.5, bottom: 0, top: 1 }] })
    const pushed = pushOut(world, { x: -0.6, z: 0 }, 0, 0.3, 1.7)
    expect(pushed.x).toBeCloseTo(-0.8)
    expect(pushed.z).toBeCloseTo(0)
  })

  it('stops at the edge of the world: no ground, no step', () => {
    const motor = run(room(), createMotor({ x: 9, z: 0 }, 0, 0), { move: { x: 1, z: 0 } }, 2)
    expect(motor.position.x).toBeLessThanOrEqual(10)
    expect(groundAt(room(), motor.position, 0)).toBe(0)
  })
})

describe('steps, stairs and jumps', () => {
  /** The street at −0.2 with a café floor at 0 (a threshold) and a 0.5 m platform. */
  const street = (): WalkWorld => room({
    surfaces: [
      { shape: 'area', outline: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }], holes: [], y: -0.2 },
      { shape: 'area', outline: [{ x: -10, z: 2 }, { x: 10, z: 2 }, { x: 10, z: 10 }, { x: -10, z: 10 }], holes: [], y: 0 },
      { shape: 'area', outline: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: -4 }, { x: -10, z: -4 }], holes: [], y: 0.3 },
    ],
  })

  it('walks up a threshold under a step, and not onto a ledge above one', () => {
    const up = run(street(), createMotor({ x: 0, z: 0 }, -0.2, 0), { move: { x: 0, z: 1 } }, 1.5)
    expect(up.position.z).toBeGreaterThan(2)
    expect(up.y).toBe(0)
    expect(0.5 - -0.2).toBeGreaterThan(STEP_HEIGHT)
    const ledge = room({ surfaces: [...street().surfaces, { shape: 'area', outline: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: -2 }, { x: -10, z: -2 }], holes: [], y: 0.5 }] })
    const stopped = run(ledge, createMotor({ x: 0, z: 0 }, -0.2, 0), { move: { x: 0, z: -1 } }, 1.5)
    expect(stopped.position.z).toBeGreaterThan(-2)
  })

  it('jumps only from the ground, and lands', () => {
    const motor = createMotor({ x: 0, z: 0 }, 0, 0)
    stepMotor(room(), motor, { ...still, jump: true }, DT)
    expect(motor.vy).toBeGreaterThan(0)
    let highest = 0
    for (let step = 0; step < 60; step++) {
      // Pressing again in the air does nothing until the buffer could land it.
      stepMotor(room(), motor, { ...still, jump: step === 5 }, DT)
      highest = Math.max(highest, motor.y)
    }
    expect(highest).toBeGreaterThan(0.4)
    expect(highest).toBeLessThan(0.65)
    expect(motor.grounded).toBe(true)
    expect(motor.y).toBe(0)
  })

  it('keeps a jump pressed just before landing (buffer), not one pressed long before', () => {
    const count = (pressAt: (motor: ReturnType<typeof createMotor>) => boolean) => {
      const motor = createMotor({ x: 0, z: 0 }, 0, 0)
      stepMotor(room(), motor, { ...still, jump: true }, DT)
      let pressed = false
      let jumps = 0
      for (let step = 0; step < 60; step++) {
        const press: boolean = !pressed && pressAt(motor)
        pressed ||= press
        const before = motor.vy
        stepMotor(room(), motor, { ...still, jump: press }, DT)
        if (before <= 0 && motor.vy > 0) jumps++
      }
      return jumps
    }
    // Falling, a few centimetres above the ground: within the buffer.
    expect(count(motor => !motor.grounded && motor.vy < 0 && motor.y < 0.1)).toBe(1)
    // Falling from near the top: too early, it is dropped.
    expect(count(motor => !motor.grounded && motor.vy < 0 && motor.y > 0.4)).toBe(0)

    // Coyote: run off a platform and press jump a few steps later.
    const ledge = room({ surfaces: [{ shape: 'area', outline: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 0.5 }, { x: -10, z: 0.5 }], holes: [], y: 1 }, ...room().surfaces] })
    const runner = createMotor({ x: 0, z: 0 }, 1, 0)
    let jumped = false
    for (let step = 0; step < 60 && !jumped; step++) {
      const justLeft = !runner.grounded && runner.airborne > 0 && runner.airborne < MOTOR.coyote - DT
      stepMotor(ledge, runner, { ...still, move: { x: 0, z: 1 }, jump: justLeft }, DT)
      if (runner.vy > 0) jumped = true
    }
    expect(jumped).toBe(true)
  })

  it('climbs stairs and comes back down, and their side is solid', () => {
    // Stairs 1 m wide, 3.4 m long, rising toward −z to 3 m.
    const ramp = { shape: 'ramp' as const, center: { x: 0, z: 0 }, halfWidth: 0.5, halfDepth: 1.7, rotation: 0, bottom: 0, top: 3 }
    const world = room({ surfaces: [...room().surfaces, ramp] })
    expect(rampHeight(ramp, { x: 0, z: 1.7 })).toBeCloseTo(0)
    expect(rampHeight(ramp, { x: 0, z: -1.7 })).toBeCloseTo(3)
    const climber = run(world, createMotor({ x: 0, z: 2.5 }, 0, Math.PI), { move: { x: 0, z: -1 } }, 1.2)
    expect(climber.y).toBeGreaterThan(1)
    expect(climber.grounded).toBe(true)
    run(world, climber, { move: { x: 0, z: 1 } }, 2)
    expect(climber.y).toBe(0)
    // From the side at floor level, the high end is a wall.
    const side = run(world, createMotor({ x: 2, z: -1.2 }, 0, 0), { move: { x: -1, z: 0 } }, 2)
    expect(side.position.x).toBeGreaterThanOrEqual(0.5 + MOTOR.radius - 1e-6)
    expect(side.y).toBe(0)
  })
})
