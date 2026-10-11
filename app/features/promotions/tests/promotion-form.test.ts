import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Promotion } from '#shared/contracts/menu-promotions'
import { addDays, categoryPath, dateText, newPromotionForm, overlapping, pickerTree, promotionFormSchema, targetsText, timingText, toPromotionBody, toPromotionForm, whenText } from '../schemas/promotion-form'

const issues = (form: unknown) => v.safeParse(promotionFormSchema, form).issues?.map(i => [v.getDotPath(i), i.message]) ?? []

const promotion = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p1', name: 'Coffee week', description: '', status: 'published', phase: 'live', discount: { kind: 'percent', percent: 20 }, label: '20% off',
  scope: 'selected', items: [], categories: [{ id: 'coffee', name: 'Coffee', status: 'active' }], branches: [],
  startsOn: '2026-10-15', endsOn: '2026-10-21', poster: null, endedAt: null, version: 1, createdAt: '', updatedAt: '', ...over,
})

describe('the promotion form', () => {
  it('starts as 10% off chosen items for a week from today', () => {
    expect(newPromotionForm('2026-10-15')).toMatchObject({ kind: 'percent', percent: 10, scope: 'selected', startsOn: '2026-10-15', endsOn: '2026-10-21', allBranches: true })
  })

  it('asks for a name, a discount, something to discount, a branch and sensible dates', () => {
    const form = { ...newPromotionForm('2026-10-15'), name: 'Coffee week', categoryIds: ['coffee'] }
    expect(issues(form)).toEqual([])
    expect(issues({ ...form, name: ' ' })).toEqual([['name', 'Name is required']])
    expect(issues({ ...form, percent: 0 })).toEqual([['percent', 'Enter a whole number from 1 to 100']])
    expect(issues({ ...form, percent: 12.5 })).toEqual([['percent', 'Enter a whole number from 1 to 100']])
    expect(issues({ ...form, kind: 'amount', amount: undefined })).toEqual([['amount', 'Enter an amount from $0.01 to $1,000']])
    expect(issues({ ...form, kind: 'amount', amount: 0.5 })).toEqual([])
    expect(issues({ ...form, categoryIds: [] })).toEqual([['itemIds', 'Choose at least one item or category']])
    expect(issues({ ...form, categoryIds: [], scope: 'menu' })).toEqual([])
    expect(issues({ ...form, allBranches: false })).toEqual([['branchIds', 'Choose at least one branch']])
    expect(issues({ ...form, endsOn: '2026-10-14' })).toEqual([['endsOn', 'The last day can\'t be before the first']])
    expect(issues({ ...form, endsOn: null })).toEqual([])
  })

  it('saves dollars as cents and leaves out what the scope doesn\'t use', () => {
    const form = { ...newPromotionForm('2026-10-15'), name: ' Treat ', kind: 'amount' as const, amount: 1.5, scope: 'menu' as const, itemIds: ['x'], allBranches: false, branchIds: ['b1'] }
    expect(toPromotionBody(form)).toEqual({ name: 'Treat', description: '', discount: { kind: 'amount', amountMinor: 150 }, scope: 'menu', itemIds: [], categoryIds: [], branchIds: ['b1'], startsOn: '2026-10-15', endsOn: '2026-10-21', posterId: null })
  })

  it('opens a saved promotion as it was saved', () => {
    const form = toPromotionForm(promotion({ discount: { kind: 'amount', amountMinor: 125 }, poster: { id: 'a1', url: '/media/a1.png' }, branches: [{ id: 'b1', name: 'Riverside' }] }))
    expect(form).toMatchObject({ kind: 'amount', amount: 1.25, percent: undefined, categoryIds: ['coffee'], allBranches: false, branchIds: ['b1'], posterId: 'a1', posterUrl: '/media/a1.png' })
  })
})

