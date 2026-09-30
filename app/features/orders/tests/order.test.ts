import { describe, expect, it } from 'vitest'
import type { Order } from '#shared/contracts/orders'
import { cancellationText, countdown, formatPickupNumber, nextStep, orderBarText, paymentText, placedText, statusBadge, trackerSteps } from '../utils/order'

const payment = (over: Partial<NonNullable<Order['payment']>> = {}): NonNullable<Order['payment']> => ({
  method: 'cash_usd', amountMinor: 975, amountKhr: null, collectedAt: '2026-09-30T03:21:00.000Z', returnMethod: null, returnedAt: null, ...over,
})

describe('the order page (D100, D114)', () => {
  it('pickup numbers have three digits', () => {
    expect([1, 42, 999, 1000].map(formatPickupNumber)).toEqual(['001', '042', '999', '1000'])
  })

  it('says what to do next; dine-in is collected at the counter too (D106)', () => {
    expect(nextStep({ status: 'awaiting_payment' })).toBe('Pay at the counter to start your order. Show this number to the cashier.')
    expect(nextStep({ status: 'preparing' })).toContain('We\'re making your order')
    expect(nextStep({ status: 'ready' })).toBe('Show this number at the counter.')
    expect(nextStep({ status: 'cancelled' })).toBe('')
  })

  it('colors: waiting is a warning, ready and completed success, cancelled neutral (not an error)', () => {
    expect(statusBadge('awaiting_payment')).toMatchObject({ label: 'Waiting for payment', color: 'warning' })
    expect(statusBadge('ready').color).toBe('success')
    expect(statusBadge('completed').color).toBe('success')
    expect(statusBadge('cancelled').color).toBe('neutral')
  })

  it('the tracker: nothing done while unpaid, the current step while in progress, all done when picked up', () => {
    const states = (status: Parameters<typeof trackerSteps>[0]) => trackerSteps(status).map(s => s.state)
    expect(states('awaiting_payment')).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming'])
    expect(states('preparing')).toEqual(['done', 'current', 'upcoming', 'upcoming'])
    expect(states('ready')).toEqual(['done', 'done', 'current', 'upcoming'])
    expect(states('completed')).toEqual(['done', 'done', 'done', 'done'])
    expect(trackerSteps('ready').map(s => s.label)).toEqual(['Paid', 'Preparing', 'Ready', 'Picked up'])
  })

  it('the countdown: minutes rounded up, urgent in the last 5, over at the time', () => {
    const due = '2026-09-30T03:45:00.000Z'
    const at = (iso: string) => countdown(due, Date.parse(iso))
    expect(at('2026-09-30T03:17:00.000Z')).toEqual({ minutes: 28, urgent: false, over: false })
    expect(at('2026-09-30T03:39:30.000Z')).toEqual({ minutes: 6, urgent: false, over: false })
    expect(at('2026-09-30T03:40:00.000Z')).toEqual({ minutes: 5, urgent: true, over: false })
    expect(at('2026-09-30T03:44:59.000Z')).toEqual({ minutes: 1, urgent: true, over: false })
    expect(at('2026-09-30T03:45:00.000Z')).toEqual({ minutes: 0, urgent: true, over: true })
    expect(at('2026-09-30T04:00:00.000Z').over).toBe(true)
  })

  it('why it was cancelled, in the customer\'s words, with the money returned', () => {
    expect(cancellationText({ cancellation: { by: 'system', reason: null }, payment: null, totalMinor: 975 })).toEqual({ title: 'Not paid within 30 minutes', detail: null })
    expect(cancellationText({ cancellation: { by: 'customer', reason: 'customer_changed_mind' }, payment: null, totalMinor: 975 }).title).toBe('You cancelled this order')
    expect(cancellationText({ cancellation: { by: 'cafe', reason: 'item_unavailable' }, payment: payment({ returnMethod: 'cash', returnedAt: '2026-09-30T03:30:00.000Z' }), totalMinor: 975 }))
      .toEqual({ title: 'Cancelled by the cafe: item unavailable.', detail: '$9.75 returned in cash.' })
    expect(cancellationText({ cancellation: { by: 'cafe', reason: 'other' }, payment: payment({ method: 'khqr', returnMethod: 'khqr' }), totalMinor: 975 }).detail).toBe('$9.75 returned by KHQR.')
  })

  it('the payment line, in riel for cash riel', () => {
    expect(paymentText({ payment: null })).toBeNull()
    expect(paymentText({ payment: payment() })).toMatch(/^Paid \$9\.75 · Cash · \d{1,2}:\d{2} [AP]M$/)
    expect(paymentText({ payment: payment({ method: 'cash_khr', amountKhr: 40_000 }) })).toMatch(/^Paid ៛40,000 · Cash \(riel\) · /)
  })

  it('when it was placed: today with the time, yesterday, then the date', () => {
    const now = new Date(2026, 8, 30, 15, 0).getTime()
    expect(placedText(new Date(2026, 8, 30, 10, 15).toISOString(), now)).toBe('Today 10:15 AM')
    expect(placedText(new Date(2026, 8, 29, 18, 0).toISOString(), now)).toBe('Yesterday')
    expect(placedText(new Date(2026, 8, 28, 9, 0).toISOString(), now)).toBe('Sep 28')
    expect(placedText(new Date(2025, 11, 31, 9, 0).toISOString(), now)).toBe('Dec 31, 2025')
  })

  it('the menu\'s bar: one order by number, ready in green, several as a count', () => {
    expect(orderBarText([])).toBeNull()
    expect(orderBarText([{ pickupNumber: 42, status: 'preparing' }])).toEqual({ text: 'Order 042 · Preparing', ready: false })
    expect(orderBarText([{ pickupNumber: 42, status: 'ready' }])).toEqual({ text: 'Order 042 is ready', ready: true })
    expect(orderBarText([{ pickupNumber: 42, status: 'preparing' }, { pickupNumber: 43, status: 'awaiting_payment' }])).toEqual({ text: '2 orders in progress', ready: false })
    expect(orderBarText([{ pickupNumber: 42, status: 'ready' }, { pickupNumber: 43, status: 'awaiting_payment' }])?.ready).toBe(true)
  })
})
