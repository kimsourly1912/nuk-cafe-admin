import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Category } from '#shared/contracts/menu'
import { categoryFormSchema, toCategoryForm, toCreateCategoryBody, toUpdateCategoryBody } from '../schemas/category-form'

describe('category form', () => {
  const existing: Category = {
    id: 'c7',
    name: 'Coffee',
    parentId: 'c1',
    status: 'INACTIVE',
    sortOrder: 3,
    version: 4,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  }

  it('defaults a new category to active with no parent', () => {
    expect(toCategoryForm()).toEqual({ name: '', parentId: undefined, status: 'ACTIVE' })
  })

  it('fills the form from an existing category', () => {
    expect(toCategoryForm(existing)).toEqual({ name: 'Coffee', parentId: 'c1', status: 'INACTIVE' })
  })

  it('creates with an explicit null parent for a main category', () => {
    expect(toCreateCategoryBody({ name: 'Tea', parentId: undefined, status: 'ACTIVE' })).toEqual({ name: 'Tea', parentId: null, status: 'ACTIVE' })
  })

  it('updates from the version it was opened with, clearing the parent with null', () => {
    const body = toUpdateCategoryBody({ name: 'Tea', parentId: undefined, status: 'ACTIVE' }, existing)
    expect(body).toEqual({ version: 4, name: 'Tea', parentId: null, status: 'ACTIVE' })
  })

  it('rejects a blank name', () => {
    const result = v.safeParse(categoryFormSchema, { name: '   ', status: 'ACTIVE' })
    expect(result.success).toBe(false)
  })
})
