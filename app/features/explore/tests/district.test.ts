import { describe, expect, it } from 'vitest'
import { DEMO_CAFE_NAME, DEMO_SEED, DEMO_TABLES, demoCafe } from '../demo/demo-cafe'
import { firstWall } from '../runtime/camera'
import { buildDistrict, floorAt } from '../runtime/district'
import { createMotor, MOTOR, stepMotor } from '../runtime/motor'
import { buildWalkGrid, findRoute, routeLength } from '../runtime/route'
import { add, distance, insidePolygon, normalize, sub } from '../runtime/vec'
import { groundAt, isClear } from '../runtime/walk-world'

// A district from a café layout and its Neighborhood lane (D275, docs/plans/explore.md → Districts).

const district = () => buildDistrict({ name: DEMO_CAFE_NAME, layout: demoCafe(), tables: DEMO_TABLES, seed: DEMO_SEED })

describe('the demo district', () => {
  it('finds the street door, pointing out of the café', () => {
    const built = district()
    expect(built.doors.map(door => door.id)).toEqual(['front-door'])
    const door = built.doors[0]!
    const ground = built.floors[0]!
    expect(insidePolygon(add(door.mid, door.out, -0.5), ground.outline)).toBe(true)
    expect(insidePolygon(add(door.mid, door.out, 0.5), ground.outline)).toBe(false)
    expect(distance(door.a, door.b)).toBeCloseTo(1.4)
  })

  it('stands the street a slab below the café, and the café\'s floors at their heights', () => {
    const built = district()
    expect(built.street).toBeCloseTo(-0.2)
    expect(built.floors.map(floor => [floor.name, floor.y, floor.ceiling])).toEqual([['Ground', 0, 3.2], ['First', 3.2, 6.2]])
  })

  it('offers a counter to order at, and seats: table chairs, the sofa and the armchair', () => {
    const built = district()
    expect(built.counter).not.toBeNull()
    expect(isClear(built.world, built.counter!.position, 0, MOTOR.radius, MOTOR.height)).toBe(true)
    const seats = built.seats.map(seat => seat.id)
    expect(seats).toContain('sofa')
    expect(seats).toContain('armchair')
    // Every table's chairs: 2 + 2 + 4 + 4 on the ground, 2 + 4 upstairs.
    expect(seats.filter(id => id.startsWith('demo-'))).toHaveLength(18)
  })

  it('spawns the player across the street, standing clear, facing the café\'s door', () => {
    const built = district()
    const { spawn } = built
    expect(groundAt(built.world, spawn.position, spawn.y)).toBeCloseTo(built.street)
    expect(isClear(built.world, spawn.position, spawn.y, MOTOR.radius, MOTOR.height)).toBe(true)
    expect(floorAt(built, spawn.position, spawn.y)).toBeNull()
    const toDoor = normalize(sub(built.doors[0]!.mid, spawn.position))
    expect(Math.sin(spawn.heading) * toDoor.x + Math.cos(spawn.heading) * toDoor.z).toBeGreaterThan(0.99)
  })

  it('routes from the street through the door to the counter without crossing a wall', () => {
    const built = district()
    const grid = buildWalkGrid(built.world, { bounds: built.bounds, doors: built.doors.map(door => door.id), level: built.street })
    const route = findRoute(grid, built.spawn.position, built.counter!.position)
    expect(route).not.toBeNull()
    expect(route![0]).toEqual(built.spawn.position)
    expect(route!.at(-1)).toEqual(built.counter!.position)
    const doorsOpen = { ...built.world, openDoors: new Set(['front-door']) }
    for (let index = 1; index < route!.length; index++) {
      expect(firstWall(doorsOpen, route![index - 1]!, route![index]!, 0.3, 1.5)).toBeNull()
    }
    // Smoothed: a handful of corners, not a staircase of cells.
    expect(route!.length).toBeLessThan(8)
    expect(routeLength(route!)).toBeLessThan(25)
  })

  it('walks a body along that route into the café and up to the counter', () => {
    const built = district()
    built.world.openDoors.add('front-door')
    const grid = buildWalkGrid(built.world, { bounds: built.bounds, doors: ['front-door'], level: built.street })
    const route = findRoute(grid, built.spawn.position, built.counter!.position)!
    const motor = createMotor(built.spawn.position, built.spawn.y, built.spawn.heading)
    let index = 1
    for (let step = 0; step < 60 * 30 && index < route.length; step++) {
      if (distance(motor.position, route[index]!) < 0.3) index++
      if (index >= route.length) break
      stepMotor(built.world, motor, { move: normalize(sub(route[index]!, motor.position)), sprint: false, jump: false, indoors: Boolean(floorAt(built, motor.position, motor.y)) }, 1 / 60)
    }
    expect(distance(motor.position, built.counter!.position)).toBeLessThan(0.5)
    expect(motor.y).toBe(0)
  })

  it('climbs the stairs to the first floor', () => {
    const built = district()
    // The stairs rise toward the back wall, from (0.8, 4.3) to (0.8, 0.9).
    const motor = createMotor({ x: 0.8, z: 4.8 }, 0, Math.PI)
    for (let step = 0; step < 60 * 4; step++) stepMotor(built.world, motor, { move: { x: 0, z: -1 }, sprint: false, jump: false, indoors: true }, 1 / 60)
    expect(motor.y).toBeCloseTo(3.2)
    expect(floorAt(built, motor.position, motor.y)?.name).toBe('First')
  })

  it('is the same street every time for the same seed', () => {
    expect(JSON.stringify(district().map)).toBe(JSON.stringify(district().map))
  })
})
