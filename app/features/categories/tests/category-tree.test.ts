import { describe, expect, it } from 'vitest'
import type { Category } from '#shared/contracts/menu'
import { buildTree, countStatuses, filterTree, orderOf, sortOrderChanges } from '../schemas/category-tree'

const main = (id: string, name: string, sortOrder: number, status = 'ACTIVE') =>
  ({ id, name, parentId: null, sortOrder, status }) as Category
const sub = (id: string, name: string, parent: string, sortOrder: number, status = 'ACTIVE') =>
  ({ ...main(id, name, sortOrder, status), parentId: parent }) as Category

const CATEGORIES = [
  main('food', 'Food', 2),
  sub('toast', 'Toast', 'food', 1),
  main('drinks', 'Drinks', 1),
  sub('tea', 'Tea', 'drinks', 2, 'INACTIVE'),
  sub('coffee', 'Coffee', 'drinks', 1),
  sub('lost', 'Lost', 'gone', 1),
]

describe('category tree', () => {
  it('nests sub-categories under their main, both in sort order; lost subs apart', () => {
    const tree = buildTree(CATEGORIES)
    expect(tree.groups.map(g => [g.main.name, g.subs.map(s => s.name)])).toEqual([
      ['Drinks', ['Coffee', 'Tea']],
      ['Food', ['Toast']],
    ])
    expect(tree.orphans.map(s => s.name)).toEqual(['Lost'])
  })

  it('keeps a main as context when only its subs match', () => {
    const tree = filterTree(buildTree(CATEGORIES), { search: 'tea' })
    expect(tree.groups).toEqual([{ main: expect.objectContaining({ name: 'Drinks' }), subs: [expect.objectContaining({ name: 'Tea' })], contextOnly: true }])
  })

  it('filters by status, and ignores the "all" value', () => {
    const inactive = filterTree(buildTree(CATEGORIES), { status: 'INACTIVE' })
    expect(inactive.groups.map(g => [g.main.name, g.subs.map(s => s.name), !!g.contextOnly])).toEqual([['Drinks', ['Tea'], true]])
    expect(filterTree(buildTree(CATEGORIES), { status: 'ALL' }).groups).toHaveLength(2)
  })

  it('counts statuses under the current search', () => {
    expect(countStatuses(CATEGORIES)).toEqual({ ACTIVE: 5, INACTIVE: 1, all: 6 })
    expect(countStatuses(CATEGORIES, 'o')).toEqual({ ACTIVE: 4, INACTIVE: 0, all: 4 })
  })

  it('sends only the lists that changed, each whole, subs per main', () => {
    const server = orderOf(buildTree(CATEGORIES))
    expect(server).toEqual({ mains: ['drinks', 'food'], subs: { drinks: ['coffee', 'tea'], food: ['toast'] } })
    expect(sortOrderChanges(server, { ...server, subs: { ...server.subs, drinks: ['tea', 'coffee'] } })).toEqual({
      lists: [{ parentId: 'drinks', ids: ['tea', 'coffee'] }],
    })
    expect(sortOrderChanges(server, { ...server, mains: ['food', 'drinks'] })).toEqual({
      lists: [{ parentId: null, ids: ['food', 'drinks'] }],
    })
    expect(sortOrderChanges(server, server)).toEqual({ lists: [] })
  })
})
