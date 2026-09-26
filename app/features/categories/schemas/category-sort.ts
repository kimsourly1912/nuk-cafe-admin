import type { Category } from '#shared/contracts/menu'

/** Server order: `sortOrder` ascending, then name, so equal numbers still have a stable order. */
export function bySortOrder(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/**
 * Keeps a local order in line with the latest list: ids that no longer exist are dropped, new
 * ones are appended. So a save never sends a partial or stale list, even if another tab added or
 * deleted a category while this order was being edited.
 */
export function mergeOrder(current: string[], available: string[]): string[] {
  const kept = current.filter(id => available.includes(id))
  return [...kept, ...available.filter(id => !kept.includes(id))]
}

/** Moves one entry; out-of-range moves return the list unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length || from < 0 || from >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}
