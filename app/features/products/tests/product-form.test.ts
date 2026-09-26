import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { newOption, newVariant, productFormSchema, toProductForm, toProductRequest, variantMismatches } from '../schemas/product-form'
import type { ProductForm } from '../schemas/product-form'
import { formatPrice, roundPrice } from '../utils/money'

const existing = {
  id: 162,
  productName: 'Chicken Combo',
  description: 'Three pieces',
  price: 16.99,
  status: 'ACTIVE' as const,
  category: { id: 231, categoryName: 'For You' },
  imageUrl: 'https://s3.example/product/a',
  imageUuid: 'file-1',
  scheduleIds: [30, 37],
  sortOrder: 4,
  nameI18n: { km: 'ឈុតមាន់' },
  descriptionI18n: { 'zh-HK': '三件' },
  // Out of order on purpose: the request keeps the display order (sortOrder).
  variants: [
    { id: 44, variantName: 'Side', requiredSelection: false, allowMultipleSelection: true, sortOrder: 1, options: [{ id: 80, optionName: 'Fries', price: 5.79, sortOrder: 0 }] },
    {
      id: 43,
      variantName: 'Drink',
      requiredSelection: true,
      allowMultipleSelection: false,
      sortOrder: 0,
      nameI18n: { km: 'ភេសជ្ជៈ' },
      options: [
        { id: 74, optionName: 'Tea', price: 0, sortOrder: 1 },
        { id: 73, optionName: 'Cola', price: 0, sortOrder: 0, labelI18n: { km: 'កូឡា' } },
      ],
    },
  ],
}

const valid: ProductForm = {
  productName: 'Latte',
  categoryId: 1,
  price: 3.5,
  description: '',
  scheduleIds: [],
  status: 'ACTIVE',
  imageUrl: undefined,
  imageUuid: undefined,
  variants: [],
}

function errorsOf(input: unknown) {
  const result = v.safeParse(productFormSchema, input)
  return result.success ? [] : result.issues.map(i => i.message)
}

