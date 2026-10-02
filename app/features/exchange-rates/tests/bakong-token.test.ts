import { describe, expect, it } from 'vitest'
import { tokenExpiry } from '../utils/bakong-token'

describe('the Bakong token\'s expiry on Payments (D132)', () => {
  const expiresAt = '2026-12-21T00:00:00.000Z'
  const daysBefore = (days: number) => Date.parse(expiresAt) - days * 24 * 3_600_000

  it('counts whole days up, in the cafe\'s time zone, and warns within 14 days', () => {
    expect(tokenExpiry(expiresAt, daysBefore(80))).toEqual({ daysLeft: 80, tone: 'neutral', title: 'Token expires 21 Dec 2026 · 80 days left' })
    expect(tokenExpiry(expiresAt, daysBefore(15))).toMatchObject({ tone: 'neutral' })
    expect(tokenExpiry(expiresAt, daysBefore(13.2))).toEqual({ daysLeft: 14, tone: 'warning', title: 'Token expires 21 Dec 2026 · 14 days left' })
    expect(tokenExpiry(expiresAt, daysBefore(0.5))).toMatchObject({ daysLeft: 1, title: 'Token expires 21 Dec 2026 · 1 day left' })
  })

  it('says so once it has expired', () => {
    expect(tokenExpiry(expiresAt, daysBefore(0))).toEqual({ daysLeft: 0, tone: 'error', title: 'Token expired 21 Dec 2026' })
    expect(tokenExpiry(expiresAt, daysBefore(-3))).toMatchObject({ tone: 'error' })
  })
})
