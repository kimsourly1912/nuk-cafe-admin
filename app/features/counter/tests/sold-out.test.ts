import { describe, expect, it } from 'vitest'
import type { SoldOutList } from '#shared/contracts/menu-sold-out'
import type { PublicMenu, PublicMenuItem } from '#shared/contracts/public-menu'
import { filterSoldOutRows, groupSoldOutRows, rowName, soldOutCategories, soldOutRows } from '../utils/sold-out'

const item = (id: string, name: string, versions: [string, string, boolean][]): PublicMenuItem => ({
  id, name, description: '', imageUrl: null, image: null, optionSets: [], modifierGroups: [],
  variations: versions.map(([vid, label, soldOut]) => ({ id: vid, valueIds: [], label, priceMinor: 300, soldOut, regularPriceMinor: null, promotion: null })),
  soldOut: versions.every(v => v[2]),
  promotion: null,
})

const menu: PublicMenu = {
  branch: { id: 'b', name: 'Riverside', address: null, phone: null, timezone: 'Asia/Phnom_Penh', openNow: true, closesInMinutes: 600, nextOpening: null, pausedUntil: null },
  currency: 'USD',
  at: '2026-09-30T03:00:00.000Z',
  promotions: [],
  categories: [
    { id: 'coffee', name: 'Coffee', description: '', items: [], categories: [
      { id: 'iced', name: 'Iced', description: '', categories: [], items: [item('latte', 'Iced Latte', [['v1', 'Small', false], ['v2', 'Large', true]])] },
    ] },
    { id: 'bakery', name: 'Bakery', description: '', categories: [], items: [item('bread', 'Banana Bread', [['v3', '', false]])] },
  ],
}
const list: SoldOutList = { branchId: 'b', variations: [{ variationId: 'v2', itemId: 'latte', itemName: 'Iced Latte', label: 'Large', updatedAt: '2026-09-30T03:15:00.000Z', updatedBy: 'u1', updatedByName: 'Sophea Keo' }] }

describe('the Sold out page\'s rows (D105)', () => {
  it('one row per version, under its top-level category, with who switched it off and when', () => {
    const rows = soldOutRows(menu, list)
    expect(rows.map(r => [rowName(r), r.categoryName, r.soldOut, r.by])).toEqual([
      ['Iced Latte · Small', 'Coffee', false, null],
      ['Iced Latte · Large', 'Coffee', true, 'Sophea'],
      ['Banana Bread', 'Bakery', false, null],
    ])
    expect(rows[1]!.since).toBe('2026-09-30T03:15:00.000Z')
    expect(soldOutCategories(rows)).toEqual([{ id: 'coffee', name: 'Coffee' }, { id: 'bakery', name: 'Bakery' }])
  })

  it('filters by category, by name, and to the sold-out ones', () => {
    const rows = soldOutRows(menu, list)
    const names = (filter: Partial<Parameters<typeof filterSoldOutRows>[1]>) =>
      filterSoldOutRows(rows, { search: '', category: 'all', onlySoldOut: false, ...filter }).map(rowName)
    expect(names({ category: 'bakery' })).toEqual(['Banana Bread'])
    expect(names({ search: 'large' })).toEqual(['Iced Latte · Large'])
    expect(names({ onlySoldOut: true })).toEqual(['Iced Latte · Large'])
    expect(names({ onlySoldOut: true, keep: new Set(['v1']) })).toEqual(['Iced Latte · Small', 'Iced Latte · Large'])
  })

  it('takes sold out from the list once loaded, the menu\'s flag until then', () => {
    const stale = { ...list, variations: [] }
    expect(soldOutRows(menu, stale).map(r => r.soldOut)).toEqual([false, false, false])
    expect(soldOutRows(menu, null).map(r => r.soldOut)).toEqual([false, true, false])
  })
})

describe('the rows grouped by item', () => {
  const rows = soldOutRows(menu, list)
  const summary = (all: typeof rows) => groupSoldOutRows(all).map(g => [g.itemName, g.rows.map(r => r.label), g.single])

  it('versions of an item together under its name; an item without versions is a single row', () => {
    expect(summary(rows)).toEqual([['Iced Latte', ['Small', 'Large'], false], ['Banana Bread', [''], true]])
  })

  it('groups what is shown: filtered rows only, and an item with one version left keeps its heading', () => {
    const shown = filterSoldOutRows(rows, { search: '', category: 'all', onlySoldOut: true })
    expect(summary(shown)).toEqual([['Iced Latte', ['Large'], false]])
  })

  it('two items with the same name stay apart', () => {
    const twin = rows.map(r => (r.variationId === 'v3' ? { ...r, itemId: 'other', itemName: 'Iced Latte' } : r))
    expect(groupSoldOutRows(twin).map(g => g.itemId)).toEqual(['latte', 'other'])
  })
})
