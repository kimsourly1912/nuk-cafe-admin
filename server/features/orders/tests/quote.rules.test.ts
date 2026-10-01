import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { OrderLineInput } from '#shared/contracts/orders'
import { checkoutQuoteSchema, orderLineInputSchema } from '#shared/contracts/orders'
import type { PublicMenu, PublicMenuItem } from '#shared/contracts/public-menu'
import { quoteOrder } from '#server/features/orders/quote.rules'

// Written examples (step 6.1's "totals match written examples", D98), on a hand-built menu:
// Iced Latte   Regular $3.00, Large $3.25; Milk: choose 1 (Whole $0, Oat $0.50); Extras: up to 2
//              (Extra shot $0.50, Vanilla $0.50, Caramel $0.50)
// Croissant    $2.50
// Khmer Iced Coffee  Regular $2.75

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
const ICED_LATTE = id(1)
const REGULAR = id(2)
const LARGE = id(3)
const MILK = id(4)
const WHOLE = id(5)
const OAT = id(6)
const EXTRAS = id(7)
const SHOT = id(8)
const VANILLA = id(9)
const CARAMEL = id(10)
const CROISSANT = id(11)
const CROISSANT_V = id(12)
const KHMER = id(13)
const KHMER_V = id(14)
const BRANCH = id(15)

const item = (over: Partial<PublicMenuItem> & Pick<PublicMenuItem, 'id' | 'name' | 'variations'>): PublicMenuItem =>
  ({ description: '', imageUrl: null, optionSets: [], soldOut: false, modifierGroups: [], ...over })

function menu(options: { open?: boolean, closesInMinutes?: number, largeSoldOut?: boolean } = {}): PublicMenu {
  const open = options.open ?? true
  return {
    branch: { id: BRANCH, name: 'Riverside', address: null, phone: null, timezone: 'Asia/Phnom_Penh', openNow: open, closesInMinutes: open ? options.closesInMinutes ?? 600 : null, nextOpening: null },
    currency: 'USD',
    at: '2026-09-29T03:00:00.000Z',
    categories: [{
      id: id(20),
      name: 'Coffee',
      description: '',
      items: [
        item({
          id: ICED_LATTE,
          name: 'Iced Latte',
          variations: [
            { id: REGULAR, valueIds: [], label: 'Regular', priceMinor: 300, soldOut: false },
            { id: LARGE, valueIds: [], label: 'Large', priceMinor: 325, soldOut: options.largeSoldOut ?? false },
          ],
          modifierGroups: [
            { id: MILK, name: 'Milk', minSelect: 1, maxSelect: 1, modifiers: [{ id: WHOLE, name: 'Whole milk', priceDeltaMinor: 0, isDefault: true }, { id: OAT, name: 'Oat milk', priceDeltaMinor: 50, isDefault: false }] },
            { id: EXTRAS, name: 'Extras', minSelect: 0, maxSelect: 2, modifiers: [{ id: SHOT, name: 'Extra shot', priceDeltaMinor: 50, isDefault: false }, { id: VANILLA, name: 'Vanilla', priceDeltaMinor: 50, isDefault: false }, { id: CARAMEL, name: 'Caramel', priceDeltaMinor: 50, isDefault: false }] },
          ],
        }),
      ],
      categories: [{
        id: id(21),
        name: 'Bakery',
        description: '',
        categories: [],
        items: [
          item({ id: CROISSANT, name: 'Butter Croissant', variations: [{ id: CROISSANT_V, valueIds: [], label: '', priceMinor: 250, soldOut: false }] }),
          item({ id: KHMER, name: 'Khmer Iced Coffee', variations: [{ id: KHMER_V, valueIds: [], label: 'Regular', priceMinor: 275, soldOut: false }] }),
        ],
      }],
    }],
  }
}

const line = (itemId: string, variationId: string, over: Partial<OrderLineInput> = {}): OrderLineInput =>
  ({ itemId, variationId, modifierIds: [], quantity: 1, note: null, ...over })

