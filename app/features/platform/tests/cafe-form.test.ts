import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { cafeFormSchema, emptyCafeForm, lastOrderText, usageLine } from '../schemas/cafe-form'

// The New cafe form and the console's usage lines (D142).

describe('the New cafe form', () => {
  it('starts with a main branch in Phnom Penh time and refuses empty fields', () => {
    const empty = emptyCafeForm()
    expect(empty).toMatchObject({ branchName: 'Main branch', timezone: 'Asia/Phnom_Penh' })
    const result = v.safeParse(cafeFormSchema, empty)
    expect(result.success).toBe(false)
    expect(Object.keys(v.flatten(result.issues!).nested ?? {}).sort()).toEqual(['name', 'ownerEmail', 'ownerName', 'slug'])
  })

  it('accepts a filled form, with the address and email lowercased', () => {
    const result = v.parse(cafeFormSchema, { ...emptyCafeForm(), name: 'Brown Bean', slug: 'Brown-Bean', ownerName: 'Bea', ownerEmail: 'Bea@Example.com' })
    expect(result).toMatchObject({ slug: 'brown-bean', ownerEmail: 'bea@example.com' })
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
