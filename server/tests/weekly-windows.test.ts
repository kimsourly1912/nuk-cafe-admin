import { describe, expect, it } from 'vitest'
import { localDate, localTime, minutesUntilClosed } from '../utils/weekly-windows'
import { businessDateAt } from '../features/orders/orders.service'

const w = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute })
const at = (weekday: number, hhmm: string) => ({ weekday, minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) })

describe('minutesUntilClosed (D99)', () => {
  it('counts to the end of the window it\'s in; null outside every window', () => {
    expect(minutesUntilClosed([w(1, 420, 1260)], at(1, '20:30'))).toBe(30)
    expect(minutesUntilClosed([w(1, 420, 1260)], at(1, '21:00'))).toBeNull()
    expect(minutesUntilClosed([w(1, 420, 1260)], at(1, '06:59'))).toBeNull()
  })

  it('runs through back-to-back windows and past midnight', () => {
    // 07:00–12:00 then 12:00–21:00: one stretch.
    expect(minutesUntilClosed([w(1, 420, 720), w(1, 720, 1260)], at(1, '11:00'))).toBe(600)
    // Saturday 22:00–02:00, Sunday 02:00–04:00: from Saturday 23:00, five hours.
    expect(minutesUntilClosed([w(6, 1320, 120), w(7, 120, 240)], at(6, '23:00'))).toBe(300)
    // A gap stops it: 07:00–12:00 and 12:05–21:00.
    expect(minutesUntilClosed([w(1, 420, 720), w(1, 725, 1260)], at(1, '11:50'))).toBe(10)
  })

  it('open around the clock is a week at most', () => {
    const always = [1, 2, 3, 4, 5, 6, 7].map(day => w(day, 0, 1440))
    expect(minutesUntilClosed(always, at(3, '09:00'))).toBe(7 * 24 * 60)
  })
})

describe('local dates and the business day (Q39)', () => {
  it('the branch\'s calendar date, not UTC\'s', () => {
    // 2026-09-28 20:00 UTC is 03:00 on the 29th in Phnom Penh.
    expect(localDate(new Date('2026-09-28T20:00:00Z'), 'Asia/Phnom_Penh')).toBe('2026-09-29')
    expect(localTime(new Date('2026-09-28T20:00:00Z'), 'Asia/Phnom_Penh')).toEqual({ weekday: 2, minute: 180 })
  })

  it('a business day starts at 4:00: 03:59 still belongs to the day before', () => {
    expect(businessDateAt(new Date('2026-09-29T03:59:00+07:00'), 'Asia/Phnom_Penh')).toBe('2026-09-28')
    expect(businessDateAt(new Date('2026-09-29T04:00:00+07:00'), 'Asia/Phnom_Penh')).toBe('2026-09-29')
    expect(businessDateAt(new Date('2026-09-29T23:59:00+07:00'), 'Asia/Phnom_Penh')).toBe('2026-09-29')
  })
})
