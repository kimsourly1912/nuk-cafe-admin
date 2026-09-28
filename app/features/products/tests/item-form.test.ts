import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { MenuItem } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { OptionSet } from '#shared/contracts/menu-options'
import { addOnGroupFromLibrary, buildGrid, itemFormSchema, optionSetFromLibrary, toCreateItemBody, toItemForm, toUpdateItemBody } from '../schemas/item-form'
import type { FormOptionSet, ItemForm } from '../schemas/item-form'

const STAMP = '2026-09-28T00:00:00.000Z'

const SIZE: FormOptionSet = { id: 'size', name: 'Size', status: 'active', values: [{ id: 's', name: 'Small' }, { id: 'l', name: 'Large' }] }
const TEMP: FormOptionSet = { id: 'temp', name: 'Temperature', status: 'active', values: [{ id: 'hot', name: 'Hot' }, { id: 'iced', name: 'Iced' }] }

const MILK: ModifierGroup = {
  id: 'milk',
  name: 'Milk',
  minSelect: 0,
  maxSelect: 1,
  status: 'active',
  modifiers: [
    { id: 'oat', name: 'Oat', priceDeltaMinor: 50, isDefault: false, sortOrder: 1, status: 'active' },
    { id: 'soy', name: 'Soy', priceDeltaMinor: 40, isDefault: false, sortOrder: 2, status: 'archived' },
  ],
  itemCount: 0,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
}

/** Latte: Size × Temperature, with Large/Iced switched off; a Milk group with its own rules. */
const LATTE: MenuItem = {
  id: 'item-1',
  categoryId: 'cat-1',
  name: 'Latte',
  description: 'Espresso and milk',
  image: { id: 'img-1', url: '/media/a.png' },
  status: 'active',
  sortOrder: 1,
  optionSets: [
    { id: 'size', name: 'Size', status: 'active', values: [{ id: 's', name: 'Small', status: 'active' }, { id: 'l', name: 'Large', status: 'active' }, { id: 'xl', name: 'Huge', status: 'archived' }] },
    { id: 'temp', name: 'Temperature', status: 'active', values: [{ id: 'hot', name: 'Hot', status: 'active' }, { id: 'iced', name: 'Iced', status: 'active' }] },
  ],
  variations: [
    { id: 'v1', valueIds: ['s', 'hot'], label: 'Small, Hot', priceMinor: 350, status: 'active', sellable: true },
    { id: 'v2', valueIds: ['s', 'iced'], label: 'Small, Iced', priceMinor: 375, status: 'active', sellable: true },
    { id: 'v3', valueIds: ['l', 'hot'], label: 'Large, Hot', priceMinor: 425, status: 'active', sellable: true },
    // Large, Iced is missing: say a value was added after the item was last saved.
    { id: 'v9', valueIds: ['xl', 'hot'], label: 'Huge, Hot', priceMinor: 500, status: 'active', sellable: false },
  ],
  modifierGroups: [{
    id: 'milk',
    name: 'Milk',
    status: 'active',
    minSelect: 1,
    maxSelect: 1,
    rulesOverridden: true,
    modifiers: [
      { id: 'oat', name: 'Oat', priceDeltaMinor: 60, defaultPriceDeltaMinor: 50, priceOverridden: true, isDefault: false, status: 'active' },
      { id: 'soy', name: 'Soy', priceDeltaMinor: 30, defaultPriceDeltaMinor: 40, priceOverridden: true, isDefault: false, status: 'archived' },
    ],
  }],
  availabilityRules: [{ id: 'rule-1', name: 'Breakfast', status: 'active' }],
  version: 7,
  createdAt: STAMP,
  updatedAt: STAMP,
}

const errorsOf = (form: ItemForm) => {
  const result = v.safeParse(itemFormSchema, form)
  return result.success ? [] : result.issues.map(issue => `${v.getDotPath(issue) ?? ''}: ${issue.message}`)
}

const valid = (): ItemForm => ({ ...toItemForm(), name: 'Tea', categoryId: 'cat-1', grid: [{ key: '', valueIds: [], label: '', price: 2, on: true }] })

describe('price grid', () => {
  it('has one version without option sets, and every combination with them (first set slowest)', () => {
    expect(buildGrid([], [], true)).toEqual([{ key: '', valueIds: [], label: '', price: undefined, on: true }])
    expect(buildGrid([SIZE, TEMP], [], true).map(c => c.label)).toEqual(['Small, Hot', 'Small, Iced', 'Large, Hot', 'Large, Iced'])
  })

  it('keeps prices and switches of the same combinations when the sets change', () => {
    const one = buildGrid([SIZE], [], true).map(cell => ({ ...cell, price: cell.label === 'Small' ? 3 : 4 }))
    // Reordering the sets keeps each combination (the key doesn't depend on order).
    const swapped = buildGrid([TEMP, SIZE], buildGrid([SIZE, TEMP], [{ ...one[0]!, key: 'hot,s', valueIds: ['s', 'hot'], price: 3.5 }], true), true)
    expect(swapped.find(c => c.label === 'Hot, Small')?.price).toBe(3.5)
    // A combination that wasn't there starts as given, without a price.
    expect(buildGrid([SIZE, TEMP], one, false).every(cell => cell.price === undefined && !cell.on)).toBe(true)
  })
})

