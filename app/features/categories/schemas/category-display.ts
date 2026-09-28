import type { MenuCategory } from '#shared/contracts/menu-categories'

/**
 * How a category's availability reads in the list (D72). A top-level category without rules is
 * sold whenever the branch is open ("Always"). A sub-category without rules follows its parent's
 * rules, so it says "Inherits parent": claiming "Always" would be wrong when the parent limits it.
 * With rules: the first name, and how many more ("Breakfast +2"); `full` lists them all (tooltip).
 */
export interface AvailabilityLabel {
  label: string
  full: string
  /** No rules of its own. */
  unrestricted: boolean
}

export function availabilityLabel(category: Pick<MenuCategory, 'parentId' | 'availabilityRules'>): AvailabilityLabel {
  const names = category.availabilityRules.map(rule => rule.status === 'archived' ? `${rule.name} (archived)` : rule.name)
  if (!names.length) {
    return category.parentId === null
      ? { label: 'Always', full: 'Sold whenever the branch is open', unrestricted: true }
      : { label: 'Inherits parent', full: 'Follows its parent category\'s availability', unrestricted: true }
  }
  const [first, ...rest] = names
  return {
    label: rest.length ? `${first} +${rest.length}` : first!,
    full: `Sold only during: ${names.join(', ')}`,
    unrestricted: false,
  }
}

/** "1 subcategory", "3 subcategories"; `undefined` when there are none. */
export function subcategoryCount(count: number): string | undefined {
  if (!count) return undefined
  return `${count} ${count === 1 ? 'subcategory' : 'subcategories'}`
}

/**
 * The desktop columns (category · subcategories · availability · [status] · actions), shared by
 * the header and every row so they line up. Literal strings: Tailwind finds classes by scanning.
 */
export function rowColumns(showStatus: boolean) {
  return showStatus
    ? 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_11rem_7rem_3rem]'
    : 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_11rem_3rem]'
}
