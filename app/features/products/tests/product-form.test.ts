import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Product } from '#shared/contracts/menu'
import { newOption, newVariant, productFormSchema, toCreateProductBody, toProductForm, toUpdateProductBody } from '../schemas/product-form'
import type { ProductForm } from '../schemas/product-form'
import { formatMinor, formatPrice, roundPrice, toMinor } from '~/utils/money'

const existing: Product = {
  id: 'p162',
  name: 'Chicken Combo',
  description: 'Three pieces',
  priceMinor: 1699,
  currency: 'USD',
  status: 'ACTIVE',
  category: { id: 'c231', name: 'For You', parentId: null, status: 'ACTIVE' },
  image: { id: 'a1', url: '/media/menu/a.png' },
  scheduleIds: ['s30', 's37'],
  sortOrder: 4,
  version: 5,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  // In display order, as the API returns them.
  variantGroups: [
    { id: 'g43', name: 'Drink', minSelect: 1, maxSelect: 1, options: [
      { id: 'o73', name: 'Cola', priceDeltaMinor: 0 },
      { id: 'o74', name: 'Tea', priceDeltaMinor: 0 },
    ] },
    { id: 'g44', name: 'Side', minSelect: 0, maxSelect: null, options: [{ id: 'o80', name: 'Fries', priceDeltaMinor: 579 }] },
  ],
}

const valid: ProductForm = {
  name: 'Latte',
  categoryId: 'c1',
  price: 3.5,
  description: '',
  scheduleIds: [],
  status: 'ACTIVE',
  imageUrl: undefined,
  imageAssetId: undefined,
  variants: [],
}

function errorsOf(input: unknown) {
  const result = v.safeParse(productFormSchema, input)
  return result.success ? [] : result.issues.map(i => i.message)
}

