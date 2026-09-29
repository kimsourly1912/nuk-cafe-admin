import { describe, expect, it } from 'vitest'
import type { CheckoutQuote, QuoteLine } from '#shared/contracts/orders'
import { ApiError } from '~/utils/api-error'
import { addLine, canAddLine, lineKey, parseLines, setLineNote } from '../utils/cart'
import type { CartLine } from '../utils/cart'
import { orderLines, placeFailure, priceChange } from '../utils/checkout'

const cartLine = (variationId: string, over: Partial<CartLine> = {}): CartLine =>
  ({ key: lineKey(variationId, []), itemId: `item-${variationId}`, variationId, modifierIds: [], quantity: 1, name: variationId, note: null, ...over })

const quoteLine = (variationId: string, unitPriceMinor: number | null, quantity = 1): QuoteLine => ({
  itemId: `item-${variationId}`, variationId, modifierIds: [], quantity, note: null, name: variationId, detail: '', modifiers: [], imageUrl: null,
  unitPriceMinor, totalMinor: unitPriceMinor === null ? null : unitPriceMinor * quantity, problem: null,
})
const quote = (lines: QuoteLine[]): CheckoutQuote => ({
  branch: { id: 'b', name: 'Riverside', address: null, phone: null, timezone: 'Asia/Phnom_Penh', openNow: true, closesInMinutes: 600, nextOpening: null },
  currency: 'USD', at: '2026-09-29T03:00:00.000Z', expiresAt: '2026-09-29T03:10:00.000Z', lines,
  subtotalMinor: lines.reduce((sum, l) => sum + (l.totalMinor ?? 0), 0), totalMinor: lines.reduce((sum, l) => sum + (l.totalMinor ?? 0), 0), problems: [], orderable: true,
})

describe('the order as sent (D100)', () => {
  it('notes only when placing, trimmed, blank as none', () => {
    const lines = [cartLine('v1', { note: ' Less ice ' }), cartLine('v2', { note: '   ' })]
    expect(orderLines(lines, { withNotes: false }).map(l => l.note)).toEqual([null, null])
    expect(orderLines(lines, { withNotes: true }).map(l => l.note)).toEqual(['Less ice', null])
  })

  it('a note is cut at 140 characters and survives a reload', () => {
    const [line] = setLineNote([cartLine('v1')], lineKey('v1', []), 'x'.repeat(200))
    expect(line!.note).toHaveLength(140)
    expect(parseLines(JSON.parse(JSON.stringify([line])))[0]!.note).toHaveLength(140)
    expect(setLineNote([cartLine('v1', { note: 'a' })], lineKey('v1', []), '  ')[0]!.note).toBeNull()
  })

  it('30 different lines at most; more of a line already there still counts', () => {
    const full = Array.from({ length: 30 }, (_, i) => cartLine(`v${i}`))
    expect(canAddLine(full, { variationId: 'new', modifierIds: [] })).toBe(false)
    expect(addLine(full, { itemId: 'x', variationId: 'new', modifierIds: [], quantity: 1, name: 'New' })).toHaveLength(30)
    expect(addLine(full, { itemId: 'item-v3', variationId: 'v3', modifierIds: [], quantity: 1, name: 'v3' }).find(l => l.variationId === 'v3')!.quantity).toBe(2)
  })
})

describe('price changes the customer didn\'t cause', () => {
  it('a new unit price is a change, with the old price and the total they saw', () => {
    const seen = quote([quoteLine('v1', 425, 2), quoteLine('v2', 250)])
    const next = quote([quoteLine('v1', 450, 2), quoteLine('v2', 250)])
    const change = priceChange(seen, next)!
    expect([...change.previousUnitPrices]).toEqual([[lineKey('v1', []), 425]])
    expect([seen.totalMinor, change.previousTotalMinor, next.totalMinor]).toEqual([1100, 1100, 1150])
  })

  it('their own quantity change, a removed line, or the first quote isn\'t', () => {
    const seen = quote([quoteLine('v1', 425, 1), quoteLine('v2', 250)])
    expect(priceChange(seen, quote([quoteLine('v1', 425, 3), quoteLine('v2', 250)]))).toBeNull()
    expect(priceChange(seen, quote([quoteLine('v1', 425, 1)]))).toBeNull()
    expect(priceChange(null, seen)).toBeNull()
  })
})

describe('a refused order', () => {
  const refused = (status: number, code: string) => ApiError.fromResponse(status, { statusCode: status, data: { code, message: `server: ${code}` } })

  it('prices, items or hours changed: ask again and say why', () => {
    for (const code of ['PRICES_CHANGED', 'ORDER_NOT_ORDERABLE', 'ORDERING_CLOSED']) {
      expect(placeFailure(refused(409, code))).toEqual({ kind: 'requote', message: `server: ${code}` })
    }
  })

  it('a table, the unpaid limit, the gates, and a lost answer', () => {
    expect(placeFailure(refused(409, 'TABLE_UNAVAILABLE')).kind).toBe('table')
    expect(placeFailure(refused(409, 'TOO_MANY_UNPAID_ORDERS')).kind).toBe('stop')
    expect(placeFailure(refused(403, 'EMAIL_NOT_VERIFIED')).kind).toBe('verify')
    expect(placeFailure(ApiError.fromResponse(401, {})).kind).toBe('signIn')
    expect(placeFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'retry', message: 'We couldn\'t confirm your order. Try again: you won\'t get a second order.' })
    expect(placeFailure(ApiError.fromResponse(500, {})).kind).toBe('retry')
  })
})
