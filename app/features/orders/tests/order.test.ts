import { describe, expect, it } from 'vitest'
import { formatPickupNumber, nextStep, statusBadge } from '../utils/order'

describe('the order page (D100)', () => {
  it('pickup numbers have three digits', () => {
    expect([1, 42, 999, 1000].map(formatPickupNumber)).toEqual(['001', '042', '999', '1000'])
  })

  it('says what to do next: pay, and for a table, where it comes', () => {
    expect(nextStep({ status: 'awaiting_payment', orderType: 'pickup', table: null })).toBe('Pay at the counter to start your order. Show this number to the cashier.')
    expect(nextStep({ status: 'awaiting_payment', orderType: 'dine_in', table: { label: 'T12' } })).toBe('Pay at the counter, then we\'ll bring it to Table T12.')
    expect(nextStep({ status: 'awaiting_payment', orderType: 'dine_in', table: { label: 'Table 4' } })).toBe('Pay at the counter, then we\'ll bring it to Table 4.')
    expect(nextStep({ status: 'cancelled', orderType: 'pickup', table: null })).toBe('')
  })

  it('waiting for payment is a warning, not a success', () => {
    expect(statusBadge('awaiting_payment')).toEqual({ label: 'Waiting for payment', color: 'warning' })
    expect(statusBadge('cancelled').color).toBe('error')
  })
})
