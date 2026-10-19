import { describe, expect, it } from 'vitest'
import { accessLine, banLine, banUntil } from '../schemas/account-form'

describe('accessLine', () => {
  it('names what the account does, a customer when nothing else', () => {
    expect(accessLine({ isSuperadmin: false, ownerOf: 0, staffOf: 0 })).toBe('Customer')
    expect(accessLine({ isSuperadmin: false, ownerOf: 1, staffOf: 0 })).toBe('Owner of 1 cafe')
    expect(accessLine({ isSuperadmin: false, ownerOf: 2, staffOf: 1 })).toBe('Owner of 2 cafes · Staff at 1')
    expect(accessLine({ isSuperadmin: true, ownerOf: 0, staffOf: 0 })).toBe('Super admin')
  })
})

describe('banUntil', () => {
  const now = new Date('2026-10-19T10:00:00.000Z')

  it('is null until unbanned, else the days after now', () => {
    expect(banUntil('forever', now)).toBeNull()
    expect(banUntil('1', now)).toBe('2026-10-20T10:00:00.000Z')
    expect(banUntil('30', now)).toBe('2026-11-18T10:00:00.000Z')
  })
})

describe('banLine', () => {
  it('says how long', () => {
    expect(banLine({ reason: null, until: null })).toBe('Banned until unbanned')
    expect(banLine({ reason: 'x', until: '2026-10-20T10:00:00.000Z' })).toMatch(/^Banned until 20 Oct 2026/)
  })
})