describe('item form from an item', () => {
  it('rebuilds the grid from active values: missing combinations off, hidden versions left out', () => {
    const form = toItemForm(LATTE, [MILK])
    expect(form.grid.map(c => [c.label, c.price, c.on])).toEqual([
      ['Small, Hot', 3.5, true],
      ['Small, Iced', 3.75, true],
      ['Large, Hot', 4.25, true],
      ['Large, Iced', undefined, false],
    ])
    expect(form.optionSets[0]!.values.map(value => value.name)).toEqual(['Small', 'Large'])
  })

  it('keeps own rules, the library\'s rules for display, and prices in dollars', () => {
    const [milk] = toItemForm(LATTE, [MILK]).addOnGroups
    expect(milk).toMatchObject({ ownRules: true, minSelect: 1, maxSelect: 1, groupMinSelect: 0, groupMaxSelect: 1 })
    expect(milk!.addOns.map(a => [a.name, a.price, a.defaultPriceMinor])).toEqual([['Oat', 0.6, 50], ['Soy', 0.3, 40]])
  })

  it('sends everything back from the version it read, with cents and switches', () => {
    const body = toUpdateItemBody(toItemForm(LATTE, [MILK]), LATTE)
    expect(body).toMatchObject({ version: 7, categoryId: 'cat-1', name: 'Latte', imageId: 'img-1', optionSetIds: ['size', 'temp'], availabilityRuleIds: ['rule-1'] })
    expect(body.variations).toEqual([
      { valueIds: ['s', 'hot'], priceMinor: 350, status: 'active' },
      { valueIds: ['s', 'iced'], priceMinor: 375, status: 'active' },
      { valueIds: ['l', 'hot'], priceMinor: 425, status: 'active' },
      { valueIds: ['l', 'iced'], priceMinor: null, status: 'disabled' },
    ])
    // The archived add-on's own price goes back as it was read (the API accepts it).
    expect(body.modifierGroups).toEqual([{ groupId: 'milk', rules: { minSelect: 1, maxSelect: 1 }, prices: [{ modifierId: 'oat', priceDeltaMinor: 60 }, { modifierId: 'soy', priceDeltaMinor: 30 }] }])
  })

  it('an add-on price equal to the library\'s follows the library; library rules send null', () => {
    const form = toItemForm(LATTE, [MILK])
    form.addOnGroups[0]!.ownRules = false
    form.addOnGroups[0]!.addOns[0]!.price = 0.5
    expect(toUpdateItemBody(form, LATTE).modifierGroups).toEqual([{ groupId: 'milk', rules: null, prices: [{ modifierId: 'soy', priceDeltaMinor: 30 }] }])
  })

  it('no image is sent as null', () => {
    expect(toUpdateItemBody({ ...toItemForm(LATTE), imageId: undefined, imageUrl: undefined }, LATTE).imageId).toBeNull()
  })
})

describe('item form from the libraries', () => {
  it('takes an option set\'s active values, and an add-on group\'s active add-ons at their prices', () => {
    const set: OptionSet = { id: 'size', name: 'Size', status: 'active', values: [{ id: 's', name: 'Small', sortOrder: 1, status: 'active' }, { id: 'x', name: 'Old', sortOrder: 2, status: 'archived' }], itemCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP }
    expect(optionSetFromLibrary(set).values).toEqual([{ id: 's', name: 'Small' }])
    const group = addOnGroupFromLibrary(MILK)
    expect(group).toMatchObject({ ownRules: false, minSelect: 0, maxSelect: 1 })
    expect(group.addOns.map(a => [a.name, a.price])).toEqual([['Oat', 0.5]])
  })

  it('creates a draft body with no own prices for library prices', () => {
    const form = { ...valid(), addOnGroups: [addOnGroupFromLibrary(MILK)] }
    expect(toCreateItemBody(form)).toEqual({
      categoryId: 'cat-1',
      name: 'Tea',
      description: '',
      imageId: null,
      optionSetIds: [],
      variations: [{ valueIds: [], priceMinor: 200, status: 'active' }],
      modifierGroups: [{ groupId: 'milk', rules: null, prices: [] }],
      availabilityRuleIds: [],
    })
  })
})

describe('item form rules', () => {
  it('accepts a valid form', () => {
    expect(errorsOf(valid())).toEqual([])
  })

  it('needs a name, a category, a price on every version that\'s on, and one version on', () => {
    expect(errorsOf({ ...valid(), name: ' ', categoryId: undefined })).toEqual(['name: Name is required', 'categoryId: Category is required'])
    expect(errorsOf({ ...valid(), grid: [{ key: '', valueIds: [], label: '', price: undefined, on: true }] })).toEqual(['grid.0.price: Set a price, or switch it off'])
    expect(errorsOf({ ...valid(), grid: [{ key: '', valueIds: [], label: '', price: 2, on: false }] })).toEqual(['grid: Switch on at least one version'])
    expect(errorsOf({ ...valid(), grid: [{ key: '', valueIds: [], label: '', price: 1000.01, on: true }] })).toEqual(['grid.0.price: At most $1,000'])
  })

  it('checks own rules like the server, with its message, on the field it names', () => {
    const group = { ...addOnGroupFromLibrary(MILK), ownRules: true, minSelect: 2, maxSelect: null }
    expect(errorsOf({ ...valid(), addOnGroups: [group] })).toEqual(['addOnGroups.0.minSelect: Customers must choose 2, but only 1 add-on is active.'])
    expect(errorsOf({ ...valid(), addOnGroups: [{ ...group, minSelect: 1, maxSelect: 1 }] })).toEqual([])
    // The library's rules aren't the item's to check.
    expect(errorsOf({ ...valid(), addOnGroups: [{ ...group, ownRules: false }] })).toEqual([])
  })
})
