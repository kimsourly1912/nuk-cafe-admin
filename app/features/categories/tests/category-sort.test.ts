import { describe, expect, it } from 'vitest'
import type { Category } from '#shared/contracts/menu'
import { bySortOrder, mergeOrder, moveItem } from '../schemas/category-sort'

const category = (id: string, name: string, sortOrder: number) => ({ id, name, sortOrder }) as Category

describe('category sort order', () => {
  it('orders by sortOrder, then name', () => {
    const list = [category('a', 'Tea', 2), category('b', 'Juice', 1), category('c', 'Coffee', 2)]
    expect(bySortOrder(list).map(c => c.name)).toEqual(['Juice', 'Coffee', 'Tea'])
  })

  it('keeps a local order in line with the latest list', () => {
    // 'c' was deleted elsewhere, 'h' was added elsewhere.
    expect(mergeOrder(['d', 'c', 'a'], ['a', 'd', 'h'])).toEqual(['d', 'a', 'h'])
    expect(mergeOrder([], ['b', 'a'])).toEqual(['b', 'a'])
  })

  it('moves one entry and ignores moves past either end', () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3])
  })
})
