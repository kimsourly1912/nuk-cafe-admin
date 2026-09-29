import { describe, expect, it } from 'vitest'
import type { CounterOrder } from '#shared/contracts/orders'
import { ApiError } from '~/utils/api-error'
import { changeDue, commandFailure, firstName, formatRiel, itemCount, itemNames, matchesSearch, orderTypeText, payBySoon, rielQuickAmounts, timeAgo, usdQuickAmounts } from '../utils/counter'

const order = (over: Partial<CounterOrder> = {}): CounterOrder => ({
  id: 'o1', version: 1, pickupNumber: 42, businessDate: '2026-09-29', status: 'awaiting_payment', orderType: 'pickup', table: null,
  customer: { name: 'Sokha Chan' },
  lines: [
    { itemId: 'i1', itemName: 'Iced Latte', detail: 'Large', modifiers: [], unitPriceMinor: 475, quantity: 1, totalMinor: 475, note: null },
    { itemId: 'i2', itemName: 'Banana Bread', detail: '', modifiers: [], unitPriceMinor: 250, quantity: 2, totalMinor: 500, note: null },
  ],
  totalMinor: 975, placedAt: '2026-09-29T03:00:00.000Z', paymentDueAt: '2026-09-29T03:30:00.000Z',
  paidAt: null, readyAt: null, completedAt: null, cancelledAt: null, payment: null, ...over,
})
const at = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00.000Z`)

describe('what a card says (D102)', () => {
  it('number, type, first name, items', () => {
    expect(orderTypeText(order())).toBe('Pickup')
    expect(orderTypeText(order({ orderType: 'dine_in', table: { label: 'T01' } }))).toBe('Dine-in · Table T01')
    expect(orderTypeText(order({ orderType: 'dine_in', table: { label: 'Table 4' } }))).toBe('Dine-in · Table 4')
    expect(firstName('Sokha Chan')).toBe('Sokha')
    expect(itemCount(order())).toBe('3 items')
    expect(itemNames(order())).toBe('Iced Latte, Banana Bread')
  })

  it('time since placed, and the last 5 minutes to pay', () => {
    expect(timeAgo('2026-09-29T03:00:00.000Z', at('03:00'))).toBe('Just now')
    expect(timeAgo('2026-09-29T03:00:00.000Z', at('03:04'))).toBe('4 min ago')
    expect(timeAgo('2026-09-29T03:00:00.000Z', at('04:05'))).toBe('1 h 5 min ago')
    expect(payBySoon(order(), at('03:25'))).toBe(false)
    expect(payBySoon(order(), at('03:26'))).toBe(true)
  })

  it('search by number (with or without zeros) or name', () => {
    expect(matchesSearch(order(), '42')).toBe(true)
    expect(matchesSearch(order(), '042')).toBe(true)
    expect(matchesSearch(order(), '41')).toBe(false)
    expect(matchesSearch(order(), 'sok')).toBe(true)
    expect(matchesSearch(order(), '  ')).toBe(true)
  })
})

describe('money at the counter', () => {
  it('quick amounts above the total, three at most', () => {
    expect(usdQuickAmounts(725)).toEqual([1000, 2000, 5000])
    expect(usdQuickAmounts(1000)).toEqual([2000, 5000])
    expect(rielQuickAmounts(29_800)).toEqual([30_000, 40_000, 50_000])
  })

  it('change: nothing typed is exact; less is short', () => {
    expect(changeDue(725, null)).toEqual({ kind: 'exact' })
    expect(changeDue(725, 1000)).toEqual({ kind: 'change', amount: 275 })
    expect(changeDue(725, 500)).toEqual({ kind: 'short', amount: 225 })
    expect(formatRiel(35_900)).toBe('៛35,900')
  })
})

describe('a refused command', () => {
  const refused = (code: string, status = 409) => ApiError.fromResponse(status, { code, message: `server says ${code}` })

  it('changed meanwhile, the rate, expired, or no answer', () => {
    expect(commandFailure(refused('ORDER_CHANGED'), 'payment')).toEqual({ kind: 'changed', message: 'server says ORDER_CHANGED' })
    expect(commandFailure(refused('EXCHANGE_RATE_CHANGED'), 'payment').kind).toBe('changed')
    expect(commandFailure(refused('PAYMENT_EXPIRED'), 'payment').kind).toBe('expired')
    expect(commandFailure(new TypeError('fetch failed'), 'payment')).toEqual({ kind: 'retry', message: 'We couldn\'t confirm the payment. Try again: it won\'t be recorded twice.' })
    expect(commandFailure(refused('INTERNAL', 500), 'cancellation').kind).toBe('retry')
    expect(commandFailure(refused('VALIDATION_FAILED', 400), 'cancellation').kind).toBe('other')
  })
})