describe('product form', () => {
  it('defaults a new product to active with nothing chosen', () => {
    expect(toProductForm()).toEqual({
      name: '',
      categoryId: undefined,
      price: undefined,
      description: '',
      scheduleIds: [],
      status: 'ACTIVE',
      imageUrl: undefined,
      imageAssetId: undefined,
      variants: [],
    })
  })

  it('fills the form from a menu item, prices in dollars', () => {
    expect(toProductForm(existing)).toEqual({
      name: 'Chicken Combo',
      categoryId: 'c231',
      price: 16.99,
      description: 'Three pieces',
      scheduleIds: ['s30', 's37'],
      status: 'ACTIVE',
      imageUrl: '/media/menu/a.png',
      imageAssetId: 'a1',
      variants: [
        { key: 'variant:g43', id: 'g43', variantName: 'Drink', requiredSelection: true, allowMultipleSelection: false, options: [
          { key: 'option:o73', id: 'o73', optionName: 'Cola', price: 0 },
          { key: 'option:o74', id: 'o74', optionName: 'Tea', price: 0 },
        ] },
        { key: 'variant:g44', id: 'g44', variantName: 'Side', requiredSelection: false, allowMultipleSelection: true, options: [
          { key: 'option:o80', id: 'o80', optionName: 'Fries', price: 5.79 },
        ] },
      ],
    })
    // Two forms of the same product compare equal (no random keys), so nothing looks unsaved.
    expect(toProductForm(existing)).toEqual(toProductForm(existing))
  })

  it('updates from the version it was opened with, in cents, variants with their ids', () => {
    const body = toUpdateProductBody({ ...toProductForm(existing), name: 'Combo', scheduleIds: ['s37'] }, existing)
    expect(body).toEqual({
      version: 5,
      name: 'Combo',
      categoryId: 'c231',
      priceMinor: 1699,
      description: 'Three pieces',
      scheduleIds: ['s37'],
      status: 'ACTIVE',
      imageAssetId: 'a1',
      variantGroups: [
        { id: 'g43', name: 'Drink', minSelect: 1, maxSelect: 1, options: [
          { id: 'o73', name: 'Cola', priceDeltaMinor: 0 },
          { id: 'o74', name: 'Tea', priceDeltaMinor: 0 },
        ] },
        { id: 'g44', name: 'Side', minSelect: 0, maxSelect: null, options: [{ id: 'o80', name: 'Fries', priceDeltaMinor: 579 }] },
      ],
    })
  })

  it('sends the edited list: kept rows with ids, new rows without, removed rows left out, order as shown', () => {
    const form = toProductForm(existing)
    const [drink] = form.variants
    drink!.options.reverse() // Tea, Cola
    drink!.options[0]!.optionName = 'Green tea'
    drink!.options.push({ ...newOption(), optionName: 'Juice', price: 1.005 })
    const extra = { ...newVariant(), variantName: 'Sauce', options: [{ ...newOption(), optionName: 'Chili' }] }
    form.variants = [extra, drink!] // Side removed, Sauce added first

    expect(toUpdateProductBody(form, existing).variantGroups).toEqual([
      { name: 'Sauce', minSelect: 0, maxSelect: 1, options: [{ name: 'Chili', priceDeltaMinor: 0 }] },
      { id: 'g43', name: 'Drink', minSelect: 1, maxSelect: 1, options: [
        { id: 'o74', name: 'Green tea', priceDeltaMinor: 0 },
        { id: 'o73', name: 'Cola', priceDeltaMinor: 0 },
        { name: 'Juice', priceDeltaMinor: 101 },
      ] },
    ])
  })

  it('maps the two switches to min/max, keeping a stored limit the form cannot show', () => {
    const pickTwo: Product = { ...existing, variantGroups: [{ ...existing.variantGroups[1]!, minSelect: 2, maxSelect: 3 }] }
    const form = toProductForm(pickTwo)
    expect(toUpdateProductBody(form, pickTwo).variantGroups?.[0]).toMatchObject({ minSelect: 2, maxSelect: 3 })
    form.variants[0]!.allowMultipleSelection = false
    expect(toUpdateProductBody(form, pickTwo).variantGroups?.[0]).toMatchObject({ minSelect: 1, maxSelect: 1 })
  })

  it('creates with cents and clears a removed image with null', () => {
    expect(toCreateProductBody({ ...valid, price: 0.1 + 0.2 })).toMatchObject({ priceMinor: 30, imageAssetId: null, variantGroups: [] })
    expect(toUpdateProductBody({ ...toProductForm(existing), imageUrl: undefined, imageAssetId: undefined }, existing).imageAssetId).toBeNull()
  })

  it('rounds prices to whole cents', () => {
    expect(toMinor(6.225)).toBe(623)
    // 1.005 * 100 is 100.4999… in floating point: a naive round gives 100.
    expect(toMinor(1.005)).toBe(101)
    expect(toMinor(1.004)).toBe(100)
    expect(roundPrice(16.99)).toBe(16.99)
  })

  it('accepts a valid form', () => {
    expect(errorsOf(valid)).toEqual([])
    expect(errorsOf({ ...valid, price: 0 })).toEqual([])
  })

  it('requires a name, a category and a price', () => {
    expect(errorsOf({ ...valid, name: ' ', categoryId: undefined, price: undefined })).toEqual([
      'Name is required',
      'Category is required',
      'Price is required',
    ])
  })

  it('requires a group name, option names and prices, and at least one option', () => {
    const variant = { ...newVariant(), options: [{ ...newOption(), price: undefined }] }
    expect(errorsOf({ ...valid, variants: [variant] })).toEqual(['Group name is required', 'Option name is required', 'Price is required'])
    expect(errorsOf({ ...valid, variants: [{ ...newVariant(), variantName: 'Milk', options: [] }] })).toEqual(['Add at least one option'])
  })

  it('bounds the price', () => {
    expect(errorsOf({ ...valid, price: -1 })).toEqual(['Between $0 and $10,000'])
    expect(errorsOf({ ...valid, price: 10_001 })).toEqual(['Between $0 and $10,000'])
  })
})

describe('prices', () => {
  it('formats US dollars with cents', () => {
    expect(formatPrice(6.2)).toBe('$6.20')
    expect(formatPrice(1234.5)).toBe('$1,234.50')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(undefined)).toBe('—')
    expect(formatMinor(620)).toBe('$6.20')
  })
})
