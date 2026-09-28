import type { OptionSet } from '#shared/contracts/menu-options'

/**
 * What the Options page and editor show in words (D73). Pure, so the wording is unit-tested once.
 */

/**
 * Whether a set matches the search, by its name or an active value's name (case and spaces
 * ignored). `values` are the active values that match, for the card's "Matches: Oat" line.
 * Archived values don't match: they aren't on the card either.
 */
export function searchOptionSet(set: OptionSet, search: string): { values: string[] } | null {
  const term = search.trim().toLowerCase()
  if (!term) return { values: [] }
  const values = set.values.filter(value => value.status === 'active' && value.name.toLowerCase().includes(term)).map(value => value.name)
  if (!values.length && !set.name.toLowerCase().includes(term)) return null
  return { values }
}

/** "Used by 3 menu items", "Used by 1 menu item" or "Unused". */
export function usageLabel(itemCount: number) {
  return itemCount ? `Used by ${itemCount} ${itemCount === 1 ? 'menu item' : 'menu items'}` : 'Unused'
}

/** "1 value", "3 values". */
export function valueCountLabel(count: number) {
  return `${count} ${count === 1 ? 'value' : 'values'}`
}

/** The set-archive confirmation: what happens to the items that use it. */
export function archiveSetDescription(itemCount: number) {
  return itemCount
    ? `${itemCount} ${itemCount === 1 ? 'menu item uses' : 'menu items use'} this set and will keep it, but it cannot be added to other items until restored.`
    : 'This set cannot be added to menu items until restored.'
}

/** `list` with the entry at `from` moved to `to` (a new array; out-of-range moves change nothing). */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}
