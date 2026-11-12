import { describe, expect, it } from 'vitest'
import { createActions } from '../runtime/actions'
import type { MotoGround } from '../runtime/moto'
import { createMoto, MOTO, motoDismount, motoFits, stepMoto } from '../runtime/moto'
import { vec } from '../runtime/vec'

const dt = 1 / 60
const road = [vec(-3, -15), vec(3, -15), vec(3, 15), vec(-3, 15)]
const ground = (): MotoGround => ({
  street: 0,
  road,
  world: {
    walls: [],
    solids: [],
    surfaces: [{ shape: 'area', outline: [vec(-5, -16), vec(5, -16), vec(5, 16), vec(-5, 16)], holes: [], y: 0 }],
    openDoors: new Set(),
  },
})

describe('Explore moto', () => {
  it('accelerates, brakes to zero and only then starts a bounded reverse', () => {
    const street = ground()
    const moto = createMoto({ position: vec(0, 0), heading: 0 })
    for (let step = 0; step < 60; step++) stepMoto(street, moto, { gas: true, brake: false, steer: 0 }, dt)
    expect(moto.speed).toBeCloseTo(4.5)
    expect(moto.position.z).toBeGreaterThan(2)
    stepMoto(street, moto, { gas: true, brake: true, steer: 0 }, dt)
    expect(moto.speed).toBeLessThan(4.5)
    while (moto.speed > 0) stepMoto(street, moto, { gas: false, brake: true, steer: 0 }, dt)
    expect(moto.speed).toBe(0)
    const stoppedAt = moto.position.z
    for (let step = 0; step < 120; step++) stepMoto(street, moto, { gas: false, brake: true, steer: 0 }, dt)
    expect(moto.speed).toBe(-MOTO.reverse)
    expect(moto.position.z).toBeLessThan(stoppedAt)
  })

  it('steers with its own heading and stops before the road edge or a solid', () => {
    const street = ground()
    street.world.solids.push({ shape: 'circle', center: vec(0, 3), radius: 0.4, bottom: 0, top: 2 })
    const moto = createMoto({ position: vec(0, 0), heading: 0 })
    for (let step = 0; step < 120; step++) stepMoto(street, moto, { gas: true, brake: false, steer: 0 }, dt)
    expect(moto.speed).toBe(0)
    expect(moto.position.z).toBeLessThan(2)
    for (let step = 0; step < 120; step++) stepMoto(street, moto, { gas: false, brake: true, steer: 1 }, dt)
    expect(moto.heading).toBeLessThan(0)
    expect(motoFits(street, moto)).toBe(true)
    expect(motoFits(street, { position: vec(2.8, 0), heading: 0 })).toBe(false)
  })

  it('steps toward the curb, tries the other side if blocked, and stays on if neither is safe', () => {
    const street = ground()
    const moto = { position: vec(0, 0), heading: 0 }
    const curb = vec(3, 0)
    expect(motoDismount(street, moto, curb)?.x).toBeCloseTo(0.95)
    const wall = (x: number) => ({ a: vec(x, -2), b: vec(x, 2), bottom: 0, top: 2 })
    street.world.walls.push(wall(0.65))
    expect(motoDismount(street, moto, curb)?.x).toBeCloseTo(-0.95)
    street.world.walls.push(wall(-0.65))
    expect(motoDismount(street, moto, curb)).toBeNull()
  })

  it('clears pedals, steering and pending recovery across a pause', () => {
    const actions = createActions()
    actions.key('KeyW', true)
    actions.key('KeyD', true)
    expect(actions.drive()).toEqual({ steer: 1, gas: true, brake: false })
    actions.stick({ x: -0.5, y: 1 })
    actions.pedal('brake', true)
    actions.key('KeyR', true)
    expect(actions.drive()).toEqual({ steer: -0.5, gas: true, brake: true })
    actions.clear()
    expect(actions.drive()).toEqual({ steer: 0, gas: false, brake: false })
    expect(actions.take('resetMoto')).toBe(false)
  })
})
