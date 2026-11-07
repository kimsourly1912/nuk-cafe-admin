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
  if (category.itemCount) return itemsLabel(category.itemCount)
  return 'Empty'
}

/** A category's status badge (All and Archived views), everywhere a category is listed. */
export function statusBadge(status: MenuCategory['status']) {
  return status === 'archived'
    ? { label: 'Archived', icon: 'i-lucide-archive', color: 'neutral' as const, variant: 'subtle' as const }
    : { label: 'Active', icon: 'i-lucide-circle-check', color: 'success' as const, variant: 'subtle' as const }
}

/** Menu items filtered to a category, and a new one already in it (paths inside the cafe). */
export const manageItemsPath = (categoryId: string) => `/admin/products?categoryId=${categoryId}`
export const newItemPath = (categoryId: string) => `/admin/products/new?categoryId=${categoryId}`

const itemsLabel = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`

type Contents = Pick<MenuCategory, 'childCount' | 'itemCount'>

/** A main category's items: its own, or those of its active subcategories (never both, D44). */
function totalItems(main: Contents, activeSubs: Pick<MenuCategory, 'itemCount'>[]) {
  return activeSubs.reduce((total, sub) => total + sub.itemCount, main.itemCount)
}

/** A main category's card: "6 subcategories · 32 items", or `contentsLabel` when there's one figure. */
export function mainContentsLabel(main: Contents, activeSubs: Pick<MenuCategory, 'itemCount'>[]): string {
  const items = totalItems(main, activeSubs)
  return main.childCount && items ? `${contentsLabel(main)} · ${itemsLabel(items)}` : contentsLabel(main)
}

/** A main category's banner: "32 items across 6 subcategories", or `contentsLabel` likewise. */
export function mainSummaryLabel(main: Contents, activeSubs: Pick<MenuCategory, 'itemCount'>[]): string {
  const items = totalItems(main, activeSubs)
  return main.childCount && items ? `${itemsLabel(items)} across ${contentsLabel(main)}` : contentsLabel(main)
}
