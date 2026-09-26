/**
 * Short list for confirmations and summaries: "Coffee, Tea, Latte and 3 more".
 */
export function previewList(items: string[], max = 5): string {
  if (items.length <= max) return items.join(', ')
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}

/** "1 category" / "3 categories" */
export function pluralize(count: number, [one, many]: [string, string]): string {
  return `${count} ${count === 1 ? one : many}`
}
