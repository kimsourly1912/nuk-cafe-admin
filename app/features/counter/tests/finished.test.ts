import { describe, expect, it } from 'vitest'
import type { CounterOrder, CounterOrderHistory, CounterPayment } from '#shared/contracts/orders'
import { cancellationSummary, filterFinished, finishedAt, itemSummary, paymentNote, timelineItems } from '../utils/finished'

const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00`).toISOString()

const payment = (over: Partial<CounterPayment> = {}): CounterPayment => ({
  method: 'cash_usd', amountMinor: 450, amountKhr: null, khrPerUsd: null, reference: null, khqrChargeId: null,
  collectedAt: at('10:47'), collectedBy: { name: 'Sophea Keo' }, returnMethod: null, returnedAt: null, ...over,
})

const order = (over: Partial<CounterOrder> = {}): CounterOrder => ({
  id: 'o1', version: 3, pickupNumber: 51, businessDate: '2026-09-30', status: 'cancelled', orderType: 'pickup', table: null,
  customer: { name: 'Bopha Lim' },
  lines: [{ itemId: 'i', variationId: 'v', itemName: 'Iced Latte', detail: 'Large · Oat milk', modifiers: [], unitPriceMinor: 450, quantity: 1, totalMinor: 450, note: null }],
  totalMinor: 450, placedAt: at('10:45'), paymentDueAt: at('11:15'), paidAt: at('10:47'), readyAt: null, completedAt: null, cancelledAt: at('11:00'),
  payment: payment(), ...over,
})

describe('finished today (step 10.2, D117)', () => {
  it('a row: when it finished, the payment note, the items', () => {
    expect(finishedAt(order())).toBe(at('11:00'))
    expect(finishedAt(order({ status: 'completed', completedAt: at('10:34'), cancelledAt: null }))).toBe(at('10:34'))
    expect(paymentNote(order({ payment: null }))).toBe('Unpaid')
    expect(paymentNote(order({ payment: payment({ method: 'khqr' }) }))).toBe('KHQR')
    expect(paymentNote(order({ payment: payment({ returnMethod: 'cash', returnedAt: at('11:02') }) }))).toBe('Cash USD · Returned')
    expect(itemSummary(order({ lines: [...order().lines, { ...order().lines[0]!, itemName: 'Banana Bread', quantity: 2 }] }))).toBe('1 × Iced Latte, 2 × Banana Bread')
  })

  it('the chips filter by status', () => {
    const list = [order({ id: 'a', status: 'completed' }), order({ id: 'b' })]
    expect(filterFinished(list, 'all')).toHaveLength(2)
    expect(filterFinished(list, 'completed').map(o => o.id)).toEqual(['a'])
    expect(filterFinished(list, 'cancelled').map(o => o.id)).toEqual(['b'])
  })

  const cancelledByStaff: CounterOrderHistory = {
    order: order({ payment: payment({ returnMethod: 'cash', returnedAt: at('11:02') }) }),
    timeline: [
      { at: at('10:45'), toStatus: 'awaiting_payment', by: { kind: 'customer', name: 'Bopha' }, reason: null, note: null },
      { at: at('10:47'), toStatus: 'preparing', by: { kind: 'staff', name: 'Sophea Keo' }, reason: null, note: null },
      { at: at('11:00'), toStatus: 'cancelled', by: { kind: 'staff', name: 'Sophea Keo' }, reason: 'item_unavailable', note: 'Out of oat milk' },
    ],
    returnedBy: 'Sophea Keo',
  }

  it('the cancellation card: who and why (first names), the staff note, the money returned', () => {
    expect(cancellationSummary(cancelledByStaff)).toEqual({
      title: 'Cancelled by Sophea: item unavailable',
      note: 'Out of oat milk',
      returned: expect.stringMatching(/^\$4\.50 returned in cash by Sophea at \d{1,2}:\d{2} [AP]M$/),
    })
    const expired: CounterOrderHistory = { order: order({ payment: null }), timeline: [cancelledByStaff.timeline[0]!, { at: at('11:15'), toStatus: 'cancelled', by: { kind: 'system', name: null }, reason: null, note: null }], returnedBy: null }
    expect(cancellationSummary(expired)).toEqual({ title: 'Not paid in 30 minutes', note: null, returned: null })
    const byCustomer: CounterOrderHistory = { ...expired, timeline: [cancelledByStaff.timeline[0]!, { ...expired.timeline[1]!, by: { kind: 'customer', name: 'Bopha' } }] }
    expect(cancellationSummary(byCustomer)?.title).toBe('Cancelled by the customer')
    expect(cancellationSummary({ ...expired, timeline: [cancelledByStaff.timeline[0]!] })).toBeNull()
  })

  it('the timeline: each step with who took it, the payment on Paid, the money returned as its own step', () => {
    expect(timelineItems(cancelledByStaff).map(step => [step.label, step.detail])).toEqual([
      ['Placed', 'by the customer (Bopha)'],
      ['Paid', 'Cash USD $4.50 · by Sophea'],
      ['Cancelled', 'by Sophea'],
      ['Cash returned', 'by Sophea'],
    ])
  })
})
