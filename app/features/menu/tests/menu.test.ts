import { describe, expect, it } from 'vitest'
import type { PublicMenu, PublicMenuItem, PublicMenuModifierGroup } from '#shared/contracts/public-menu'
import { addLine, lineKey, MAX_LINE_QUANTITY, parseLines, quantityOfItem, resolveCart, setLineQuantity } from '../utils/cart'
import { hasChoices, highlightParts, menuItems, menuSections, priceOf, searchMenu } from '../utils/menu'
import { openingText } from '../utils/opening'
import { chooseValue, chosenModifierIds, defaultSelection, groupRule, isValueOrderable, selectionProblems, toggleModifier, unitPriceOf, variationOf } from '../utils/selection'

function item(id: string, overrides: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id,
    name: id,
    description: '',
    imageUrl: null,
    optionSets: [],
    variations: [{ id: `${id}-v`, valueIds: [], label: '', priceMinor: 300, soldOut: false }],
    soldOut: false,
    modifierGroups: [],
    ...overrides,
  }
}

const group = (id: string, minSelect: number, maxSelect: number | null, names: string[], defaults: string[] = []): PublicMenuModifierGroup => ({
  id,
  name: id,
  minSelect,
  maxSelect,
  modifiers: names.map((name, index) => ({ id: name, name, priceDeltaMinor: index * 50, isDefault: defaults.includes(name) })),
})

// Latte: Size (Small, Large) × Temperature (Hot, Iced); Large Iced sold out, Small Iced not sold.
const latte = item('latte', {
  name: 'Latte',
  optionSets: [
    { id: 'size', name: 'Size', values: [{ id: 's', name: 'Small' }, { id: 'l', name: 'Large' }] },
    { id: 'temp', name: 'Temperature', values: [{ id: 'hot', name: 'Hot' }, { id: 'iced', name: 'Iced' }] },
  ],
  variations: [
    { id: 's-hot', valueIds: ['s', 'hot'], label: 'Small, Hot', priceMinor: 400, soldOut: false },
    { id: 'l-hot', valueIds: ['l', 'hot'], label: 'Large, Hot', priceMinor: 500, soldOut: false },
    { id: 'l-iced', valueIds: ['l', 'iced'], label: 'Large, Iced', priceMinor: 550, soldOut: true },
  ],
  modifierGroups: [group('Milk', 1, 1, ['Whole', 'Oat'], ['Whole']), group('Extras', 0, 2, ['Shot', 'Vanilla', 'Cream'])],
})

const menu: PublicMenu = {
  branch: { id: 'b', name: 'Main', address: null, phone: null, timezone: 'Asia/Phnom_Penh', openNow: true, nextOpening: null },
  currency: 'USD',
  at: '2026-09-29T00:00:00.000Z',
  categories: [
    { id: 'coffee', name: 'Coffee', description: '', items: [], categories: [
      { id: 'hot', name: 'Hot', description: '', categories: [], items: [latte, item('americano', { name: 'Americano' })] },
      { id: 'cold', name: 'Iced', description: '', categories: [], items: [item('cold-brew', { name: 'Cold brew', description: 'Slow steeped' })] },
    ] },
    { id: 'bakery', name: 'Bakery', description: 'Baked daily', categories: [], items: [item('croissant', { name: 'Croissant' })] },
  ],
}

