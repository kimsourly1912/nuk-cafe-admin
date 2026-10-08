import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { PlatformOwner } from '#shared/contracts/tenants'
import { cafeFormSchema, emptyCafeForm, lastOrderText, nowOwnsLine, ownedCafesLine, usageLine } from '../schemas/cafe-form'

// The New cafe form (D142, D146) and the console's usage lines.

const filled = () => ({ ...emptyCafeForm(), name: 'Brown Bean', slug: 'Brown-Bean' })

describe('the New cafe form', () => {
  it('starts with a main branch in Phnom Penh time and a new person, and refuses empty fields', () => {
    const empty = emptyCafeForm()
    expect(empty).toMatchObject({ branchName: 'Main branch', timezone: 'Asia/Phnom_Penh', owner: { kind: 'new' } })
    const result = v.safeParse(cafeFormSchema, empty)
    expect(result.success).toBe(false)
    expect(Object.keys(v.flatten(result.issues!).nested ?? {}).sort()).toEqual(['name', 'owner.email', 'owner.name', 'slug'])
  })

  it('sends a new person with the address and email lowercased', () => {
    const form = filled()
    form.owner = { ...form.owner, name: 'Bea', email: 'Bea@Example.com', userId: 'left-over' }
    expect(v.parse(cafeFormSchema, form)).toEqual({
      name: 'Brown Bean', slug: 'brown-bean', branchName: 'Main branch', timezone: 'Asia/Phnom_Penh',
      owner: { kind: 'new', name: 'Bea', email: 'bea@example.com' },
    })
  })

  it('sends only the chosen existing owner, and needs one chosen', () => {
    const form = filled()
    form.owner = { kind: 'existing', userId: '', name: 'typed before', email: 'x@example.com' }
    const result = v.safeParse(cafeFormSchema, form)
    expect(Object.keys(v.flatten(result.issues!).nested ?? {})).toEqual(['owner.userId'])
    form.owner.userId = 'u-1'
    expect(v.parse(cafeFormSchema, form).owner).toEqual({ kind: 'existing', userId: 'u-1' })
  })

  it('opens with the owner of a cafe\'s page chosen', () => {
    expect(emptyCafeForm({ owner: { id: 'u-1', name: 'Bea', email: 'bea@example.com' } }).owner).toMatchObject({ kind: 'existing', userId: 'u-1' })
  })
})

describe('an owner\'s cafes', () => {
  const owner = (...names: string[]): PlatformOwner => ({ id: 'u-1', name: 'Bea Brown', email: 'bea@example.com', cafes: names.map((name, i) => ({ id: `c${i}`, name, slug: `c${i}` })) })

  it('reads as a sentence', () => {
    expect(ownedCafesLine(owner())).toBe('Owns no cafe yet')
    expect(ownedCafesLine(owner('NUK Cafe'))).toBe('Owns NUK Cafe')
    expect(ownedCafesLine(owner('NUK Cafe', 'Brown Bean', 'Tea Kiosk'))).toBe('Owns NUK Cafe, Brown Bean and Tea Kiosk')
    expect(nowOwnsLine(owner('Brown Bean'))).toBe('Bea Brown owns this cafe.')
    expect(nowOwnsLine(owner('Brown Bean', 'NUK Cafe'))).toBe('Bea Brown now owns 2 cafes: Brown Bean and NUK Cafe.')
    expect(nowOwnsLine(owner('A', 'B', 'C', 'D', 'E'))).toBe('Bea Brown now owns 5 cafes: A, B, C and 2 more.')
  })
})

describe('usage', () => {
  it('reads as one line', () => {
    expect(usageLine({ branches: 1, staff: 3, ordersLast30Days: 12, lastOrderAt: null })).toBe('1 branch · 3 staff · 12 orders in 30 days')
    expect(usageLine({ branches: 2, staff: 0, ordersLast30Days: 1, lastOrderAt: null })).toBe('2 branches · 0 staff · 1 order in 30 days')
  })

  it('says how long ago the last order was', () => {
    const now = new Date('2026-10-03T12:00:00Z')
    expect(lastOrderText(null, now)).toBe('No orders yet')
    expect(lastOrderText('2026-10-03T11:59:40Z', now)).toBe('Last order just now')
    expect(lastOrderText('2026-10-03T11:55:00Z', now)).toBe('Last order 5 minutes ago')
    expect(lastOrderText('2026-10-03T09:00:00Z', now)).toBe('Last order 3 hours ago')
    expect(lastOrderText('2026-10-02T09:00:00Z', now)).toBe('Last order yesterday')
    expect(lastOrderText('2026-09-01T09:00:00Z', now)).toBe('Last order 32 days ago')
  })
})
