import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { describeRules, formatDelta, modifierGroupFormSchema, toCreateModifierGroupBody, toModifierGroupForm } from '../schemas/modifier-group-form'

const issues = (form: unknown) => v.safeParse(modifierGroupFormSchema, form).issues?.map(i => [v.getDotPath(i), i.message]) ?? []
const addOn = (name: string, price?: number, isDefault = false) => ({ name, price, isDefault })

describe('new add-on group form', () => {
  it('starts optional with no limit and two empty add-ons', () => {
    expect(toModifierGroupForm()).toMatchObject({ name: '', minSelect: 0, maxSelect: null })
    expect(toModifierGroupForm().modifiers).toHaveLength(2)
  })

  it('needs a name and every listed add-on, once', () => {
    expect(issues({ name: '', minSelect: 0, maxSelect: null, modifiers: [addOn('Oat'), addOn('')] })).toEqual([['name', 'Name is required'], ['modifiers.1.name', 'Add-on name is required']])
    expect(issues({ name: 'Milk', minSelect: 0, maxSelect: null, modifiers: [addOn('Oat'), addOn(' oat ')] })).toEqual([['modifiers', 'Each add-on can be listed only once']])
  })

  it('applies the server\'s selection rules, with its messages', () => {
    expect(issues({ name: 'Milk', minSelect: 3, maxSelect: null, modifiers: [addOn('Whole'), addOn('Oat')] }))
      .toEqual([['minSelect', 'Customers must choose 3, but only 2 add-ons are active.']])
    expect(issues({ name: 'Milk', minSelect: 2, maxSelect: 1, modifiers: [addOn('Whole'), addOn('Oat')] })).toEqual([['maxSelect', 'Can\'t be less than the minimum']])
    expect(issues({ name: 'Milk', minSelect: 0, maxSelect: 1, modifiers: [addOn('Whole', 0, true), addOn('Oat', 0.5, true)] }))
      .toEqual([['modifiers', '2 add-ons are pre-selected, but customers may choose at most 1.']])
  })

  it('refuses negative and too high prices', () => {
    expect(issues({ name: 'Milk', minSelect: 0, maxSelect: null, modifiers: [addOn('Oat', -1), addOn('Gold', 101)] }))
      .toEqual([['modifiers.0.price', 'Can\'t be negative'], ['modifiers.1.price', 'At most $100']])
  })

  it('sends names trimmed and prices in cents, free when empty', () => {
    expect(toCreateModifierGroupBody({ name: ' Milk ', minSelect: 1, maxSelect: 1, modifiers: [addOn('Whole', undefined, true), addOn(' Oat ', 0.5)] })).toEqual({
      name: 'Milk',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [{ name: 'Whole', priceDeltaMinor: 0, isDefault: true }, { name: 'Oat', priceDeltaMinor: 50, isDefault: false }],
    })
  })
})

describe('wording', () => {
  it('says the rules in words', () => {
    expect(describeRules(0, null)).toBe('Optional · any number')
    expect(describeRules(0, 2)).toBe('Optional · up to 2')
    expect(describeRules(1, 1)).toBe('Required · choose 1')
    expect(describeRules(1, null)).toBe('Required · at least 1')
    expect(describeRules(1, 3)).toBe('Required · 1 to 3')
  })

  it('shows prices as an extra, or free', () => {
    expect(formatDelta(50)).toBe('+$0.50')
    expect(formatDelta(0)).toBe('Free')
  })
})
