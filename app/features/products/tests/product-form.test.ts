import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { productFormSchema, toProductForm, toProductRequest } from '../schemas/product-form'
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
    })
  })

  it('re-sends variants unchanged with their ids, in display order, plus translations and image', () => {
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

  it('sends no variants for a new product and a replaced image as uploaded', () => {
    const body = toProductRequest({ ...valid, imageUrl: 'https://s3.example/new', imageUuid: 'file-2' })
    expect(body.variants).toEqual([])
    expect(body).toMatchObject({ imageUrl: 'https://s3.example/new', imageUuid: 'file-2' })
  })

  it('rounds the price to cents', () => {
    expect(toProductRequest({ ...valid, price: 0.1 + 0.2 }).price).toBe(0.3)
    expect(roundPrice(6.225)).toBe(6.23)
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
