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

/** "+12%", "−8%", or nothing when there's nothing to compare with. */
export function changeText(current: number, previous: number): { text: string, up: boolean } | null {
  if (previous <= 0) return null
  const percent = Math.round(((current - previous) / previous) * 100)
  return { text: `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}%`, up: percent >= 0 }
}
