import { describe, expect, it } from 'vitest'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { buildTree, countStatuses, filterTree, orderOf, reorderRequests } from '../schemas/category-tree'

const main = (id: string, name: string, sortOrder: number, status: MenuCategory['status'] = 'active') =>
  ({ id, name, description: '', parentId: null, sortOrder, status, version: 1 }) as MenuCategory
const sub = (id: string, name: string, parent: string, sortOrder: number, status: MenuCategory['status'] = 'active') =>
  ({ ...main(id, name, sortOrder, status), parentId: parent }) as MenuCategory

const CATEGORIES = [
  main('food', 'Food', 2),
  sub('toast', 'Toast', 'food', 1),
  main('drinks', 'Drinks', 1),
  sub('tea', 'Tea', 'drinks', 2, 'archived'),
  sub('coffee', 'Coffee', 'drinks', 1),
  sub('juice', 'Juice', 'drinks', 3),
  main('old', 'Old menu', 3, 'archived'),
  sub('lost', 'Lost', 'gone', 1),
]

describe('category tree', () => {
  it('nests sub-categories under their main, both in sort order; lost subs apart', () => {
    const tree = buildTree(CATEGORIES)
    expect(tree.groups.map(g => [g.main.name, g.subs.map(s => s.name)])).toEqual([
      ['Drinks', ['Coffee', 'Tea', 'Juice']],
      ['Food', ['Toast']],
      ['Old menu', []],
    ])
    expect(tree.orphans.map(s => s.name)).toEqual(['Lost'])
  })

  it('keeps a main as context when only its subs match', () => {
    const tree = filterTree(buildTree(CATEGORIES), { search: 'tea' })
    expect(tree.groups).toEqual([{ main: expect.objectContaining({ name: 'Drinks' }), subs: [expect.objectContaining({ name: 'Tea' })], contextOnly: true }])
  })

  it('searches descriptions too, keeping a matching sub under its main', () => {
    const described = CATEGORIES.map(c => (c.id === 'juice' ? { ...c, description: 'Fresh-pressed every morning' } : c))
    const tree = filterTree(buildTree(described), { search: 'PRESSED' })
    expect(tree.groups.map(g => [g.main.name, g.subs.map(s => s.name)])).toEqual([['Drinks', ['Juice']]])
  })

  it('filters by status, and ignores the "all" value', () => {
    const archived = filterTree(buildTree(CATEGORIES), { status: 'archived' })
    expect(archived.groups.map(g => [g.main.name, g.subs.map(s => s.name), !!g.contextOnly])).toEqual([['Drinks', ['Tea'], true], ['Old menu', [], false]])
    expect(filterTree(buildTree(CATEGORIES), { status: 'ALL' }).groups).toHaveLength(3)
  })

  it('counts statuses under the current search', () => {
    expect(countStatuses(CATEGORIES)).toEqual({ active: 6, archived: 2, all: 8 })
    expect(countStatuses(CATEGORIES, 'o')).toEqual({ active: 4, archived: 1, all: 5 })
  })

  it('orders only active categories: archived ones have no place', () => {
    expect(orderOf(buildTree(CATEGORIES))).toEqual({ mains: ['drinks', 'food'], subs: { drinks: ['coffee', 'juice'], food: ['toast'] } })
  })

  it('saves one request per changed list, each with every active child and its version', () => {
    const server = orderOf(buildTree(CATEGORIES))
    const versions = new Map([['drinks', 3], ['food', 2], ['coffee', 5], ['juice', 1]])
    expect(reorderRequests(server, { ...server, subs: { ...server.subs, drinks: ['juice', 'coffee'] } }, versions)).toEqual([
      { parentId: 'drinks', items: [{ id: 'juice', version: 1 }, { id: 'coffee', version: 5 }] },
    ])
    expect(reorderRequests(server, { mains: ['food', 'drinks'], subs: { ...server.subs, drinks: ['juice', 'coffee'] } }, versions)).toEqual([
      { parentId: null, items: [{ id: 'food', version: 2 }, { id: 'drinks', version: 3 }] },
      { parentId: 'drinks', items: [{ id: 'juice', version: 1 }, { id: 'coffee', version: 5 }] },
    ])
    expect(reorderRequests(server, server, versions)).toEqual([])
  })
})
