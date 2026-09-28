import { describe, expect, it } from 'vitest'
import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import { describeRules, explainRules, formatDelta, ruleParts, searchModifierGroup, usageLabel } from '../schemas/modifier-group-display'

describe('selection rules in words', () => {
  it('names each rule as the spec lists them', () => {
    expect(describeRules(0, null)).toBe('Optional · choose any')
    expect(describeRules(0, 1)).toBe('Optional · up to 1')
    expect(describeRules(0, 3)).toBe('Optional · up to 3')
    expect(describeRules(1, 1)).toBe('Required · choose exactly 1')
    expect(describeRules(1, null)).toBe('Required · choose at least 1')
    expect(describeRules(2, 2)).toBe('Required · choose exactly 2')
    expect(describeRules(1, 3)).toBe('Required · choose 1–3')
  })

  it('splits the badge from the summary, and explains it as a sentence', () => {
    expect(ruleParts(1, 1)).toEqual({ kind: 'Required', summary: 'Choose exactly 1' })
    expect(ruleParts(0, null)).toEqual({ kind: 'Optional', summary: 'Choose any' })
    expect(explainRules(1, 1)).toBe('Customers must choose exactly 1.')
    expect(explainRules(0, 2)).toBe('Customers may choose up to 2, or none.')
    expect(explainRules(0, null)).toBe('Customers may choose any number, or none.')
    expect(explainRules(2, null)).toBe('Customers must choose at least 2.')
    expect(explainRules(1, 3)).toBe('Customers must choose 1 to 3.')
  })
})

describe('prices and usage', () => {
  it('shows prices as an extra, free when zero, large ones in full', () => {
    expect(formatDelta(50)).toBe('+$0.50')
    expect(formatDelta(0)).toBe('Free')
    expect(formatDelta(10_000)).toBe('+$100.00')
  })

  it('says what offers a group', () => {
    expect(usageLabel(0)).toBe('Unused')
    expect(usageLabel(1)).toBe('Offered by 1 menu item')
    expect(usageLabel(1234)).toBe('Offered by 1234 menu items')
  })
})

describe('searching groups', () => {
  const mod = (name: string, status: Modifier['status'] = 'active'): Modifier => ({ id: name, name, priceDeltaMinor: 0, isDefault: false, sortOrder: 1, status })
  const SYRUPS: ModifierGroup = { id: 'g', name: 'Syrups', minSelect: 0, maxSelect: 3, status: 'active', modifiers: [mod('Vanilla'), mod('Vanilla bean'), mod('Caramel'), mod('Hazelnut', 'archived')], itemCount: 0, version: 1, createdAt: '', updatedAt: '' }

  it('matches everything without a search, the group name, or active add-on names', () => {
    expect(searchModifierGroup(SYRUPS, ' ')).toEqual({ addOns: [] })
    expect(searchModifierGroup(SYRUPS, 'SYR')).toEqual({ addOns: [] })
    expect(searchModifierGroup(SYRUPS, 'vanilla')).toEqual({ addOns: ['Vanilla', 'Vanilla bean'] })
  })

  it('ignores archived add-ons and non-matches', () => {
    expect(searchModifierGroup(SYRUPS, 'hazel')).toBeNull()
    expect(searchModifierGroup(SYRUPS, 'milk')).toBeNull()
  })
})
