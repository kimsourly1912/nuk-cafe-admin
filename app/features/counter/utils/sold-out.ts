import type { SoldOutList } from '#shared/contracts/menu-sold-out'
import type { PublicMenu, PublicMenuCategory } from '#shared/contracts/public-menu'

/**
 * The counter's Sold out page (step 6.3c, D105): one row per version of every item the branch's
 * menu lists now ("Iced Latte · Large"), in the menu's order, with its top-level category and, when
 * switched off, since when and by whom. Pure, unit-tested.
 */

export interface SoldOutRow {
  variationId: string
  itemName: string
  /** "Large, Iced"; `''` for an item without versions. */
  label: string
  /** The top-level category, for the tabs and the column. */
  categoryId: string
  categoryName: string
  soldOut: boolean
  /** When switched off, and by whom (a first name), from the sold-out list. */
  since: string | null
  by: string | null
}

/** "Iced Latte · Large", or just the name. */
export const rowName = (row: Pick<SoldOutRow, 'itemName' | 'label'>) => (row.label ? `${row.itemName} · ${row.label}` : row.itemName)

/**
 * Sold out or not comes from the sold-out list once it's loaded (it's what the switch writes, so the
 * badge and "Since … by" never disagree), from the menu's flag until then.
 */
export function soldOutRows(menu: PublicMenu, list: SoldOutList | null): SoldOutRow[] {
  const switchedOff = new Map((list?.variations ?? []).map(v => [v.variationId, v]))
  const rows: SoldOutRow[] = []
  const walk = (category: PublicMenuCategory, top: PublicMenuCategory) => {
    for (const item of category.items) {
      for (const variation of item.variations) {
        const off = switchedOff.get(variation.id)
        rows.push({
          variationId: variation.id,
          itemName: item.name,
          label: variation.label,
          categoryId: top.id,
          categoryName: top.name,
          soldOut: list ? Boolean(off) : variation.soldOut,
          since: off?.updatedAt ?? null,
          by: off?.updatedByName?.trim().split(/\s+/)[0] ?? null,
        })
      }
    }
    for (const sub of category.categories) walk(sub, top)
  }
  for (const category of menu.categories) walk(category, category)
  return rows
}

/** The tabs: every top-level category that has a row. */
export function soldOutCategories(rows: SoldOutRow[]): { id: string, name: string }[] {
  const seen = new Map<string, string>()
  for (const row of rows) if (!seen.has(row.categoryId)) seen.set(row.categoryId, row.categoryName)
  return [...seen].map(([id, name]) => ({ id, name }))
}

export interface SoldOutFilter {
  search: string
  /** A category id, or `'all'`. */
  category: string
  onlySoldOut: boolean
  /**
   * Rows switched back on while showing only the sold-out ones: they stay until the filter changes,
   * so a slip can be undone where it happened.
   */
  keep?: ReadonlySet<string>
}

export function filterSoldOutRows(rows: SoldOutRow[], filter: SoldOutFilter): SoldOutRow[] {
  const q = filter.search.trim().toLowerCase()
  return rows.filter(row =>
    (filter.category === 'all' || row.categoryId === filter.category)
    && (!filter.onlySoldOut || row.soldOut || Boolean(filter.keep?.has(row.variationId)))
    && (!q || rowName(row).toLowerCase().includes(q)))
}