const THE_ORDER = [
  line(ICED_LATTE, LARGE, { modifierIds: [SHOT, OAT], quantity: 2, note: 'Less ice' }),
  line(CROISSANT, CROISSANT_V),
  line(KHMER, KHMER_V),
]

describe('pricing the written examples', () => {
  it('2 × Iced Latte Large with oat milk and an extra shot, a croissant, a Khmer iced coffee: $13.75', () => {
    const quote = quoteOrder(menu(), THE_ORDER)
    expect(quote.lines.map(l => [l.name, l.detail, l.unitPriceMinor, l.totalMinor])).toEqual([
      // $3.25 + $0.50 oat + $0.50 shot = $4.25, twice.
      ['Iced Latte', 'Large · Oat milk, Extra shot', 425, 850],
      ['Butter Croissant', '', 250, 250],
      ['Khmer Iced Coffee', 'Regular', 275, 275],
    ])
    expect(quote.subtotalMinor).toBe(1375)
    // No tax, no service charge (D45).
    expect(quote.totalMinor).toBe(1375)
    expect(quote.orderable).toBe(true)
    expect(quote.problems).toEqual([])
    expect(quote.lines[0]!.note).toBe('Less ice')
  })

  it('a free add-on costs nothing; the maximum quantity multiplies the unit price', () => {
    const quote = quoteOrder(menu(), [line(ICED_LATTE, REGULAR, { modifierIds: [WHOLE], quantity: 20 })])
    expect(quote.lines[0]!.unitPriceMinor).toBe(300)
    expect(quote.totalMinor).toBe(6000)
  })

  it('the quote lasts 10 minutes from when the menu was read', () => {
    expect(quoteOrder(menu(), THE_ORDER).expiresAt).toBe('2026-09-29T03:10:00.000Z')
  })
})

describe('what can go wrong with a line', () => {
  it('an item that isn\'t on the menu now: no name, no price, not counted, not orderable', () => {
    const quote = quoteOrder(menu(), [...THE_ORDER, line(id(99), id(98))])
    expect(quote.lines[3]).toMatchObject({ name: null, unitPriceMinor: null, totalMinor: null, problem: { code: 'ITEM_UNAVAILABLE' } })
    expect(quote.subtotalMinor).toBe(1375)
    expect(quote.orderable).toBe(false)
  })

  it('a version no longer sold', () => {
    const quote = quoteOrder(menu(), [line(CROISSANT, id(97))])
    expect(quote.lines[0]).toMatchObject({ name: 'Butter Croissant', problem: { code: 'VERSION_UNAVAILABLE' } })
  })

  it('an add-on no longer offered names which one', () => {
    const quote = quoteOrder(menu(), [line(ICED_LATTE, LARGE, { modifierIds: [OAT, id(96)] })])
    expect(quote.lines[0]!.problem).toEqual({ code: 'ADD_ON_UNAVAILABLE', message: 'An add-on you chose is no longer available.', modifierIds: [id(96)] })
  })

  it('an add-on of another item counts as not offered on this one', () => {
    expect(quoteOrder(menu(), [line(CROISSANT, CROISSANT_V, { modifierIds: [OAT] })]).lines[0]!.problem?.code).toBe('ADD_ON_UNAVAILABLE')
  })

  it('a group\'s rule not met: too few, too many', () => {
    const [none, many] = quoteOrder(menu(), [
      line(ICED_LATTE, LARGE),
      line(ICED_LATTE, LARGE, { modifierIds: [WHOLE, SHOT, VANILLA, CARAMEL] }),
    ]).lines
    expect(none!.problem).toEqual({ code: 'CHOICE_INVALID', message: 'Choose 1 option for Milk.' })
    expect(many!.problem).toEqual({ code: 'CHOICE_INVALID', message: 'Choose up to 2 options for Extras.' })
  })

  it('a sold-out version is named and priced nothing; a missing add-on is reported before it', () => {
    const [soldOut, both] = quoteOrder(menu({ largeSoldOut: true }), [
      line(ICED_LATTE, LARGE, { modifierIds: [OAT] }),
      line(ICED_LATTE, LARGE, { modifierIds: [id(95)] }),
    ]).lines
    expect(soldOut).toMatchObject({ name: 'Iced Latte', detail: 'Large · Oat milk', unitPriceMinor: null, problem: { code: 'SOLD_OUT' } })
    expect(both!.problem?.code).toBe('ADD_ON_UNAVAILABLE')
  })
})