describe('menu sections and search', () => {
  const sections = menuSections(menu)

  it('keeps main categories as sections with their sub-sections and counts', () => {
    expect(sections.map(s => [s.name, s.count, s.subSections.map(x => x.name), s.items.length])).toEqual([
      ['Coffee', 3, ['Hot', 'Iced'], 0],
      ['Bakery', 1, [], 1],
    ])
    expect(menuItems(sections).map(i => i.id)).toEqual(['latte', 'americano', 'cold-brew', 'croissant'])
  })

  it('finds by name or description, accent- and case-insensitive, grouped by place', () => {
    expect(searchMenu(sections, 'LAT').map(g => [g.path, g.items.map(i => i.id)])).toEqual([['Coffee → Hot', ['latte']]])
    expect(searchMenu(sections, 'steeped')[0]!.path).toBe('Coffee → Iced')
    expect(searchMenu(sections, 'croiss')[0]!.path).toBe('Bakery')
    expect(searchMenu(sections, '  ')).toEqual([])
    const cafe = menuSections({ ...menu, categories: [{ ...menu.categories[1]!, items: [item('c', { name: 'Café au lait' })] }] })
    expect(searchMenu(cafe, 'cafe au')).toHaveLength(1)
  })

  it('highlights every match, keeping the original text', () => {
    expect(highlightParts('Café latte', 'cafe')).toEqual([{ text: 'Café', match: true }, { text: ' latte', match: false }])
    expect(highlightParts('Latte latte', 'LAT').filter(p => p.match).map(p => p.text)).toEqual(['Lat', 'lat'])
    expect(highlightParts('Tea', '')).toEqual([{ text: 'Tea', match: false }])
  })

  it('prices from the cheapest orderable version, "from" only when prices differ', () => {
    expect(priceOf(latte)).toEqual({ minor: 400, from: true })
    expect(priceOf(item('tea'))).toEqual({ minor: 300, from: false })
    const allOut = item('x', { variations: [{ id: 'a', valueIds: [], label: '', priceMinor: 200, soldOut: true }] })
    expect(priceOf(allOut)).toEqual({ minor: 200, from: false })
  })

  it('opens the detail for anything to choose: versions or add-on groups', () => {
    expect(hasChoices(latte)).toBe(true)
    expect(hasChoices(item('tea'))).toBe(false)
    expect(hasChoices(item('toast', { modifierGroups: [group('Jam', 0, 1, ['Berry'])] }))).toBe(true)
  })
})

describe('choices in the item detail', () => {
  it('starts from the first orderable version and the pre-selected add-ons', () => {
    const selection = defaultSelection(latte)
    expect(selection).toEqual({ values: ['s', 'hot'], modifiers: { Milk: ['Whole'], Extras: [] } })
    expect(variationOf(latte, selection)?.id).toBe('s-hot')
    expect(unitPriceOf(latte, selection)).toBe(400)
  })

  it('offers a value only when it gives an orderable version with the other choice', () => {
    const small = defaultSelection(latte)
    // Small Iced isn't in the grid; Large Iced is sold out.
    expect(isValueOrderable(latte, small, 1, 'iced')).toBe(false)
    expect(isValueOrderable(latte, small, 0, 'l')).toBe(true)
    const large = chooseValue(latte, small, 0, 'l')
    expect(isValueOrderable(latte, large, 1, 'iced')).toBe(false)
  })

  it('moves the other choice when a value doesn\'t go with it', () => {
    const allSizes = item('tea', {
      optionSets: [
        { id: 'size', name: 'Size', values: [{ id: 's', name: 'Small' }, { id: 'l', name: 'Large' }] },
        { id: 'temp', name: 'Temperature', values: [{ id: 'hot', name: 'Hot' }, { id: 'iced', name: 'Iced' }] },
      ],
      variations: [
        { id: 's-hot', valueIds: ['s', 'hot'], label: 'Small, Hot', priceMinor: 300, soldOut: false },
        { id: 'l-iced', valueIds: ['l', 'iced'], label: 'Large, Iced', priceMinor: 450, soldOut: false },
      ],
    })
    const moved = chooseValue(allSizes, defaultSelection(allSizes), 1, 'iced')
    expect(moved.values).toEqual(['l', 'iced'])
  })

  it('toggles add-ons within the group\'s limits, in menu order', () => {
    const milk = latte.modifierGroups[0]!
    const extras = latte.modifierGroups[1]!
    expect(toggleModifier(milk, ['Whole'], 'Oat')).toEqual(['Oat'])
    expect(toggleModifier(extras, ['Vanilla'], 'Shot')).toEqual(['Shot', 'Vanilla'])
    expect(toggleModifier(extras, ['Shot', 'Vanilla'], 'Cream')).toEqual(['Shot', 'Vanilla'])
    expect(toggleModifier(extras, ['Shot', 'Vanilla'], 'Shot')).toEqual(['Vanilla'])
  })

  it('names what\'s missing, and prices the version with its add-ons', () => {
    const selection = { values: ['l', 'hot'], modifiers: { Milk: [], Extras: ['Vanilla', 'Cream'] } }
    expect(selectionProblems(latte, selection)).toEqual([{ target: 'Milk', action: 'Choose Milk', message: 'Choose 1 more.' }])
    expect(unitPriceOf(latte, selection)).toBe(500 + 50 + 100)
    expect(chosenModifierIds(latte, { ...selection, modifiers: { Milk: ['Oat'], Extras: ['Cream', 'Shot'] } })).toEqual(['Oat', 'Shot', 'Cream'])
    expect(selectionProblems(latte, { values: ['l', 'iced'], modifiers: { Milk: ['Oat'] } })[0]!.target).toBe('version')
  })

  it('describes each group\'s rule', () => {
    expect([group('a', 1, 1, ['x']), group('b', 1, 2, ['x']), group('c', 2, null, ['x']), group('d', 0, 3, ['x']), group('e', 0, null, ['x'])].map(groupRule))
      .toEqual(['Required · choose 1', 'Required · choose 1–2', 'Required · choose at least 2', 'Optional · up to 3', 'Optional'])
  })
})

