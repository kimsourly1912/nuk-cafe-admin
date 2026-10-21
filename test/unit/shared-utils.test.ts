import { describe, expect, it } from 'vitest'
import { slicePage, toPage } from '#shared/contracts/common'
import { groupBy } from '#shared/utils/collections'

describe('groupBy', () => {
  it('groups rows by key, keeping their order, and keys in first-seen order', () => {
    const lines = [{ order: 'b', n: 1 }, { order: 'a', n: 2 }, { order: 'b', n: 3 }]
    const groups = groupBy(lines, line => line.order)
    expect([...groups.keys()]).toEqual(['b', 'a'])
    expect(groups.get('b')!.map(line => line.n)).toEqual([1, 3])
    expect(groups.get('c')).toBeUndefined()
    expect(groupBy([], () => 'x').size).toBe(0)
  })
})

describe('toPage and slicePage', () => {
  it('builds a Page with its total pages (at least one)', () => {
    expect(toPage(['a', 'b'], { page: 2, pageSize: 2 }, 5)).toEqual({ items: ['a', 'b'], page: 2, pageSize: 2, total: 5, totalPages: 3 })
    expect(toPage([], { page: 1, pageSize: 20 }, 0)).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })
  })

  it('slices one page of a list held in memory', () => {
    const rows = [1, 2, 3, 4, 5]
    expect(slicePage(rows, { page: 1, pageSize: 2 })).toMatchObject({ items: [1, 2], total: 5, totalPages: 3 })
    expect(slicePage(rows, { page: 3, pageSize: 2 })).toMatchObject({ items: [5] })
    expect(slicePage(rows, { page: 4, pageSize: 2 })).toMatchObject({ items: [], total: 5 })
  })
})
