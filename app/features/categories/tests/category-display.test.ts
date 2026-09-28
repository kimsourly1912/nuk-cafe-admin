import { describe, expect, it } from 'vitest'
import { availabilityLabel, subcategoryCount } from '../schemas/category-display'

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
})

describe('subcategory count', () => {
  it('names one or many, and nothing for none', () => {
    expect(subcategoryCount(0)).toBeUndefined()
    expect(subcategoryCount(1)).toBe('1 subcategory')
    expect(subcategoryCount(3)).toBe('3 subcategories')
  })
})
