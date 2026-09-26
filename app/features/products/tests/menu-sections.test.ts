import { describe, expect, it } from 'vitest'
import { menuSections } from '../utils/menu-sections'

const categories = [
  { id: 1, categoryName: 'Drinks', sortOrder: 2 },
  { id: 2, categoryName: 'Food', sortOrder: 1 },
  { id: 3, categoryName: 'Iced', sortOrder: 2, mainCategoryId: 1 },
  { id: 4, categoryName: 'Hot', sortOrder: 1, mainCategoryId: 1 },
]
const product = (id: number, name: string, categoryId: number | undefined, sortOrder = 0) => ({
  id,
  productName: name,
  sortOrder,
  category: categoryId === undefined ? undefined : { id: categoryId, categoryName: `embedded ${categoryId}` },
})

describe('menuSections', () => {
  it('orders sections like the menu: mains by sort order, each followed by its subs', () => {
    const sections = menuSections([
      product(1, 'Iced latte', 3),
      product(2, 'Water', 1),
      product(3, 'Toast', 2),
      product(4, 'Tea', 4),
    ], categories)
    expect(sections.map(s => s.title)).toEqual(['Food', 'Drinks', 'Drinks › Hot', 'Drinks › Iced'])
  })

  it('orders items by their sort order, then name', () => {
    const [section] = menuSections([product(1, 'B', 2, 1), product(2, 'C', 2, 0), product(3, 'A', 2, 1)], categories)
    expect(section!.products.map(p => p.productName)).toEqual(['C', 'A', 'B'])
  })

  it('names an unlisted category from the item and places it after known ones; items without one last', () => {
    const sections = menuSections([product(1, 'Mystery', undefined), product(2, 'Special', 99), product(3, 'Toast', 2)], categories)
    expect(sections.map(s => s.title)).toEqual(['Food', 'embedded 99', 'No category'])
  })
})