describe('the order as a whole', () => {
  it('lists each line\'s add-ons with their prices, in menu order', () => {
    expect(quoteOrder(menu(), THE_ORDER).lines[0]!.modifiers).toEqual([
      { id: OAT, name: 'Oat milk', priceDeltaMinor: 50 },
      { id: SHOT, name: 'Extra shot', priceDeltaMinor: 50 },
    ])
  })

  it('last orders: 15 minutes before closing, not orderable; 16 minutes before, orderable', () => {
    const late = quoteOrder(menu({ closesInMinutes: 15 }), THE_ORDER)
    expect(late.problems).toEqual([{ code: 'LAST_ORDERS_PASSED', message: 'Online orders close 15 minutes before Riverside closes.' }])
    expect(late.orderable).toBe(false)
    expect(quoteOrder(menu({ closesInMinutes: 16 }), THE_ORDER).orderable).toBe(true)
  })

  it('a closed branch: priced as usual, but not orderable', () => {
    const quote = quoteOrder(menu({ open: false }), THE_ORDER)
    expect(quote.totalMinor).toBe(1375)
    expect(quote.problems).toEqual([{ code: 'BRANCH_CLOSED', message: 'Riverside is closed now.' }])
    expect(quote.orderable).toBe(false)
  })
})

describe('what a request may say', () => {
  const issues = (schema: v.GenericSchema, value: unknown) => {
    const result = v.safeParse(schema, value)
    return result.success ? [] : result.issues.map(issue => issue.message)
  }
  const base = { itemId: ICED_LATTE, variationId: LARGE, quantity: 1 }

  it('quantities of 1 to 20; each add-on once; a note up to 140 characters, blank meaning none', () => {
    expect(issues(orderLineInputSchema, { ...base, quantity: 21 })).toEqual(['At most 20'])
    expect(issues(orderLineInputSchema, { ...base, quantity: 0 })).toEqual(['At least 1'])
    expect(issues(orderLineInputSchema, { ...base, quantity: 1.5 })).toEqual(['Must be a whole number'])
    expect(issues(orderLineInputSchema, { ...base, modifierIds: [OAT, OAT] })).toEqual(['Each add-on can be chosen once'])
    expect(issues(orderLineInputSchema, { ...base, note: 'x'.repeat(141) })).toEqual(['At most 140 characters'])
    expect(v.parse(orderLineInputSchema, { ...base, note: '   ' }).note).toBeNull()
    expect(v.parse(orderLineInputSchema, { ...base, note: ' Less ice ' }).note).toBe('Less ice')
  })

  it('never a price or a total from the browser, and 1 to 30 lines', () => {
    expect(issues(orderLineInputSchema, { ...base, unitPriceMinor: 1 }).length).toBe(1)
    expect(issues(checkoutQuoteSchema, { branchId: BRANCH, lines: [], totalMinor: 1 }).length).toBeGreaterThan(0)
    expect(issues(checkoutQuoteSchema, { branchId: BRANCH, lines: [] })).toEqual(['Your order is empty'])
    expect(issues(checkoutQuoteSchema, { branchId: BRANCH, lines: Array.from({ length: 31 }, () => base) })).toEqual(['An order can have up to 30 lines'])
    expect(issues(checkoutQuoteSchema, { branchId: BRANCH, lines: Array.from({ length: 30 }, () => base) })).toEqual([])
  })
})
