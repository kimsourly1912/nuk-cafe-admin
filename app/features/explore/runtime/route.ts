import { firstWall } from './camera'
import type { Vec2 } from './vec'
import { distance } from './vec'
import type { WalkWorld } from './walk-world'
import { groundAt, isClear, STEP_HEIGHT } from './walk-world'

/**
 * The route to a waypoint (D275, docs/plans/explore.md → Waypoint and route): a walk grid laid
 * over the district at street and ground-floor level, searched with A* and smoothed so the line
 * runs straight wherever nothing is in the way. Doors count as passable (the player opens them on
 * the way). Built once per district; a search takes a few milliseconds.
 */

export interface WalkGrid {
  minX: number
  minZ: number
  cell: number
  cols: number
  rows: number
  /** 1 where a body can stand. */
  open: Uint8Array
  /** The ground's height at each open cell. */
  height: Float32Array
  /** Per cell, a bit per direction (`DIRECTIONS`) that a wall blocks. */
  blocked: Uint8Array
  /** The world with every door open, for line-of-sight checks. */
  world: WalkWorld
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const
const BODY = { radius: 0.3, height: 1.7 }

export interface GridOptions {
  bounds: { minX: number, maxX: number, minZ: number, maxZ: number }
  /** Doors to treat as open. */
  doors: readonly string[]
  /** Feet height to search from: the street; the ground floor is a step above it. */
  level: number
  cell?: number
}

export function buildWalkGrid(source: WalkWorld, options: GridOptions): WalkGrid {
  const cell = options.cell ?? 0.5
  const world: WalkWorld = { ...source, openDoors: new Set(options.doors) }
  const cols = Math.max(1, Math.ceil((options.bounds.maxX - options.bounds.minX) / cell))
  const rows = Math.max(1, Math.ceil((options.bounds.maxZ - options.bounds.minZ) / cell))
  const open = new Uint8Array(cols * rows)
  const height = new Float32Array(cols * rows)
  const blocked = new Uint8Array(cols * rows)
  const grid: WalkGrid = { minX: options.bounds.minX, minZ: options.bounds.minZ, cell, cols, rows, open, height, blocked, world }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const point = center(grid, col, row)
      const ground = groundAt(world, point, options.level + STEP_HEIGHT)
      if (ground === null || ground > options.level + STEP_HEIGHT * 2) continue
      if (!isClear(world, point, ground, BODY.radius, BODY.height)) continue
      open[row * cols + col] = 1
      height[row * cols + col] = ground
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      if (!open[index]) continue
      DIRECTIONS.forEach(([dx, dz], bit) => {
        const next = cellIndex(grid, col + dx, row + dz)
        if (next === null || !open[next]) return
        if (Math.abs(height[next]! - height[index]!) > STEP_HEIGHT) blocked[index]! |= 1 << bit
        else if (wallBetween(grid, center(grid, col, row), center(grid, col + dx, row + dz), height[index]!)) blocked[index]! |= 1 << bit
      })
    }
  }
  return grid
}

function center(grid: WalkGrid, col: number, row: number): Vec2 {
  return { x: grid.minX + (col + 0.5) * grid.cell, z: grid.minZ + (row + 0.5) * grid.cell }
}

function cellIndex(grid: WalkGrid, col: number, row: number): number | null {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows ? row * grid.cols + col : null
}

function wallBetween(grid: WalkGrid, from: Vec2, to: Vec2, feet: number): boolean {
  return firstWall(grid.world, from, to, feet + STEP_HEIGHT, feet + BODY.height) !== null
}

/** The open cell nearest `point`, searched a few cells around it. */
function nearestOpen(grid: WalkGrid, point: Vec2): number | null {
  const col = Math.floor((point.x - grid.minX) / grid.cell)
  const row = Math.floor((point.z - grid.minZ) / grid.cell)
  let best: number | null = null
  let bestDistance = Infinity
  for (let ring = 0; ring <= 4 && best === null; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
        const index = cellIndex(grid, col + dx, row + dz)
        if (index === null || !grid.open[index]) continue
        const gap = distance(center(grid, col + dx, row + dz), point)
        if (gap < bestDistance) {
          best = index
          bestDistance = gap
        }
      }
    }
  }
  return best
}

