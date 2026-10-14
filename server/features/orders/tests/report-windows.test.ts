import { describe, expect, it } from 'vitest'
import { businessDateAt, paymentWindows } from '#server/features/orders/reports.rules'
import { localTime } from '#server/utils/weekly-windows'

describe('report windows follow the wall clock', () => {
  it.each([
    ['2026-10-24', 'Europe/Berlin'],
    ['2026-03-07', 'America/New_York'],
    ['2026-10-31', 'America/New_York'],
    ['2026-10-03', 'Australia/Lord_Howe'],
    ['2026-04-04', 'Australia/Lord_Howe'],
    ['2026-10-14', 'Asia/Kathmandu'],
  ])('never aggregates different local hours together (%s, %s)', (date, zone) => {
    const windows = paymentWindows({ from: date, to: date }, zone)
    for (const window of windows) {
      const expected = Math.floor(localTime(new Date(window.start), zone).minute / 60)
      for (let instant = window.start; instant < window.end; instant += 15 * 60_000) {
        expect(Math.floor(localTime(new Date(instant), zone).minute / 60)).toBe(expected)
      }
    }
  })

  it('uses 04:00 local rather than four elapsed hours on a DST day', () => {
    expect(businessDateAt(new Date('2026-11-01T03:30:00-05:00'), 'America/New_York')).toBe('2026-10-31')
    expect(businessDateAt(new Date('2026-11-01T04:00:00-05:00'), 'America/New_York')).toBe('2026-11-01')
    expect(businessDateAt(new Date('2026-03-08T04:00:00-04:00'), 'America/New_York')).toBe('2026-03-08')
  })
})
