import type { Category, Product } from '#shared/contracts/menu'

export interface MenuSection {
  /** Category id. */
  key: string
  /** "Coffee" or "Coffee › Iced" for a sub-category. */
  title: string
  products: Product[]
}

/**
 * Menu items grouped by category, in the order customers see them: main categories by their sort
 * order, each followed by its sub-categories by theirs; items by their own sort order, then name.
 * `categories` (all of them) supplies the sort orders and parents; a product's embedded category
 * is the fallback for one that isn't listed (placed after the known ones).
 */
export function menuSections(products: Product[], categories: Category[]): MenuSection[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const sections = new Map<string, MenuSection & { order: (number | string)[] }>()

  for (const product of products) {
    const known = byId.get(product.category.id)
    const key = product.category.id
    if (!sections.has(key)) {
      const parent = known?.parentId ? byId.get(known.parentId) : undefined
      const main = parent ?? known
      sections.set(key, {
        key,
        title: parent ? `${parent.name} › ${known!.name}` : (known?.name ?? product.category.name),
        // Main's position first, then subs right after their main (a main's own items first).
        order: main
          ? [main.sortOrder, main.id, parent ? known!.sortOrder : -1, key]
          : [Number.MAX_SAFE_INTEGER, product.category.name, -1, key],
        products: [],
      })
    }
    sections.get(key)!.products.push(product)
  }

  const compare = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < a.length; i++) {
      const [x, y] = [a[i]!, b[i]!]
      const diff = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      if (diff) return diff
    }
    return 0
  }
  return [...sections.values()]
    .sort((a, b) => compare(a.order, b.order))
    .map(({ order: _, ...section }) => ({
      ...section,
      products: section.products.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }))
}
