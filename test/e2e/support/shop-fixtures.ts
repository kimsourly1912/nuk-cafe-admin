import type { PublicBranch, PublicTable } from '../../../shared/contracts/branches'
import type { PublicMenu, PublicMenuCategory, PublicMenuItem, PublicMenuModifierGroup } from '../../../shared/contracts/public-menu'
import type { MockHandler } from './mock-api'
import { MockFailure } from './mock-api'

/**
 * The customer menu's fixtures (D93): one branch, Coffee (Hot, Iced), Tea and Bakery, with an item
 * of each kind the cards show: nothing to choose, versions, a required add-on group, sold out, no photo.
 */

export const BRANCH: PublicBranch = {
  id: 'branch-1',
  name: 'Riverside',
  address: '#123 St. 63',
  phone: null,
  timezone: 'Asia/Phnom_Penh',
  openNow: true,
  nextOpening: null,
}
export const CLOSED_BRANCH: PublicBranch = { ...BRANCH, openNow: false, nextOpening: { inDays: 0, weekday: 2, startMinute: 420 } }

let variationCount = 0
function itemOf(id: string, name: string, priceMinor: number, overrides: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id,
    name,
    description: '',
    imageUrl: `/media/menu/${id}.png`,
    optionSets: [],
    variations: [{ id: `${id}-v${++variationCount}`, valueIds: [], label: '', priceMinor, soldOut: false }],
    soldOut: false,
    modifierGroups: [],
    ...overrides,
  }
}

export const MILK: PublicMenuModifierGroup = {
  id: 'grp-milk',
  name: 'Milk',
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    { id: 'mod-whole', name: 'Whole', priceDeltaMinor: 0, isDefault: false },
    { id: 'mod-oat', name: 'Oat', priceDeltaMinor: 50, isDefault: false },
  ],
}
export const EXTRAS: PublicMenuModifierGroup = {
  id: 'grp-extras',
  name: 'Extras',
  minSelect: 0,
  maxSelect: 2,
  modifiers: [
    { id: 'mod-shot', name: 'Extra shot', priceDeltaMinor: 50, isDefault: false },
    { id: 'mod-vanilla', name: 'Vanilla syrup', priceDeltaMinor: 50, isDefault: false },
    { id: 'mod-cream', name: 'Whipped cream', priceDeltaMinor: 30, isDefault: false },
  ],
}

export const AMERICANO = itemOf('item-1', 'Americano', 350, { description: 'Espresso and hot water.' })
export const LATTE = itemOf('item-2', 'Latte', 450, {
  description: 'Espresso with steamed milk.',
  optionSets: [{ id: 'set-size', name: 'Size', values: [{ id: 'val-s', name: 'Small' }, { id: 'val-m', name: 'Medium' }, { id: 'val-l', name: 'Large' }] }],
  variations: [
    { id: 'var-latte-s', valueIds: ['val-s'], label: 'Small', priceMinor: 450, soldOut: false },
    { id: 'var-latte-m', valueIds: ['val-m'], label: 'Medium', priceMinor: 500, soldOut: false },
    { id: 'var-latte-l', valueIds: ['val-l'], label: 'Large', priceMinor: 550, soldOut: true },
  ],
  modifierGroups: [MILK, EXTRAS],
})
export const MOCHA = itemOf('item-3', 'Mocha', 500, { soldOut: true, variations: [{ id: 'var-mocha', valueIds: [], label: '', priceMinor: 500, soldOut: true }] })
export const FILTER = itemOf('item-4', 'Filter coffee', 300, { imageUrl: null })
export const ICED_LATTE = itemOf('item-5', 'Iced latte', 500, { description: 'Over ice.' })
export const COLD_BREW = itemOf('item-6', 'Cold brew', 450)
export const GREEN_TEA = itemOf('item-7', 'Green tea', 300)
export const MATCHA = itemOf('item-8', 'Matcha latte', 550, { description: 'Stone-ground matcha.' })
export const CROISSANT = itemOf('item-9', 'Croissant', 250)
export const MUFFIN = itemOf('item-10', 'Blueberry muffin', 300)

const category = (id: string, name: string, items: PublicMenuItem[], categories: PublicMenuCategory[] = []): PublicMenuCategory =>
  ({ id, name, description: '', items, categories })

export const COFFEE = category('cat-1', 'Coffee', [], [
  category('cat-11', 'Hot', [AMERICANO, LATTE, MOCHA, FILTER]),
  category('cat-12', 'Iced', [ICED_LATTE, COLD_BREW]),
])
export const TEA = category('cat-2', 'Tea', [GREEN_TEA, MATCHA])
export const BAKERY = category('cat-3', 'Bakery', [CROISSANT, MUFFIN])

export function menuOf(branch: PublicBranch = BRANCH, categories: PublicMenuCategory[] = [COFFEE, TEA, BAKERY]): PublicMenu {
  return { branch, currency: 'USD', at: '2026-09-29T02:00:00.000Z', categories }
}

export const TABLE: PublicTable = { branch: { id: BRANCH.id, name: BRANCH.name }, table: { id: 'table-1', label: '12' } }
/** A token as the server makes them: 22 characters (it has a digit, so the mock keys it as `{id}`). */
export const TABLE_TOKEN = 'AbCdEfGh1jKlMnOpQrStUv'

/** Handlers for the customer site: one branch and its menu. */
export function shopHandlers(menu: PublicMenu = menuOf()): Record<string, MockHandler> {
  return {
    'GET /public/branches': () => [menu.branch],
    'GET /public/menu': () => menu,
    'GET /public/tables/{id}': ({ url }) => {
      if (url.pathname.endsWith(TABLE_TOKEN)) return TABLE
      throw new MockFailure(404, 'NOT_FOUND', 'This table was not found.')
    },
  }
}
