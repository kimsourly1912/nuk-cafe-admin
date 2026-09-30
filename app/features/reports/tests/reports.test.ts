import { describe, expect, it } from 'vitest'
import { chartPoints, niceScale } from '../utils/chart'
import { changeText, eventBy, eventTitle, hourLabel, orderTypeText, paymentBadge } from '../utils/display'
import { addDays, periodButtonLabel, periodLabel, presetOf, presetPeriod, previousLabel, validPeriod } from '../utils/period'

describe('report periods', () => {
  const today = '2026-09-30'

  it('builds the presets from the branch\'s business date', () => {
    expect(presetPeriod('today', today)).toEqual({ from: today, to: today })
    expect(presetPeriod('yesterday', today)).toEqual({ from: '2026-09-29', to: '2026-09-29' })
    expect(presetPeriod('last7', today)).toEqual({ from: '2026-09-24', to: today })
    expect(presetPeriod('thisMonth', today)).toEqual({ from: '2026-09-01', to: today })
    expect(presetPeriod('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' })
  })

  it('names a period by its preset, or by its dates', () => {
    expect(presetOf({ from: '2026-09-24', to: today }, today)).toBe('last7')
    expect(periodButtonLabel({ from: today, to: today }, today)).toBe('Today')
    expect(periodButtonLabel({ from: '2026-09-10', to: '2026-09-12' }, today)).toBe('10 – 12 Sep 2026')
    expect(periodLabel({ from: today, to: today })).toBe('Wed 30 Sep 2026')
    expect(periodLabel({ from: '2026-08-28', to: '2026-09-03' })).toBe('28 Aug – 3 Sep 2026')
    expect(periodLabel({ from: '2025-12-29', to: '2026-01-04' })).toBe('29 Dec 2025 – 4 Jan 2026')
  })

  it('falls back to today for a period no report can show', () => {
    expect(validPeriod('2026-09-01', '2026-09-30', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(validPeriod(undefined, undefined, today)).toEqual({ from: today, to: today })
    expect(validPeriod('2026-09-30', '2026-09-01', today)).toEqual({ from: today, to: today })
    expect(validPeriod('2026-09-01', '2026-10-01', today)).toEqual({ from: today, to: today })
    expect(validPeriod('2026-06-29', today, today)).toEqual({ from: today, to: today }) // 94 days
    expect(validPeriod('2026-06-30', today, today)).toEqual({ from: '2026-06-30', to: today }) // 93 days
    expect(validPeriod('30/09/2026', today, today)).toEqual({ from: today, to: today })
  })

  it('says what the change compares with', () => {
    expect(previousLabel({ from: today, to: today }, today)).toBe('vs yesterday')
    expect(previousLabel({ from: '2026-09-24', to: today }, today)).toBe('vs the 7 days before')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('report display', () => {
  it('trims an hour chart to the hours with sales, and keeps every day', () => {
    const hours = { unit: 'hour' as const, points: ['04', '05', '07', '08', '09'].map((key, i) => ({ key, salesMinor: [0, 0, 500, 0, 800][i]!, orders: 1 })) }
    expect(chartPoints(hours).map(p => p.key)).toEqual(['07', '08', '09'])
    expect(chartPoints({ unit: 'hour', points: [{ key: '04', salesMinor: 0, orders: 0 }] })).toEqual([])
    const days = { unit: 'day' as const, points: [{ key: '2026-09-29', salesMinor: 0, orders: 0 }] }
    expect(chartPoints(days)).toHaveLength(1)
  })

  it('picks round axis steps', () => {
    expect(niceScale(24_950)).toEqual({ top: 30_000, step: 10_000 })
    expect(niceScale(875)).toEqual({ top: 1000, step: 500 })
    expect(niceScale(0)).toEqual({ top: 100, step: 100 })
  })

  it('labels payment, type, hours and the change', () => {
    expect(paymentBadge({ state: 'paid', method: 'khqr' })).toEqual({ label: 'Paid · KHQR', color: 'success' })
    expect(paymentBadge({ state: 'refunded', method: 'cash_khr' }).label).toBe('Refunded')
    expect(orderTypeText({ orderType: 'dine_in', tableLabel: 'T4' })).toBe('Dine-in · T4')
    expect(hourLabel('00')).toBe('12 AM')
    expect(hourLabel('13')).toBe('1 PM')
    expect(changeText(11_200, 10_000)).toEqual({ text: '+12%', up: true })
    expect(changeText(9_200, 10_000)).toEqual({ text: '−8%', up: false })
    expect(changeText(100, 0)).toBeNull()
  })

  it('names only who actually took each step', () => {
    expect(eventTitle({ fromStatus: null, toStatus: 'awaiting_payment' })).toBe('Placed')
    expect(eventTitle({ fromStatus: 'awaiting_payment', toStatus: 'preparing' })).toBe('Paid')
    expect(eventBy({ by: { kind: 'system', name: null }, toStatus: 'cancelled' })).toBe('Automatically (not paid in 30 minutes)')
    expect(eventBy({ by: { kind: 'customer', name: 'Sokha' }, toStatus: 'cancelled' })).toBe('By the customer')
    expect(eventBy({ by: { kind: 'staff', name: 'Dara' }, toStatus: 'ready' })).toBe('By Dara')
  })
})
