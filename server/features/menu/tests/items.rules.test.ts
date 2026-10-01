import { describe, expect, it } from 'vitest'
import type { ExistingVariation, GridEntry, GridPlan, GridSet } from '#server/features/menu/items.rules'
import { combinationKey, gridCombinations, isGridProblem, planGrid } from '#server/features/menu/items.rules'

const SIZE: GridSet = { id: 'size', activeValueIds: ['s', 'm', 'l'], archivedValueIds: [] }
const TEMP: GridSet = { id: 'temp', activeValueIds: ['hot', 'iced'], archivedValueIds: [] }

const on = (valueIds: string[], priceMinor = 350): GridEntry => ({ valueIds, priceMinor, status: 'active' })
const off = (valueIds: string[], priceMinor: number | null = null): GridEntry => ({ valueIds, priceMinor, status: 'disabled' })
const plan = (sets: GridSet[], existing: ExistingVariation[], entries: GridEntry[]) => {
  const result = planGrid(sets, existing, entries)
  if (isGridProblem(result)) throw new Error(`unexpected problem: ${result.field}: ${result.message}`)
  return result as GridPlan
}
const problem = (sets: GridSet[], existing: ExistingVariation[], entries: GridEntry[]) => {
  const result = planGrid(sets, existing, entries)
  if (!isGridProblem(result)) throw new Error('expected a problem')
  return result
}
const full = (sets: GridSet[]) => gridCombinations(sets).map(values => on(values))

describe('the grid', () => {
  it('is every combination of the active values, first set slowest', () => {
    expect(gridCombinations([SIZE, TEMP])).toEqual([['s', 'hot'], ['s', 'iced'], ['m', 'hot'], ['m', 'iced'], ['l', 'hot'], ['l', 'iced']])
    expect(gridCombinations([])).toEqual([[]])
  })

  it('identifies a combination whatever the order of its values', () => {
    expect(combinationKey(['iced', 's'])).toBe(combinationKey(['s', 'iced']))
    expect(combinationKey([])).toBe('')
  })
})

describe('planning a new grid', () => {
  it('creates one cell per combination, in grid order, for an item without option sets or with two', () => {
    expect(plan([], [], [on([], 250)]).cells).toEqual([{ id: undefined, key: '', valueIds: [], priceMinor: 250, status: 'active', sortOrder: 1 }])
    const grid = plan([SIZE, TEMP], [], [...full([SIZE, TEMP])].reverse())
    expect(grid.cells.map(c => c.valueIds)).toEqual(gridCombinations([SIZE, TEMP]))
    expect(grid.retire).toEqual([])
  })

  it('refuses a grid that misses a combination, lists one twice, or has a wrong shape', () => {
    const all = full([SIZE])
    expect(problem([SIZE], [], all.slice(1)).message).toBe('The price grid is missing 1 combination')
    expect(problem([SIZE], [], [...all, on(['s'])]).message).toBe('This combination is listed twice')
    expect(problem([SIZE, TEMP], [], [on(['s', 'm'])]).field).toBe('variations.0.valueIds')
    expect(problem([SIZE], [], [on(['s', 'hot'])]).field).toBe('variations.0.valueIds')
    expect(problem([], [], [on(['s'])]).message).toMatch(/no values/)
    expect(problem([SIZE], [], [on(['unknown'])]).field).toBe('variations.0.valueIds')
  })

  it('needs a price for every cell that\'s on, and at least one cell on', () => {
    expect(problem([SIZE], [], [on(['s']), { valueIds: ['m'], priceMinor: null, status: 'active' }, on(['l'])]).field).toBe('variations.1.priceMinor')
    expect(problem([SIZE], [], [off(['s']), off(['m']), off(['l'])]).message).toBe('Switch on at least one version')
    // A cell that's off may have no price.
    expect(plan([SIZE], [], [on(['s']), off(['m']), off(['l'], 400)]).cells.map(c => c.priceMinor)).toEqual([350, null, 400])
  })
})

describe('changing a grid', () => {
  const existing: ExistingVariation[] = [
    { id: 'v-s', combinationKey: 's', status: 'active' },
    { id: 'v-m', combinationKey: 'm', status: 'active' },
    { id: 'v-l', combinationKey: 'l', status: 'disabled' },
  ]

  it('keeps the ids of existing combinations, and revives a retired one', () => {
    const result = plan([SIZE], [...existing.slice(0, 2), { id: 'v-l', combinationKey: 'l', status: 'retired' }], full([SIZE]))
    expect(result.cells.map(c => c.id)).toEqual(['v-s', 'v-m', 'v-l'])
    expect(result.retire).toEqual([])
  })

  it('retires every old combination when an option set is added or removed', () => {
    const added = plan([SIZE, TEMP], existing, full([SIZE, TEMP]))
    expect(added.cells.every(c => c.id === undefined)).toBe(true)
    expect(added.retire).toEqual(['v-s', 'v-m', 'v-l'])
    const removed = plan([], existing, [on([])])
    expect(removed.retire).toEqual(['v-s', 'v-m', 'v-l'])
  })

  it('keeps a combination hidden by an archived value, and refuses to put that value in the grid', () => {
    const sizeWithoutLarge: GridSet = { id: 'size', activeValueIds: ['s', 'm'], archivedValueIds: ['l'] }
    const result = plan([sizeWithoutLarge], existing, full([sizeWithoutLarge]))
    expect(result.cells.map(c => c.id)).toEqual(['v-s', 'v-m'])
    expect(result.retire).toEqual([])
    expect(problem([sizeWithoutLarge], existing, [...full([sizeWithoutLarge]), on(['l'])]).message).toMatch(/archived/)
  })

  it('shows a new value of a set as missing until it\'s priced (or switched off)', () => {
    const withXl: GridSet = { id: 'size', activeValueIds: ['s', 'm', 'l', 'xl'], archivedValueIds: [] }
    expect(problem([withXl], existing, full([SIZE])).message).toBe('The price grid is missing 1 combination')
    expect(plan([withXl], existing, [...full([SIZE]), off(['xl'])]).cells.at(-1)).toMatchObject({ id: undefined, status: 'disabled' })
  })
})
