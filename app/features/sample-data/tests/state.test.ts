import { describe, expect, it } from 'vitest'
import type { SampleDataState } from '#shared/contracts/sample-data'
import { branchSummary, currentStage, hasResettable, menuStatus, menuSummary } from '../utils/state'

const empty = { categories: 0, optionSets: 0, modifierGroups: 0, availabilityRules: 0, items: { draft: 0, active: 0, archived: 0 }, photos: 0 }
const loaded = { categories: 8, optionSets: 3, modifierGroups: 4, availabilityRules: 2, items: { draft: 3, active: 35, archived: 2 }, photos: 0 }
const stages = [
  { key: 'categories' as const, label: 'Categories', done: 8, total: 8 },
  { key: 'items' as const, label: 'Menu items', done: 23, total: 40 },
]

function state(counts = empty, run: SampleDataState['menu']['run'] = null): SampleDataState {
  return { environment: 'Test', menu: { counts, run }, branches: [] }
}

describe('sample data state', () => {
  it('tells an empty menu, other data, a partial load and a loaded menu apart', () => {
    expect(menuStatus(state())).toBe('empty')
    expect(menuStatus(state({ ...empty, categories: 1 }))).toBe('other')
    expect(menuStatus(state(loaded, { size: 'standard', finished: false, stages }))).toBe('partial')
    expect(menuStatus(state(loaded, { size: 'standard', finished: true, stages }))).toBe('loaded')
  })

  it('offers a reset for any menu record, upload, or unfinished load', () => {
    expect(hasResettable(state())).toBe(false)
    expect(hasResettable(state({ ...empty, photos: 2 }))).toBe(true)
    expect(hasResettable(state(empty, { size: 'small', finished: false, stages }))).toBe(true)
  })

  it('summarises the menu and a branch in words', () => {
    expect(menuSummary(loaded)).toBe('8 categories, 3 option sets, 4 add-on groups, 2 rules, 40 items (35 published, 3 drafts, 2 archived)')
    expect(menuSummary({ ...empty, categories: 1, items: { draft: 1, active: 0, archived: 0 } })).toBe('1 category, 0 option sets, 0 add-on groups, 0 rules, 1 item (1 draft)')
    expect(branchSummary({ id: 'b', name: 'Main', hoursSet: true, tables: 12 })).toBe('Hours set · 12 tables')
    expect(branchSummary({ id: 'b', name: 'Main', hoursSet: false, tables: 1 })).toBe('No hours set · 1 table')
  })

  it('finds the step a load continues from', () => {
    expect(currentStage(stages)?.key).toBe('items')
    expect(currentStage([stages[0]!])).toBeUndefined()
  })
})
