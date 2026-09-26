import { describe, expect, it } from 'vitest'
import { ANY, toApiQuery } from '../../app/utils/query'

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
