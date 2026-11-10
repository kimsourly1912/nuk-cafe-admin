import { describe, expect, it } from 'vitest'
import { availabilityLabel, contentsLabel } from '../schemas/category-display'

const rule = (name: string, status: 'active' | 'archived' = 'active') => ({ id: name, name, status })

describe('availability label', () => {
  it('a top-level category without rules is always available', () => {
    expect(availabilityLabel({ parentId: null, availabilityRules: [] })).toMatchObject({ label: 'Always', unrestricted: true })
  })

  it('a sub-category without rules inherits its parent, never "Always"', () => {
    expect(availabilityLabel({ parentId: 'cat-1', availabilityRules: [] })).toMatchObject({ label: 'Inherits parent', unrestricted: true })
  })

  it('shows one rule name and how many more; the full list for the tooltip', () => {
    expect(availabilityLabel({ parentId: null, availabilityRules: [rule('Breakfast')] })).toEqual({ label: 'Breakfast', full: 'Sold only during: Breakfast', unrestricted: false })
    expect(availabilityLabel({ parentId: 'cat-1', availabilityRules: [rule('Breakfast'), rule('Lunch'), rule('Old', 'archived')] }))
      .toEqual({ label: 'Breakfast +2', full: 'Sold only during: Breakfast, Lunch, Old (archived)', unrestricted: false })
  })

  it('adds each rule\'s times when they are known', () => {
    const times = new Map([['Breakfast', 'Mon–Fri · 7:00 AM – 11:00 AM']])
    expect(availabilityLabel({ parentId: null, availabilityRules: [rule('Breakfast'), rule('Lunch')] }, times).full)
      .toBe('Sold only during: Breakfast (Mon–Fri · 7:00 AM – 11:00 AM), Lunch')
  })
})

describe('contents label', () => {
  it('names subcategories or items, one or many, or says it is empty', () => {
    expect(contentsLabel({ childCount: 1, itemCount: 0 })).toBe('1 subcategory')
    expect(contentsLabel({ childCount: 3, itemCount: 0 })).toBe('3 subcategories')
    expect(contentsLabel({ childCount: 0, itemCount: 1 })).toBe('1 item')
    expect(contentsLabel({ childCount: 0, itemCount: 12 })).toBe('12 items')
    expect(contentsLabel({ childCount: 0, itemCount: 0 })).toBe('Empty')
  })
})
