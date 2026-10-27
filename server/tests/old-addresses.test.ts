import { describe, expect, it } from 'vitest'
import { movedCafeTarget } from '#server/utils/old-addresses'

describe('a cafe\'s former address (D142)', () => {
  it('moves to its current one, with the rest of the path and the query', () => {
    expect(movedCafeTarget('/c/nuk', 'nuk-coffee')).toBe('/c/nuk-coffee')
    expect(movedCafeTarget('/c/nuk?table=1', 'nuk-coffee')).toBe('/c/nuk-coffee?table=1')
    expect(movedCafeTarget('/c/nuk/admin/products?item=i1', 'nuk-coffee')).toBe('/c/nuk-coffee/admin/products?item=i1')
    expect(movedCafeTarget('/c/nuk/counter/b1', 'nuk-coffee')).toBe('/c/nuk-coffee/counter/b1')
  })
})