describe('product form', () => {
  it('defaults a new product to active with nothing chosen', () => {
    expect(toProductForm()).toEqual({
      productName: '',
      categoryId: undefined,
      price: undefined,
      description: '',
      scheduleIds: [],
      status: 'ACTIVE',
      imageUrl: undefined,
      imageUuid: undefined,
      variants: [],
    })
  })

  it('fills the form from a list row', () => {
    expect(toProductForm(existing)).toEqual({
      productName: 'Chicken Combo',
      categoryId: 231,
      price: 16.99,
      description: 'Three pieces',
      scheduleIds: [30, 37],
      status: 'ACTIVE',
      imageUrl: 'https://s3.example/product/a',
      imageUuid: 'file-1',
      // Groups and options in display order, keyed by id.
      variants: [
        { key: 'variant:43', id: 43, variantName: 'Drink', requiredSelection: true, allowMultipleSelection: false, options: [
          { key: 'option:73', id: 73, optionName: 'Cola', price: 0 },
          { key: 'option:74', id: 74, optionName: 'Tea', price: 0 },
        ] },
        { key: 'variant:44', id: 44, variantName: 'Side', requiredSelection: false, allowMultipleSelection: true, options: [
          { key: 'option:80', id: 80, optionName: 'Fries', price: 5.79 },
        ] },
      ],
    })
    // Two forms of the same product compare equal (no random keys), so nothing looks unsaved.
    expect(toProductForm(existing)).toEqual(toProductForm(existing))
  })

  it('re-sends untouched variants with their ids, in display order, plus translations and image', () => {
    const body = toProductRequest({ ...toProductForm(existing), productName: 'Combo', scheduleIds: [37] }, existing)
    expect(body).toEqual({
      productName: 'Combo',
      categoryId: 231,
      price: 16.99,
      description: 'Three pieces',
      scheduleIds: [37],
      status: 'ACTIVE',
      imageUrl: 'https://s3.example/product/a',
      imageUuid: 'file-1',
      nameI18n: { km: 'ឈុតមាន់' },
      descriptionI18n: { 'zh-HK': '三件' },
      variants: [
        {
          id: 43,
          variantName: 'Drink',
          requiredSelection: true,
          allowMultipleSelection: false,
          nameI18n: { km: 'ភេសជ្ជៈ' },
          options: [
            { id: 73, optionName: 'Cola', price: 0, labelI18n: { km: 'កូឡា' } },
            { id: 74, optionName: 'Tea', price: 0, labelI18n: undefined },
          ],
        },
        {
          id: 44,
          variantName: 'Side',
          requiredSelection: false,
          allowMultipleSelection: true,
          nameI18n: undefined,
          options: [{ id: 80, optionName: 'Fries', price: 5.79, labelI18n: undefined }],
        },
      ],
    })
  })

  it('sends the edited list: kept rows with ids, new rows without, removed rows left out, order as shown', () => {
    const form = toProductForm(existing)
    const [drink, side] = form.variants
    drink!.options.reverse() // Tea, Cola
    drink!.options[0]!.optionName = 'Green tea'
    drink!.options.push({ ...newOption(), optionName: 'Juice', price: 1.005 })
    const extra = { ...newVariant(), variantName: 'Sauce', options: [{ ...newOption(), optionName: 'Chili' }] }
    form.variants = [extra, drink!] // Side removed, Sauce added first
    void side

    expect(toProductRequest(form, existing).variants).toEqual([
      { id: undefined, variantName: 'Sauce', requiredSelection: false, allowMultipleSelection: false, nameI18n: undefined, options: [
        { id: undefined, optionName: 'Chili', price: 0, labelI18n: undefined },
      ] },
      { id: 43, variantName: 'Drink', requiredSelection: true, allowMultipleSelection: false, nameI18n: { km: 'ភេសជ្ជៈ' }, options: [
        { id: 74, optionName: 'Green tea', price: 0, labelI18n: undefined },
        { id: 73, optionName: 'Cola', price: 0, labelI18n: { km: 'កូឡា' } },
        { id: undefined, optionName: 'Juice', price: 1.01, labelI18n: undefined },
      ] },
    ])
  })

  it('sends no variants for a new product and a replaced image as uploaded', () => {
    const body = toProductRequest({ ...valid, imageUrl: 'https://s3.example/new', imageUuid: 'file-2' })
    expect(body.variants).toEqual([])
    expect(body).toMatchObject({ imageUrl: 'https://s3.example/new', imageUuid: 'file-2' })
  })

  it('rounds the price to cents', () => {
    expect(toProductRequest({ ...valid, price: 0.1 + 0.2 }).price).toBe(0.3)
    expect(roundPrice(6.225)).toBe(6.23)
    // 1.005 * 100 is 100.4999… in floating point: a naive round gives 1.
    expect(roundPrice(1.005)).toBe(1.01)
    expect(roundPrice(1.004)).toBe(1)
    expect(roundPrice(16.99)).toBe(16.99)
  })

  it('accepts a valid form', () => {
    expect(errorsOf(valid)).toEqual([])
    expect(errorsOf({ ...valid, price: 0 })).toEqual([])
  })

  it('requires a name, a category and a price', () => {
    expect(errorsOf({ ...valid, productName: ' ', categoryId: undefined, price: undefined })).toEqual([
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
  })
})

describe('variantMismatches', () => {
  const sent = [
    { variantName: 'Drink', options: [{ optionName: 'Cola' }, { optionName: 'Tea' }] },
    { variantName: 'Side', options: [{ optionName: 'Fries' }] },
  ]
  const saved = (variants: { name: string, options: string[] }[]) => variants.map((v, i) => ({
    id: 100 + i, // new ids are fine: compared by name
    variantName: v.name,
    sortOrder: i,
    options: v.options.map((o, j) => ({ id: 200 + j, optionName: o, sortOrder: j })),
  }))

  it('finds nothing when the server saved what was sent, whatever the ids', () => {
    expect(variantMismatches(sent, saved([{ name: 'Drink', options: ['Cola', 'Tea'] }, { name: 'Side', options: ['Fries'] }]))).toEqual([])
  })

  it('reports a removed group or option the server kept, and missing ones', () => {
    expect(variantMismatches(sent, saved([
      { name: 'Drink', options: ['Cola', 'Tea', 'Water'] },
      { name: 'Side', options: ['Fries'] },
      { name: 'Sauce', options: ['Chili'] },
    ]))).toEqual(['"Sauce" is still there', '"Drink › Water" is still there'])
    expect(variantMismatches(sent, saved([{ name: 'Drink', options: ['Cola'] }]))).toEqual(['"Side" is missing', '"Drink › Tea" is missing'])
  })

  it('reports an order that was not saved', () => {
    expect(variantMismatches(sent, saved([{ name: 'Side', options: ['Fries'] }, { name: 'Drink', options: ['Tea', 'Cola'] }])))
      .toEqual(['The order of the groups wasn\'t saved', 'The order of the options in "Drink" wasn\'t saved'])
  })

  it('cannot check without variants in the response', () => {
    expect(variantMismatches(sent, undefined)).toEqual([])
  })
})
