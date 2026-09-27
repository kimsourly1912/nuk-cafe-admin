import type { GridVariationStatus } from '#shared/contracts/menu-items'

/** Pure rules for menu items: the price grid (no I/O). */

/** The option sets an item uses, in grid order, with their values as the database has them now. */
export interface GridSet {
  id: string
  /** Active values, in the set's order: the grid's rows/columns. */
  activeValueIds: string[]
  archivedValueIds: string[]
}

export interface ExistingVariation {
  id: string
  combinationKey: string
  status: 'active' | 'disabled' | 'retired'
}

export interface GridEntry {
  valueIds: string[]
  priceMinor: number | null
  status: GridVariationStatus
}

export interface GridProblem {
  field: string
  message: string
}

export interface GridPlan {
  /** In grid order: update the variation with this id, or create one (`id` undefined). */
  cells: { id?: string, key: string, valueIds: string[], priceMinor: number | null, status: GridVariationStatus, sortOrder: number }[]
  /** Variations that leave the grid for good (their option set was removed from the item). */
  retire: string[]
}

/** A combination's identity: its value ids, sorted, joined. `''` without option sets. */
export const combinationKey = (valueIds: readonly string[]) => [...valueIds].sort().join(',')

/** Every combination of the sets' active values, in grid order (the first set varies slowest). */
export function gridCombinations(sets: readonly GridSet[]): string[][] {
  return sets.reduce<string[][]>((rows, set) => rows.flatMap(row => set.activeValueIds.map(value => [...row, value])), [[]])
}

/**
 * Checks a submitted grid against the item's option sets and plans the writes, or says what's
 * wrong. The grid must list every combination of the sets' active values exactly once; an active
 * cell needs a price; at least one cell is active. Existing variations keep their ids (by
 * combination). Ones hidden only because a value was archived stay as they are (restoring the
 * value brings them back); ones whose option set was removed are retired.
 */
export function planGrid(sets: readonly GridSet[], existing: readonly ExistingVariation[], entries: readonly GridEntry[]): GridProblem | GridPlan {
  const setOf = new Map<string, string>()
  const archived = new Set<string>()
  for (const set of sets) {
    for (const value of set.activeValueIds) setOf.set(value, set.id)
    for (const value of set.archivedValueIds) {
      setOf.set(value, set.id)
      archived.add(value)
    }
  }

  const byKey = new Map<string, { entry: GridEntry, index: number }>()
  for (const [index, entry] of entries.entries()) {
    const field = `variations.${index}`
    const setsUsed = entry.valueIds.map(value => setOf.get(value))
    if (entry.valueIds.length !== sets.length || setsUsed.includes(undefined) || new Set(setsUsed).size !== sets.length) {
      return { field: `${field}.valueIds`, message: sets.length ? `Choose one value of each option set (${sets.length})` : 'An item without option sets has one version, with no values' }
    }
    if (entry.valueIds.some(value => archived.has(value))) return { field: `${field}.valueIds`, message: 'This value is archived; restore it in the Options library first' }
    const key = combinationKey(entry.valueIds)
    if (byKey.has(key)) return { field: `${field}.valueIds`, message: 'This combination is listed twice' }
    if (entry.status === 'active' && entry.priceMinor === null) return { field: `${field}.priceMinor`, message: 'A version that\'s on needs a price' }
    byKey.set(key, { entry, index })
  }

  const combinations = gridCombinations(sets)
  const missing = combinations.filter(values => !byKey.has(combinationKey(values)))
  if (missing.length) return { field: 'variations', message: `The price grid is missing ${missing.length} ${missing.length === 1 ? 'combination' : 'combinations'}` }
  if (!entries.some(entry => entry.status === 'active')) return { field: 'variations', message: 'Switch on at least one version' }

  const existingByKey = new Map(existing.map(variation => [variation.combinationKey, variation]))
  const cells = combinations.map((values, i) => {
    const key = combinationKey(values)
    const { entry } = byKey.get(key)!
    return { id: existingByKey.get(key)?.id, key, valueIds: values, priceMinor: entry.priceMinor, status: entry.status, sortOrder: i + 1 }
  })

  const inGrid = new Set(cells.map(cell => cell.key))
  const retire = existing.filter((variation) => {
    if (variation.status === 'retired' || inGrid.has(variation.combinationKey)) return false
    const values = variation.combinationKey ? variation.combinationKey.split(',') : []
    // Same shape as the grid, hidden only by an archived value: keep it for when the value returns.
    const sameShape = values.length === sets.length && new Set(values.map(value => setOf.get(value))).size === sets.length && !values.some(value => !setOf.has(value))
    return !(sameShape && values.some(value => archived.has(value)))
  }).map(variation => variation.id)

  return { cells, retire }
}

export const isGridProblem = (result: GridProblem | GridPlan): result is GridProblem => 'message' in result
