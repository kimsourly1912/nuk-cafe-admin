import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import { addOnIssues, archiveAddOnProblem, modifierGroupFormSchema, preselectProblem, settingsIssues, toAddOnFields, toAddOnForm, toCreateModifierGroupBody, toModifierGroupForm, toSettingsChanges, toSettingsForm } from '../schemas/modifier-group-form'

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

const mod = (id: string, name: string, overrides: Partial<Modifier> = {}): Modifier => ({ id, name, priceDeltaMinor: 0, isDefault: false, sortOrder: 1, status: 'active', ...overrides })
const groupOf = (minSelect: number, maxSelect: number | null, modifiers: Modifier[]): ModifierGroup =>
  ({ id: 'g', name: 'Milk', minSelect, maxSelect, status: 'active', modifiers, itemCount: 0, version: 1, createdAt: '', updatedAt: '' })
const MILK = groupOf(1, 1, [mod('a', 'Whole', { isDefault: true }), mod('b', 'Oat', { priceDeltaMinor: 50 }), mod('c', 'Soy', { status: 'archived' })])

describe('group settings', () => {
  it('reads a group into the form: optional groups keep 1 as the minimum to offer', () => {
    expect(toSettingsForm(MILK)).toEqual({ name: 'Milk', required: true, minSelect: 1, maxSelect: 1 })
    expect(toSettingsForm(groupOf(0, null, []))).toEqual({ name: 'Milk', required: false, minSelect: 1, maxSelect: null })
  })

  it('checks the name, the numbers and the server\'s selection rules, by field', () => {
    const ctx = { active: 2, defaults: 1 }
    expect(settingsIssues({ name: ' ', required: true, minSelect: 0, maxSelect: 0 }, ctx)).toEqual({ name: 'Name is required', minSelect: 'A required group needs at least 1', maxSelect: 'At least 1' })
    expect(settingsIssues({ name: 'Milk', required: true, minSelect: 3, maxSelect: null }, ctx)).toEqual({ minSelect: 'Customers must choose 3, but only 2 add-ons are active.' })
    expect(settingsIssues({ name: 'Milk', required: true, minSelect: 2, maxSelect: 1 }, ctx)).toEqual({ maxSelect: 'Can\'t be less than the minimum' })
    expect(settingsIssues({ name: 'Milk', required: false, minSelect: 2, maxSelect: 1 }, { active: 2, defaults: 2 })).toEqual({ maxSelect: '2 add-ons are pre-selected, but customers may choose at most 1.' })
    expect(settingsIssues({ name: 'Milk', required: false, minSelect: null, maxSelect: null }, ctx)).toEqual({})
  })

  it('sends only what changed; optional means a minimum of 0', () => {
    expect(toSettingsChanges(toSettingsForm(MILK), MILK)).toBeUndefined()
    expect(toSettingsChanges({ name: ' Dairy ', required: false, minSelect: 1, maxSelect: null }, MILK)).toEqual({ name: 'Dairy', minSelect: 0, maxSelect: null })
    expect(toSettingsChanges({ name: 'Milk', required: true, minSelect: 1, maxSelect: 2 }, MILK)).toEqual({ maxSelect: 2 })
  })
})

describe('one add-on', () => {
  it('reads an add-on in dollars and sends cents', () => {
    expect(toAddOnForm(MILK.modifiers[1])).toEqual({ name: 'Oat', price: 0.5, isDefault: false })
    expect(toAddOnForm()).toEqual({ name: '', price: undefined, isDefault: false })
    expect(toAddOnFields({ name: ' Almond ', price: 0.75, isDefault: false })).toEqual({ name: 'Almond', priceDeltaMinor: 75, isDefault: false })
    expect(toAddOnFields({ name: 'Whole', price: undefined, isDefault: true })).toEqual({ name: 'Whole', priceDeltaMinor: 0, isDefault: true })
  })

  it('needs a name unused by the group\'s other active add-ons', () => {
    expect(addOnIssues({ name: 'oat ', isDefault: false }, MILK)).toEqual({ name: 'Already used in this group' })
    expect(addOnIssues({ name: 'Oat', isDefault: false }, MILK, MILK.modifiers[1])).toEqual({})
    // An archived add-on's name is free (the server's index covers active ones).
    expect(addOnIssues({ name: 'Soy', isDefault: false }, MILK)).toEqual({})
    expect(addOnIssues({ name: '', price: -1, isDefault: false }, MILK)).toEqual({ name: 'Add-on name is required', price: 'Can\'t be negative' })
    expect(addOnIssues({ name: 'Gold', price: 101, isDefault: false }, MILK)).toEqual({ price: 'At most $100' })
  })

  it('won\'t pre-select more than the group\'s maximum', () => {
    expect(addOnIssues({ name: 'Almond', isDefault: true }, MILK)).toEqual({ isDefault: '2 add-ons are pre-selected, but customers may choose at most 1.' })
    expect(addOnIssues({ name: 'Whole', isDefault: true }, MILK, MILK.modifiers[0])).toEqual({})
    expect(preselectProblem(MILK, MILK.modifiers[1]!)).toBe('2 add-ons are pre-selected, but customers may choose at most 1.')
    expect(preselectProblem(groupOf(0, null, MILK.modifiers), MILK.modifiers[1]!)).toBeUndefined()
  })

  it('won\'t archive an add-on the group\'s minimum or existence needs', () => {
    expect(archiveAddOnProblem(MILK, MILK.modifiers[1]!)).toBeUndefined()
    const one = groupOf(0, null, [mod('a', 'Whole')])
    expect(archiveAddOnProblem(one, one.modifiers[0]!)).toBe('A group needs at least one active add-on. Archive the group instead.')
    const two = groupOf(2, null, [mod('a', 'Whole'), mod('b', 'Oat')])
    expect(archiveAddOnProblem(two, two.modifiers[0]!)).toBe('Customers must choose 2, but only 1 add-on is active.')
  })
})
