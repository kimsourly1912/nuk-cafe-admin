import { describe, expect, it } from 'vitest'
import type { Catalog, CatalogCategory, CatalogItem } from '#server/features/menu/catalog.rules'
import { groupOnItem, menuAt } from '#server/features/menu/catalog.rules'

const MON = 1
const at = (hhmm: string) => ({ weekday: MON, minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) })
const nothingSoldOut = new Set<string>()

const category = (id: string, parentId: string | null = null, ruleIds: string[] = []): CatalogCategory => ({ id, parentId, name: id, description: '', ruleIds })
const item = (id: string, categoryId: string, overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  categoryId,
  name: id,
  description: '',
  imageUrl: null,
  ruleIds: [],
  optionSets: [],
  variations: [{ id: `${id}-v`, valueIds: [], label: '', priceMinor: 300 }],
  modifierGroups: [],
  ...overrides,
})

const rules: Catalog['rules'] = {
  breakfast: { status: 'active', windows: [{ weekday: MON, startMinute: 420, endMinute: 660 }] },
  mornings: { status: 'active', windows: [{ weekday: MON, startMinute: 360, endMinute: 720 }] },
  retired: { status: 'archived', windows: [{ weekday: MON, startMinute: 0, endMinute: 1440 }] },
}

const shown = (categories: ReturnType<typeof menuAt>) => categories.map(c => [c.id, c.categories.map(s => [s.id, s.items.map(i => i.id)]), c.items.map(i => i.id)])

describe('the menu at a moment', () => {
  it('shows items without rules at any time, in the catalog\'s order', () => {
    const catalog: Catalog = { categories: [category('food')], items: [item('toast', 'food'), item('bagel', 'food')], rules }
    expect(shown(menuAt(catalog, at('03:00'), nothingSoldOut))).toEqual([['food', [], ['toast', 'bagel']]])
  })

  it('shows an item with rules only inside one of its windows', () => {
    const catalog: Catalog = { categories: [category('food')], items: [item('eggs', 'food', { ruleIds: ['breakfast'] }), item('toast', 'food')], rules }
    expect(shown(menuAt(catalog, at('08:00'), nothingSoldOut))).toEqual([['food', [], ['eggs', 'toast']]])
    expect(shown(menuAt(catalog, at('11:00'), nothingSoldOut))).toEqual([['food', [], ['toast']]])
  })

  it('applies the category\'s rules, and the parent\'s to a sub-category\'s items', () => {
    const catalog: Catalog = {
      categories: [category('food', null, ['mornings']), category('hot', 'food'), category('drinks'), category('cold', 'drinks', ['breakfast'])],
      items: [item('eggs', 'hot'), item('juice', 'cold')],
      rules,
    }
    expect(shown(menuAt(catalog, at('07:30'), nothingSoldOut))).toEqual([['food', [['hot', ['eggs']]], []], ['drinks', [['cold', ['juice']]], []]])
    expect(shown(menuAt(catalog, at('11:30'), nothingSoldOut))).toEqual([['food', [['hot', ['eggs']]], []]])
    expect(shown(menuAt(catalog, at('13:00'), nothingSoldOut))).toEqual([])
  })

  it('never matches an archived or unknown rule, even as the only one', () => {
    const catalog: Catalog = { categories: [category('food')], items: [item('a', 'food', { ruleIds: ['retired'] }), item('b', 'food', { ruleIds: ['gone'] }), item('c', 'food', { ruleIds: ['retired', 'breakfast'] })], rules }
    expect(shown(menuAt(catalog, at('08:00'), nothingSoldOut))).toEqual([['food', [], ['c']]])
  })

  it('marks sold-out versions (their values stay offered) and items with nothing left (D93)', () => {
    const latte = item('latte', 'drinks', {
      optionSets: [{ id: 'size', name: 'Size', values: [{ id: 's', name: 'Small' }, { id: 'l', name: 'Large' }] }],
      variations: [{ id: 'latte-s', valueIds: ['s'], label: 'Small', priceMinor: 300 }, { id: 'latte-l', valueIds: ['l'], label: 'Large', priceMinor: 400 }],
    })
    const catalog: Catalog = { categories: [category('drinks')], items: [latte, item('tea', 'drinks')], rules }
    const [drinks] = menuAt(catalog, at('08:00'), new Set(['latte-l', 'tea-v']))
    expect(drinks!.items.map(i => [i.id, i.soldOut])).toEqual([['latte', false], ['tea', true]])
    expect(drinks!.items[0]!.variations.map(v => [v.label, v.soldOut])).toEqual([['Small', false], ['Large', true]])
    expect(drinks!.items[0]!.optionSets[0]!.values.map(v => v.name)).toEqual(['Small', 'Large'])
  })

  it('leaves out empty sub-categories and categories', () => {
    const catalog: Catalog = {
      categories: [category('food'), category('hot', 'food'), category('cold', 'food'), category('empty')],
      items: [item('soup', 'hot')],
      rules,
    }
    expect(shown(menuAt(catalog, at('08:00'), nothingSoldOut))).toEqual([['food', [['hot', ['soup']]], []]])
  })
})

describe('an add-on group on the menu', () => {
  const milk = { id: 'milk', name: 'Milk', minSelect: 2, maxSelect: 3 }
  const oat = { id: 'oat', name: 'Oat', priceDeltaMinor: 50, isDefault: false }

  it('caps the minimum at the add-ons offered (an item\'s own rule may predate an archive)', () => {
    expect(groupOnItem(milk, [oat])).toMatchObject({ minSelect: 1, maxSelect: 3, modifiers: [oat] })
  })

  it('is left out when no add-on is offered', () => {
    expect(groupOnItem(milk, [])).toBeNull()
  })
})
