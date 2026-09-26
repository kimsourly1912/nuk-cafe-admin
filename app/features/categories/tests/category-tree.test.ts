import { describe, expect, it } from 'vitest'
import { buildTree, countStatuses, filterTree, orderOf, sortOrderChanges } from '../schemas/category-tree'

const main = (id: number, name: string, sortOrder: number, status = 'ACTIVE') => ({ id, categoryName: name, sortOrder, status: status as 'ACTIVE' | 'INACTIVE' })
const sub = (id: number, name: string, parent: number, sortOrder: number, status = 'ACTIVE') => ({ ...main(id, name, sortOrder, status), mainCategoryId: parent })

const CATEGORIES = [
  main(2, 'Food', 2),
  sub(21, 'Toast', 2, 1),
  main(1, 'Drinks', 1),
  sub(12, 'Tea', 1, 2, 'INACTIVE'),
  sub(11, 'Coffee', 1, 1),
  sub(99, 'Lost', 50, 1),
]

describe('category tree', () => {
  it('nests sub-categories under their main, both in sort order; lost subs apart', () => {
    const tree = buildTree(CATEGORIES)
    expect(tree.groups.map(g => [g.main.categoryName, g.subs.map(s => s.categoryName)])).toEqual([
      ['Drinks', ['Coffee', 'Tea']],
      ['Food', ['Toast']],
    ])
    expect(tree.orphans.map(s => s.categoryName)).toEqual(['Lost'])
  })

  it('keeps a main as context when only its subs match', () => {
    const tree = filterTree(buildTree(CATEGORIES), { search: 'tea' })
    expect(tree.groups).toEqual([{ main: expect.objectContaining({ categoryName: 'Drinks' }), subs: [expect.objectContaining({ categoryName: 'Tea' })], contextOnly: true }])
  })

  it('filters by status, and ignores the "all" value', () => {
    const inactive = filterTree(buildTree(CATEGORIES), { status: 'INACTIVE' })
    expect(inactive.groups.map(g => [g.main.categoryName, g.subs.map(s => s.categoryName), !!g.contextOnly])).toEqual([['Drinks', ['Tea'], true]])
    expect(filterTree(buildTree(CATEGORIES), { status: 'ALL' }).groups).toHaveLength(2)
  })

  it('counts statuses under the current search', () => {
    expect(countStatuses(CATEGORIES)).toEqual({ ACTIVE: 5, INACTIVE: 1, all: 6 })
    expect(countStatuses(CATEGORIES, 'o')).toEqual({ ACTIVE: 4, INACTIVE: 0, all: 4 })
  })

  it('sends only the lists that changed, each whole and numbered from 1 per main', () => {
    const server = orderOf(buildTree(CATEGORIES))
    expect(server).toEqual({ mains: [1, 2], subs: { 1: [11, 12], 2: [21] } })
    expect(sortOrderChanges(server, { ...server, subs: { ...server.subs, 1: [12, 11] } })).toEqual({
      items: [{ id: 12, sortOrder: 1 }, { id: 11, sortOrder: 2 }],
    })
    expect(sortOrderChanges(server, { ...server, mains: [2, 1] })).toEqual({
      items: [{ id: 2, sortOrder: 1 }, { id: 1, sortOrder: 2 }],
    })
    expect(sortOrderChanges(server, server)).toEqual({ items: [] })
  })
})