/** The route from `from` to `to`, as corner points, or null when the grid can't connect them. */
export function findRoute(grid: WalkGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const start = nearestOpen(grid, from)
  const goal = nearestOpen(grid, to)
  if (start === null || goal === null) return null
  const size = grid.cols * grid.rows
  const cost = new Float32Array(size).fill(Infinity)
  const parent = new Int32Array(size).fill(-1)
  const closed = new Uint8Array(size)
  const goalCol = goal % grid.cols
  const goalRow = Math.floor(goal / grid.cols)
  const estimate = (index: number) => Math.hypot((index % grid.cols) - goalCol, Math.floor(index / grid.cols) - goalRow)
  const heap = new Heap()
  cost[start] = 0
  heap.push(start, estimate(start))
  while (heap.size) {
    const index = heap.pop()
    if (closed[index]) continue
    closed[index] = 1
    if (index === goal) break
    const col = index % grid.cols
    const row = Math.floor(index / grid.cols)
    DIRECTIONS.forEach(([dx, dz], bit) => {
      if (grid.blocked[index]! & (1 << bit)) return
      const next = cellIndex(grid, col + dx, row + dz)
      if (next === null || !grid.open[next] || closed[next]) return
      // No cutting a corner past a blocked cell.
      if (dx && dz && (!grid.open[cellIndex(grid, col + dx, row) ?? -1] || !grid.open[cellIndex(grid, col, row + dz) ?? -1])) return
      const step = dx && dz ? Math.SQRT2 : 1
      if (cost[index]! + step < cost[next]!) {
        cost[next] = cost[index]! + step
        parent[next] = index
        heap.push(next, cost[next]! + estimate(next))
      }
    })
  }
  if (!closed[goal]) return null
  const cells: number[] = []
  for (let index = goal; index !== -1; index = parent[index]!) cells.push(index)
  cells.reverse()
  const points = [from, ...cells.slice(1, -1).map(index => center(grid, index % grid.cols, Math.floor(index / grid.cols))), to]
  return smooth(grid, points)
}

/** Drops corners the route can see past: from each point, straight to the farthest visible one. */
function smooth(grid: WalkGrid, points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points
  const result = [points[0]!]
  let anchor = 0
  while (anchor < points.length - 1) {
    let next = anchor + 1
    for (let candidate = points.length - 1; candidate > anchor + 1; candidate--) {
      if (visible(grid, points[anchor]!, points[candidate]!)) {
        next = candidate
        break
      }
    }
    result.push(points[next]!)
    anchor = next
  }
  return result
}

/** Nothing in the way of a body walking straight from `a` to `b`. */
function visible(grid: WalkGrid, a: Vec2, b: Vec2): boolean {
  const steps = Math.ceil(distance(a, b) / (grid.cell / 2))
  let feet: number | null = null
  for (let step = 0; step <= steps; step++) {
    const point = { x: a.x + ((b.x - a.x) * step) / steps, z: a.z + ((b.z - a.z) * step) / steps }
    const index = cellIndex(grid, Math.floor((point.x - grid.minX) / grid.cell), Math.floor((point.z - grid.minZ) / grid.cell))
    if (index === null || !grid.open[index]) return false
    feet = Math.min(feet ?? Infinity, grid.height[index]!)
  }
  return feet === null || !wallBetween(grid, a, b, feet)
}

/** The length of a route, metres. */
export function routeLength(points: readonly Vec2[]): number {
  let total = 0
  for (let index = 1; index < points.length; index++) total += distance(points[index - 1]!, points[index]!)
  return total
}

/** A binary min-heap of grid indexes by priority. */
class Heap {
  private items: number[] = []
  private priorities: number[] = []

  get size() {
    return this.items.length
  }

  push(item: number, priority: number) {
    this.items.push(item)
    this.priorities.push(priority)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.priorities[parent]! <= this.priorities[index]!) break
      this.swap(index, parent)
      index = parent
    }
  }

  pop(): number {
    const top = this.items[0]!
    const lastItem = this.items.pop()!
    const lastPriority = this.priorities.pop()!
    if (this.items.length) {
      this.items[0] = lastItem
      this.priorities[0] = lastPriority
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.items.length && this.priorities[left]! < this.priorities[smallest]!) smallest = left
        if (right < this.items.length && this.priorities[right]! < this.priorities[smallest]!) smallest = right
        if (smallest === index) break
        this.swap(index, smallest)
        index = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
    ;[this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!]
  }
}
