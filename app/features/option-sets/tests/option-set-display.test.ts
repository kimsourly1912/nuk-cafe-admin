import { describe, expect, it } from 'vitest'
import type { OptionSet, OptionValue } from '#shared/contracts/menu-options'
import { archiveSetDescription, moveEntry, searchOptionSet, usageLabel, valueCountLabel } from '../schemas/option-set-display'

const value = (name: string, status: OptionValue['status'] = 'active'): OptionValue => ({ id: name, name, sortOrder: 1, status })
const MILK: OptionSet = {
  id: 'set-1',
  name: 'Milk',
  status: 'active',
  values: [value('Whole'), value('Oat'), value('Oat milk'), value('Almond', 'archived')],
  itemCount: 0,
  version: 1,
  createdAt: '',
  updatedAt: '',
}

describe('searching option sets', () => {
  it('matches everything without a search', () => {
    expect(searchOptionSet(MILK, '  ')).toEqual({ values: [] })
  })

  it('matches the set name, listing only the values that match too', () => {
    expect(searchOptionSet(MILK, 'mil')).toEqual({ values: ['Oat milk'] })
    expect(searchOptionSet(MILK, 'MILK ')).toEqual({ values: ['Oat milk'] })
    expect(searchOptionSet({ ...MILK, name: 'Dairy' }, 'dair')).toEqual({ values: [] })
  })

  it('matches active value names and lists them in order', () => {
    expect(searchOptionSet(MILK, 'oat')).toEqual({ values: ['Oat', 'Oat milk'] })
  })

  it('ignores archived values and non-matches', () => {
    expect(searchOptionSet(MILK, 'almond')).toBeNull()
    expect(searchOptionSet(MILK, 'soy')).toBeNull()
  })
})

describe('option set wording', () => {
  it('says what uses a set', () => {
    expect(usageLabel(0)).toBe('Unused')
    expect(usageLabel(1)).toBe('Used by 1 menu item')
    expect(usageLabel(4)).toBe('Used by 4 menu items')
  })

  it('counts values', () => {
    expect(valueCountLabel(1)).toBe('1 value')
    expect(valueCountLabel(3)).toBe('3 values')
  })

  it('explains what archiving a set does to the items using it', () => {
    expect(archiveSetDescription(0)).toBe('This set cannot be added to menu items until restored.')
    expect(archiveSetDescription(1)).toBe('1 menu item uses this set and will keep it, but it cannot be added to other items until restored.')
    expect(archiveSetDescription(3)).toBe('3 menu items use this set and will keep it, but it cannot be added to other items until restored.')
  })
})

describe('moving an entry', () => {
  it('moves up and down without changing the input', () => {
    const list = ['a', 'b', 'c']
    expect(moveEntry(list, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveEntry(list, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('ignores moves past either end', () => {
    expect(moveEntry(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveEntry(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })
})
