import { describe, expect, it } from 'vitest'
import { bySortOrder, mergeOrder, moveItem } from '../schemas/category-sort'

describe('category sort order', () => {
  it('orders by sortOrder, then id', () => {
    const list = [{ id: 5, sortOrder: 2 }, { id: 9, sortOrder: 1 }, { id: 2, sortOrder: 2 }, { id: 1 }]
    expect(bySortOrder(list).map(c => c.id)).toEqual([1, 9, 2, 5])
  })

  it('keeps a local order in line with the latest list', () => {
    // 3 was deleted elsewhere, 8 was added elsewhere.
    expect(mergeOrder([4, 3, 1], [1, 4, 8])).toEqual([4, 1, 8])
    expect(mergeOrder([], [2, 1])).toEqual([2, 1])
  })

  it('moves one entry and ignores moves past either end', () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3])
  })
})
