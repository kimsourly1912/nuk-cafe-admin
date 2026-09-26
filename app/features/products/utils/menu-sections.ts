import type { CategoryResponse, ProductResponse } from '~/generated/api'

export interface MenuSection {
  /** Category id, or `none` for items without one. */
  key: string
  /** "Coffee" or "Coffee › Iced" for a sub-category. */
  title: string
  products: ProductResponse[]
}

/**
 * Menu items grouped by category, in the order customers see them: main categories by their sort
 * order, each followed by its sub-categories by theirs; items by their own sort order, then name.
 * `categories` (all of them) supplies the sort orders and parents; a product's embedded category
 * is the fallback for one that isn't listed. Items without a category come last.
 */
export function menuSections(products: ProductResponse[], categories: CategoryResponse[]): MenuSection[] {
  const byId = new Map(categories.map(c => [c.id!, c]))
  const sections = new Map<string, MenuSection & { order: number[] }>()

  for (const product of products) {
    const category = product.category?.id === undefined ? undefined : (byId.get(product.category.id) ?? product.category)
    if (!category) {
      const none = sections.get('none') ?? { key: 'none', title: 'No category', order: [Infinity], products: [] }
      none.products.push(product)
      sections.set('none', none)
      continue
    }
    const key = String(category.id)
    if (!sections.has(key)) {
      const parent = category.mainCategoryId === undefined || category.mainCategoryId === null ? undefined : byId.get(category.mainCategoryId)
      const main = parent ?? category
      const parentName = parent?.categoryName ?? category.mainCategory?.categoryName
      // A category missing from the list has no known position: after the known ones.
      const known = byId.has(main.id!)
      sections.set(key, {
        key,
        title: parentName && category.mainCategoryId ? `${parentName} › ${category.categoryName}` : category.categoryName ?? `#${category.id}`,
        // Main's position first, then subs right after their main (a main's own items first).
        order: [known ? (main.sortOrder ?? 0) : Number.MAX_SAFE_INTEGER, main.id ?? 0, parent ? (category.sortOrder ?? 0) : -1, category.id ?? 0],
        products: [],
      })
    }
    sections.get(key)!.products.push(product)
  }

  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0)
      if (diff) return diff
    }
    return 0
  }
  return [...sections.values()]
    .sort((a, b) => compare(a.order, b.order))
    .map(({ order: _, ...section }) => ({
      ...section,
      products: section.products.sort((a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.productName ?? '').localeCompare(b.productName ?? '')),
    }))
}