describe('words', () => {
  it('writes dates and ranges briefly', () => {
    expect(dateText('2026-10-05')).toBe('5 Oct 2026')
    expect(whenText('2026-10-15', '2026-10-21')).toBe('15 – 21 Oct 2026')
    expect(whenText('2026-10-28', '2026-11-03')).toBe('28 Oct – 3 Nov 2026')
    expect(whenText('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027')
    expect(whenText('2026-10-15', '2026-10-15')).toBe('15 Oct 2026')
    expect(whenText('2026-10-15', null)).toBe('From 15 Oct 2026')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('says when it starts or ends', () => {
    const today = '2026-10-15'
    expect(timingText(promotion({ phase: 'scheduled', startsOn: '2026-10-16' }), today)).toBe('Starts tomorrow')
    expect(timingText(promotion({ phase: 'scheduled', startsOn: '2026-10-20' }), today)).toBe('Starts in 5 days')
    expect(timingText(promotion({ endsOn: '2026-10-15' }), today)).toBe('Last day today')
    expect(timingText(promotion({ endsOn: '2026-10-21' }), today)).toBe('Ends in 6 days')
    expect(timingText(promotion({ endsOn: null }), today)).toBe('Runs until you end it')
    expect(timingText(promotion({ phase: 'ended', endedAt: '2026-10-12T03:00:00.000Z' }), today)).toBe('Ended by hand on 12 Oct 2026')
  })

  it('names what a promotion covers', () => {
    expect(targetsText(promotion({ scope: 'menu' }))).toBe('Whole menu')
    expect(targetsText(promotion({ items: [{ id: 'a', name: 'Latte', status: 'active' }, { id: 'b', name: 'Mocha', status: 'active' }, { id: 'c', name: 'Tea', status: 'active' }] }))).toBe('Coffee, Latte, Mocha and 1 more')
  })

  it('finds the running promotions that cover the same items', () => {
    const categoryOf = (itemId: string) => (itemId === 'latte' ? ['coffee', 'drinks'] : ['bakery'])
    const byCategory = promotion()
    const byItem = promotion({ id: 'p2', categories: [], items: [{ id: 'bread', name: 'Bread', status: 'active' }] })
    const draft = promotion({ id: 'p3', phase: 'draft' })
    const whole = promotion({ id: 'p4', scope: 'menu', categories: [] })
    const others = [byCategory, byItem, draft]
    expect(overlapping({ scope: 'selected', itemIds: ['latte'], categoryIds: [] }, others, categoryOf).map(p => p.id)).toEqual(['p1'])
    expect(overlapping({ scope: 'selected', itemIds: [], categoryIds: ['bakery'] }, others, categoryOf).map(p => p.id)).toEqual(['p2'])
    expect(overlapping({ scope: 'menu', itemIds: [], categoryIds: [] }, others, categoryOf).map(p => p.id)).toEqual(['p1', 'p2'])
    expect(overlapping({ scope: 'selected', itemIds: ['bread'], categoryIds: [] }, [whole], categoryOf).map(p => p.id)).toEqual(['p4'])
  })
})

describe('choosing what\'s included', () => {
  const categories = [
    { id: 'drinks', parentId: null, name: 'Drinks', status: 'active', sortOrder: 0 },
    { id: 'coffee', parentId: 'drinks', name: 'Coffee', status: 'active', sortOrder: 0 },
    { id: 'old', parentId: 'drinks', name: 'Old', status: 'archived', sortOrder: 1 },
    { id: 'bakery', parentId: null, name: 'Bakery', status: 'active', sortOrder: 1 },
  ]
  const items = [
    { id: 'mocha', categoryId: 'coffee', name: 'Mocha', status: 'active', sortOrder: 1, priceMinMinor: 400 },
    { id: 'latte', categoryId: 'coffee', name: 'Latte', status: 'draft', sortOrder: 0, priceMinMinor: 350 },
    { id: 'gone', categoryId: 'bakery', name: 'Gone', status: 'archived', sortOrder: 0, priceMinMinor: 100 },
    { id: 'bread', categoryId: 'bakery', name: 'Bread', status: 'active', sortOrder: 1, priceMinMinor: 250 },
  ]

  it('lists active categories in menu order with their items, drafts marked, archived left out', () => {
    expect(pickerTree(categories, items)).toEqual([
      { id: 'drinks', name: 'Drinks', items: [], subs: [{ id: 'coffee', name: 'Coffee', subs: [], items: [{ id: 'latte', name: 'Latte', draft: true, priceMinMinor: 350 }, { id: 'mocha', name: 'Mocha', draft: false, priceMinMinor: 400 }] }] },
      { id: 'bakery', name: 'Bakery', subs: [], items: [{ id: 'bread', name: 'Bread', draft: false, priceMinMinor: 250 }] },
    ])
  })

  it('finds an item\'s category and its parent', () => {
    const path = categoryPath(categories, items)
    expect(path('latte')).toEqual(['coffee', 'drinks'])
    expect(path('bread')).toEqual(['bakery'])
    expect(path('unknown')).toEqual([])
  })
})
