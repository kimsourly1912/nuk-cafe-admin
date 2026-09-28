import type { MenuCategory } from '#shared/contracts/menu-categories'

/**
 * How a category's availability reads in the list (D72). A top-level category without rules is
 * sold whenever the branch is open ("Always"). A sub-category without rules follows its parent's
 * rules, so it says "Inherits parent": claiming "Always" would be wrong when the parent limits it.
 * With rules: the first name, and how many more ("Breakfast +2"); `full` lists them all, with their
 * times when known (tooltip and screen readers).
 */
export interface AvailabilityLabel {
  label: string
  full: string
  /** No rules of its own. */
  unrestricted: boolean
}

export function availabilityLabel(
  category: Pick<MenuCategory, 'parentId' | 'availabilityRules'>,
  /** Each rule's times in words, by rule id ("Mon–Fri · 7:00 AM – 11:00 AM"), when loaded. */
  times: ReadonlyMap<string, string> = new Map(),
): AvailabilityLabel {
  const rules = category.availabilityRules
  if (!rules.length) {
    return category.parentId === null
      ? { label: 'Always', full: 'Sold whenever the branch is open', unrestricted: true }
      : { label: 'Inherits parent', full: 'Follows its parent category\'s availability', unrestricted: true }
  }
  const name = (rule: MenuCategory['availabilityRules'][number]) => rule.status === 'archived' ? `${rule.name} (archived)` : rule.name
  const detail = (rule: MenuCategory['availabilityRules'][number]) => {
    const when = times.get(rule.id)
    return when ? `${name(rule)} (${when})` : name(rule)
  }
  const [first, ...rest] = rules
  return {
    label: rest.length ? `${name(first!)} +${rest.length}` : name(first!),
    full: `Sold only during: ${rules.map(detail).join(', ')}`,
    unrestricted: false,
  }
}

/**
 * What a category holds (D72): subcategories or menu items, never both (D44). "2 subcategories",
 * "12 items" (drafts and published), or "Empty".
 */
export function contentsLabel(category: Pick<MenuCategory, 'childCount' | 'itemCount'>): string {
  if (category.childCount) return `${category.childCount} ${category.childCount === 1 ? 'subcategory' : 'subcategories'}`
  if (category.itemCount) return `${category.itemCount} ${category.itemCount === 1 ? 'item' : 'items'}`
  return 'Empty'
}

/**
 * The desktop columns (category · contains · availability · [status] · actions), shared by the
 * header and every row so they line up. Literal strings: Tailwind finds classes by scanning.
 */
export function rowColumns(showStatus: boolean) {
  return showStatus
    ? 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_11rem_7rem_3rem]'
    : 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_11rem_3rem]'
}
