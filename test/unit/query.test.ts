import { describe, expect, it } from 'vitest'
import { ANY, fromUrlQuery, toApiQuery, toUrlQuery } from '../../app/utils/query'

describe('toApiQuery', () => {
  it('drops the ANY sentinel and empty strings', () => {
    expect(toApiQuery({ search: '', status: ANY, type: 'MAIN', page: 0 })).toEqual({
      search: undefined,
      status: undefined,
      type: 'MAIN',
      page: 0,
    })
  })
})

const DEFAULTS = { search: '', status: ANY, minPoints: 0 }

describe('toUrlQuery', () => {
  it('writes only non-default values, and the page only after page 1', () => {
    expect(toUrlQuery(DEFAULTS, DEFAULTS, 1)).toEqual({})
    expect(toUrlQuery({ search: 'tea', status: ANY, minPoints: 10 }, DEFAULTS, 3)).toEqual({ search: 'tea', minPoints: '10', page: '3' })
  })
})

describe('fromUrlQuery', () => {
  it('reads values typed by the defaults', () => {
    expect(fromUrlQuery({ search: 'tea', status: 'ACTIVE', minPoints: '10', page: '2' }, DEFAULTS))
      .toEqual({ filters: { search: 'tea', status: 'ACTIVE', minPoints: 10 }, page: 2 })
  })

  it('falls back to defaults for missing or unreadable values', () => {
    expect(fromUrlQuery({ minPoints: 'abc', page: '-1', unknown: 'x' }, DEFAULTS)).toEqual({ filters: DEFAULTS, page: 1 })
    expect(fromUrlQuery({ search: ['a', 'b'], page: '1.5' }, DEFAULTS)).toEqual({ filters: DEFAULTS, page: 1 })
  })

  it('round-trips with toUrlQuery', () => {
    const state = { filters: { search: 'green tea', status: 'INACTIVE', minPoints: 5 }, page: 4 }
    expect(fromUrlQuery(toUrlQuery(state.filters, DEFAULTS, state.page), DEFAULTS)).toEqual(state)
  })
})
