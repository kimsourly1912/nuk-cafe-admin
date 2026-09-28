import type { ItemStatus, MenuItemSummary } from '#shared/contracts/menu-items'
import { formatMinor } from '~/utils/money'

/** The API's `active` is "Published" on screen: the item is on the customers' menu. */
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = { draft: 'Draft', active: 'Published', archived: 'Archived' }

/** "$3.50", "$3.50–$4.25", or "No price" when nothing is sellable. */
export function priceRange(item: Pick<MenuItemSummary, 'priceMinMinor' | 'priceMaxMinor'>): string {
  if (item.priceMinMinor === null) return 'No price'
  if (item.priceMaxMinor === null || item.priceMaxMinor === item.priceMinMinor) return formatMinor(item.priceMinMinor)
  return `${formatMinor(item.priceMinMinor)}–${formatMinor(item.priceMaxMinor)}`
}
