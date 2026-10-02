import { describe, expect, it } from 'vitest'
import { khqrAmountText, khqrTimeLeft } from '../utils/khqr'

describe('KHQR at the counter (D130)', () => {
  it('shows the amount in the QR\'s currency', () => {
    expect(khqrAmountText({ currency: 'USD', amount: 875 })).toBe('$8.75')
    expect(khqrAmountText({ currency: 'KHR', amount: 35_900 })).toBe('៛35,900')
  })

  it('counts down by the server\'s clock, rounding seconds up, and expires at 0', () => {
    const expiresAt = '2026-09-28T05:15:00.000Z'
    const at = (iso: string) => Date.parse(iso)
    expect(khqrTimeLeft(expiresAt, at('2026-09-28T05:00:00.000Z'))).toEqual({ expired: false, label: '15:00' })
    expect(khqrTimeLeft(expiresAt, at('2026-09-28T05:14:59.200Z'))).toEqual({ expired: false, label: '0:01' })
    expect(khqrTimeLeft(expiresAt, at('2026-09-28T05:15:00.000Z'))).toEqual({ expired: true, label: '0:00' })
    // This tablet runs 2 minutes slow: the server says 05:02 when it says 05:00.
    expect(khqrTimeLeft(expiresAt, at('2026-09-28T05:00:00.000Z'), 120_000)).toEqual({ expired: false, label: '13:00' })
  })
})