describe('the order before checkout', () => {
  const tea = item('tea', { name: 'Tea' })
  const add = (itemId: string, variationId: string, modifierIds: string[], quantity = 1) => ({ itemId, variationId, modifierIds, quantity, name: itemId })

  it('merges the same choice into one line and caps quantities', () => {
    let lines = addLine([], add('latte', 'l-hot', ['Oat', 'Shot']))
    lines = addLine(lines, add('latte', 'l-hot', ['Shot', 'Oat'], 2))
    lines = addLine(lines, add('latte', 's-hot', ['Whole']))
    expect(lines.map(l => [l.key, l.quantity])).toEqual([[lineKey('l-hot', ['Oat', 'Shot']), 3], [lineKey('s-hot', ['Whole']), 1]])
    expect(quantityOfItem(lines, 'latte')).toBe(4)
    lines = setLineQuantity(lines, lines[0]!.key, 500)
    expect(lines[0]!.quantity).toBe(MAX_LINE_QUANTITY)
    expect(setLineQuantity(lines, lines[0]!.key, 0).map(l => l.variationId)).toEqual(['s-hot'])
  })

  it('reads lines against the current menu: names, prices, and what\'s no longer available', () => {
    const lines = [
      ...addLine([], add('latte', 's-hot', ['Oat', 'Vanilla'], 2)),
      ...addLine([], add('latte', 'l-iced', ['Whole'])),
      ...addLine([], add('gone', 'gone-v', [])),
      ...addLine([], add('tea', 'tea-v', [], 3)),
    ]
    const cart = resolveCart(lines, [latte, tea])
    expect(cart.lines.map(l => [l.name, l.detail, l.unitPriceMinor, l.available])).toEqual([
      ['Latte', 'Small, Hot · Oat, Vanilla', 400 + 50 + 50, true],
      ['Latte', 'Large, Iced · Whole', 550, false],
      ['gone', '', 0, false],
      ['Tea', '', 300, true],
    ])
    expect(cart.count).toBe(5)
    expect(cart.subtotalMinor).toBe(2 * 500 + 3 * 300)
  })

  it('drops malformed stored lines instead of trusting them', () => {
    const stored = [
      { itemId: 'tea', variationId: 'tea-v', modifierIds: [], quantity: 2, name: 'Tea' },
      { itemId: 'tea', variationId: 'tea-v', modifierIds: 'x', quantity: 2, name: 'Tea' },
      { itemId: 'tea', variationId: 'tea-v', modifierIds: [], quantity: -1, name: 'Tea' },
      null,
    ]
    expect(parseLines(stored).map(l => [l.itemId, l.quantity])).toEqual([['tea', 2]])
    expect(parseLines('nope')).toEqual([])
  })
})

describe('opening text', () => {
  const closed = (inDays: number, weekday = 5) => openingText({ openNow: false, nextOpening: { inDays, weekday, startMinute: 420 } })

  it('says when it opens: today, tomorrow, a weekday, or next week', () => {
    expect(closed(0)).toBe('Opens today at 7:00 AM')
    expect(closed(1)).toBe('Opens tomorrow at 7:00 AM')
    expect(closed(3)).toBe('Opens Friday at 7:00 AM')
    expect(closed(7, 1)).toBe('Opens next Monday at 7:00 AM')
    expect(openingText({ openNow: true, nextOpening: null })).toBeUndefined()
    expect(openingText({ openNow: false, nextOpening: null })).toBeUndefined()
  })
})
