import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { categoryFormSchema, toCategoryForm, toCategoryRequest } from '../schemas/category-form'

describe('category form', () => {
  const existing = {
    id: 7,
    categoryName: 'Coffee',
    mainCategoryId: 1,
    status: 'INACTIVE' as const,
    sortOrder: 3,
    nameI18n: { 'zh-HK': '咖啡' },
  }

  it('defaults a new category to active with no parent', () => {
    expect(toCategoryForm()).toEqual({ categoryName: '', mainCategoryId: undefined, status: 'ACTIVE' })
  })

  it('fills the form from an existing category', () => {
    expect(toCategoryForm(existing)).toEqual({ categoryName: 'Coffee', mainCategoryId: 1, status: 'INACTIVE' })
  })

  it('preserves fields the form does not edit', () => {
    const body = toCategoryRequest({ categoryName: 'Tea', mainCategoryId: undefined, status: 'ACTIVE' }, existing)
    expect(body).toEqual({
      categoryName: 'Tea',
      mainCategoryId: undefined,
      status: 'ACTIVE',
      nameI18n: { 'zh-HK': '咖啡' },
      sortOrder: 3,
    })
  })

  it('rejects a blank name', () => {
    const result = v.safeParse(categoryFormSchema, { categoryName: '   ', status: 'ACTIVE' })
    expect(result.success).toBe(false)
  })
})
