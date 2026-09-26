import { describe, expect, it } from 'vitest'
import type { Category, Product } from '#shared/contracts/menu'
import { menuSections } from '../utils/menu-sections'

const category = (id: string, name: string, sortOrder: number, parentId: string | null = null) =>
  ({ id, name, sortOrder, parentId, status: 'ACTIVE' }) as Category
const categories = [
  category('drinks', 'Drinks', 2),
  category('food', 'Food', 1),
  category('iced', 'Iced', 2, 'drinks'),
  category('hot', 'Hot', 1, 'drinks'),
]
const product = (id: string, name: string, categoryId: string, sortOrder = 0) => ({
  id,
  name,
  sortOrder,
  category: { id: categoryId, name: `embedded ${categoryId}`, parentId: null, status: 'ACTIVE' },
}) as Product

describe('menuSections', () => {
  it('orders sections like the menu: mains by sort order, each followed by its subs', () => {
    const sections = menuSections([
      product('1', 'Iced latte', 'iced'),
      product('2', 'Water', 'drinks'),
      product('3', 'Toast', 'food'),
      product('4', 'Tea', 'hot'),
    ], categories)
    expect(sections.map(s => s.title)).toEqual(['Food', 'Drinks', 'Drinks › Hot', 'Drinks › Iced'])
  })

  it('orders items by their sort order, then name', () => {
    const [section] = menuSections([product('1', 'B', 'food', 1), product('2', 'C', 'food', 0), product('3', 'A', 'food', 1)], categories)
    expect(section!.products.map(p => p.name)).toEqual(['C', 'A', 'B'])
  })

  it('names an unlisted category from the item and places it after known ones', () => {
    const sections = menuSections([product('1', 'Special', 'gone'), product('2', 'Toast', 'food')], categories)
    expect(sections.map(s => s.title)).toEqual(['Food', 'embedded gone'])
  })
})
