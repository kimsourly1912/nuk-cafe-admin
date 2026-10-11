import { describe, expect, it } from 'vitest'
import { discountLabel, discountOff } from '#shared/contracts/menu-promotions'
import type { PublicMenuCategory, PublicMenuItem } from '#shared/contracts/public-menu'
import type { LivePromotion } from '#server/features/menu/promotions.rules'
import { applyPromotions, promotionPhase } from '#server/features/menu/promotions.rules'

// Promotions' pure rules (M1, D163): phases, and prices with the bigger discount winning.

const item = (id: string, prices: number[]): PublicMenuItem => ({
  id,
  name: id,
  description: '',
  imageUrl: null,
  image: null,
  optionSets: [],
  variations: prices.map((priceMinor, i) => ({ id: `${id}-${i}`, valueIds: [], label: '', priceMinor, soldOut: false, regularPriceMinor: null, promotion: null })),
  soldOut: false,
  modifierGroups: [],
  promotion: null,
})

/** Drinks (main) > Coffee (sub) > latte, mocha; Bakery (main) > bread. */
const menu = (): PublicMenuCategory[] => [
  { id: 'drinks', name: 'Drinks', description: '', items: [], categories: [
    { id: 'coffee', name: 'Coffee', description: '', categories: [], items: [item('latte', [300, 1000]), item('mocha', [275])] },
  ] },
  { id: 'bakery', name: 'Bakery', description: '', categories: [], items: [item('bread', [250])] },
]

const promotion = (id: string, over: Partial<LivePromotion> = {}): LivePromotion => ({
  id, name: id, description: '', discount: { kind: 'percent', percent: 10 }, scope: 'menu', itemIds: new Set(), categoryIds: new Set(), endsOn: null, posterUrl: null, ...over,
})

const items = (categories: PublicMenuCategory[]) => new Map(categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).map(i => [i.id, i]))

describe('discounts', () => {
  it('rounds a percent to the nearest cent, half up, and never takes more than the price', () => {
    expect(discountOff({ kind: 'percent', percent: 10 }, 275)).toBe(28)
    expect(discountOff({ kind: 'percent', percent: 15 }, 333)).toBe(50)
    expect(discountOff({ kind: 'percent', percent: 100 }, 250)).toBe(250)
    expect(discountOff({ kind: 'amount', amountMinor: 500 }, 300)).toBe(300)
    expect(discountOff({ kind: 'amount', amountMinor: 50 }, 0)).toBe(0)
  })

  it('labels a discount for customers', () => {
    expect(discountLabel({ kind: 'percent', percent: 20 })).toBe('20% off')
    expect(discountLabel({ kind: 'amount', amountMinor: 150 })).toBe('$1.50 off')
    expect(discountLabel({ kind: 'amount', amountMinor: 100_000 })).toBe('$1,000.00 off')
  })
})

describe('promotionPhase', () => {
  const today = '2026-10-15'
  it('reads draft, scheduled, live and ended by date or by hand', () => {
    expect(promotionPhase({ status: 'draft', startsOn: '2026-10-01', endsOn: null }, today)).toBe('draft')
    expect(promotionPhase({ status: 'published', startsOn: '2026-10-16', endsOn: null }, today)).toBe('scheduled')
    expect(promotionPhase({ status: 'published', startsOn: '2026-10-15', endsOn: '2026-10-15' }, today)).toBe('live')
    expect(promotionPhase({ status: 'published', startsOn: '2026-10-01', endsOn: null }, today)).toBe('live')
    expect(promotionPhase({ status: 'published', startsOn: '2026-10-01', endsOn: '2026-10-14' }, today)).toBe('ended')
    expect(promotionPhase({ status: 'ended', startsOn: '2026-10-01', endsOn: null }, today)).toBe('ended')
  })
})

describe('applyPromotions', () => {
  it('leaves the menu alone without promotions', () => {
    const categories = menu()
    expect(applyPromotions(categories, [])).toEqual({ categories, promotions: [] })
  })

  it('lowers every version on the whole menu, keeping the price before and the badge', () => {
    const { categories, promotions } = applyPromotions(menu(), [promotion('p1')])
    const latte = items(categories).get('latte')!
    expect(latte.variations.map(v => [v.priceMinor, v.regularPriceMinor, v.promotion?.label])).toEqual([[270, 300, '10% off'], [900, 1000, '10% off']])
    expect(latte.promotion).toEqual({ id: 'p1', name: 'p1', label: '10% off' })
    expect(promotions).toEqual([{ id: 'p1', name: 'p1', description: '', label: '10% off', endsOn: null, posterUrl: null, itemIds: ['latte', 'mocha', 'bread'] }])
  })

  it('applies to chosen items, and to a main category\'s sub-categories', () => {
    const byItem = items(applyPromotions(menu(), [promotion('p1', { scope: 'selected', itemIds: new Set(['bread']) })]).categories)
    expect([...byItem.values()].filter(i => i.promotion).map(i => i.id)).toEqual(['bread'])

    const byMain = items(applyPromotions(menu(), [promotion('p1', { scope: 'selected', categoryIds: new Set(['drinks']) })]).categories)
    expect([...byMain.values()].filter(i => i.promotion).map(i => i.id)).toEqual(['latte', 'mocha'])

    const bySub = items(applyPromotions(menu(), [promotion('p1', { scope: 'selected', categoryIds: new Set(['coffee']) })]).categories)
    expect(bySub.get('bread')!.promotion).toBeNull()
    expect(bySub.get('bread')!.variations[0]).toMatchObject({ priceMinor: 250, regularPriceMinor: null, promotion: null })
  })

  it('never adds two discounts: each version takes the bigger one', () => {
    const percent = promotion('percent', { discount: { kind: 'percent', percent: 10 } })
    const amount = promotion('amount', { scope: 'selected', itemIds: new Set(['latte']), discount: { kind: 'amount', amountMinor: 50 } })
    const latte = items(applyPromotions(menu(), [percent, amount]).categories).get('latte')!
    // $3.00: 10% is 30¢, $0.50 is more. $10.00: 10% is $1.00, more than $0.50.
    expect(latte.variations.map(v => [v.priceMinor, v.promotion?.id])).toEqual([[250, 'amount'], [900, 'percent']])
    // The badge: the biggest discount on any version.
    expect(latte.promotion?.id).toBe('percent')
  })

  it('gives a tie to the first promotion (the older one)', () => {
    const first = promotion('first', { discount: { kind: 'amount', amountMinor: 30 } })
    const second = promotion('second', { discount: { kind: 'percent', percent: 10 } })
    const latte = items(applyPromotions(menu(), [first, second]).categories).get('latte')!
    expect(latte.variations[0]!.promotion?.id).toBe('first')
  })

  it('lists only the promotions that lowered something', () => {
    const none = promotion('none', { scope: 'selected', itemIds: new Set(['nothing']) })
    expect(applyPromotions(menu(), [none]).promotions).toEqual([])
  })
})
