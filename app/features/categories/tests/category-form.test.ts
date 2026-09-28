import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { categoryFormSchema, toCategoryForm, toCreateCategoryBody, toUpdateCategoryBody } from '../schemas/category-form'

describe('category form', () => {
  const existing: MenuCategory = {
    id: 'c7',
    name: 'Coffee',
    description: 'Hot and iced',
    parentId: 'c1',
    status: 'active',
    sortOrder: 3,
    childCount: 0,
    itemCount: 0,
    availabilityRules: [{ id: 'r1', name: 'Breakfast', status: 'active' }, { id: 'r2', name: 'Old', status: 'archived' }],
    version: 4,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  }

  it('starts a new category as a main one, with no description or rules', () => {
    expect(toCategoryForm()).toEqual({ name: '', description: '', parentId: undefined, availabilityRuleIds: [] })
  })

  it('fills the form from an existing category, keeping an archived rule it uses', () => {
    expect(toCategoryForm(existing)).toEqual({ name: 'Coffee', description: 'Hot and iced', parentId: 'c1', availabilityRuleIds: ['r1', 'r2'] })
  })

  it('creates with an explicit null parent for a main category, text trimmed', () => {
    expect(toCreateCategoryBody({ name: ' Tea ', description: ' ', parentId: undefined, availabilityRuleIds: ['r1'] }))
      .toEqual({ name: 'Tea', description: '', parentId: null, availabilityRuleIds: ['r1'] })
  })

  it('updates from the version it was opened with; no parent moves it to the top level', () => {
    const body = toUpdateCategoryBody({ name: 'Tea', description: '', parentId: undefined, availabilityRuleIds: [] }, existing)
    expect(body).toEqual({ version: 4, name: 'Tea', description: '', parentId: null, availabilityRuleIds: [] })
  })

  it('rejects a blank name and a long description', () => {
    const issues = v.safeParse(categoryFormSchema, { name: '   ', description: 'x'.repeat(501), availabilityRuleIds: [] }).issues?.map(i => v.getDotPath(i))
    expect(issues).toEqual(['name', 'description'])
  })
})
