import { describe, expect, it } from 'vitest'
import type { WeeklyTime } from '../utils/timezone'
import { shiftWeekly, zoneLabel, zoneOffsetMinutes, zoneShift } from '../utils/timezone'

const WINTER = new Date('2026-01-15T12:00:00Z')
const SUMMER = new Date('2026-07-15T12:00:00Z')

describe('schedule timezones', () => {
  it('reads zone offsets, including half hours and daylight saving time', () => {
    expect(zoneOffsetMinutes('UTC')).toBe(0)
    expect(zoneOffsetMinutes('Asia/Phnom_Penh')).toBe(420)
    expect(zoneOffsetMinutes('Asia/Kolkata')).toBe(330)
    expect(zoneOffsetMinutes('America/New_York', WINTER)).toBe(-300)
    expect(zoneOffsetMinutes('America/New_York', SUMMER)).toBe(-240)
  })

  it('refuses unknown zones instead of guessing', () => {
    expect(zoneOffsetMinutes('Mars/Olympus')).toBeUndefined()
    expect(zoneShift('Mars/Olympus', 'Asia/Phnom_Penh')).toBeUndefined()
  })

  it('computes the shift from the record zone to the viewer zone', () => {
    expect(zoneShift('UTC', 'Asia/Phnom_Penh')).toBe(420)
    expect(zoneShift('Asia/Phnom_Penh', 'UTC')).toBe(-420)
    expect(zoneShift('UTC', 'UTC')).toBe(0)
  })

  it('labels zones briefly', () => {
    expect(zoneLabel('Asia/Phnom_Penh')).toBe('GMT+7')
    expect(zoneLabel('UTC')).toBe('UTC')
  })
})

describe('shiftWeekly', () => {
  const at = (days: WeeklyTime['days'], startTime: string, endTime: string): WeeklyTime => ({ days, startTime, endTime })

  it('moves times without touching days when the start stays on the same day', () => {
    expect(shiftWeekly(at(['MONDAY', 'TUESDAY'], '01:00', '11:30'), 420)).toEqual(at(['MONDAY', 'TUESDAY'], '08:00', '18:30'))
  })

  it('keeps the days when only the end crosses midnight', () => {
    // 09:00–23:30 UTC is 16:00–06:30 at UTC+7, still starting on the same day.
    expect(shiftWeekly(at(['SATURDAY', 'SUNDAY'], '09:00', '23:30'), 420)).toEqual(at(['SATURDAY', 'SUNDAY'], '16:00', '06:30'))
  })

  it('moves the days forward when the start crosses midnight, wrapping Sunday to Monday', () => {
    expect(shiftWeekly(at(['MONDAY', 'SUNDAY'], '20:00', '22:00'), 420)).toEqual(at(['MONDAY', 'TUESDAY'], '03:00', '05:00'))
  })

  it('moves the days back when converting to an earlier zone, wrapping Monday to Sunday', () => {
    expect(shiftWeekly(at(['MONDAY', 'FRIDAY'], '03:00', '05:00'), -420)).toEqual(at(['THURSDAY', 'SUNDAY'], '20:00', '22:00'))
  })

  it('keeps seconds and leaves empty or invalid times for validation', () => {
    expect(shiftWeekly(at(['MONDAY'], '08:00:30', ''), 60)).toEqual(at(['MONDAY'], '09:00:30', ''))
    expect(shiftWeekly(at(['MONDAY'], '', 'x'), 60)).toEqual(at(['MONDAY'], '', 'x'))
  })

  it('round-trips exactly for any time and shift', () => {
    const days: WeeklyTime['days'] = ['MONDAY', 'WEDNESDAY', 'SUNDAY']
    for (const shift of [-600, -420, -30, 330, 420, 840]) {
      for (const [start, end] of [['00:00', '23:59'], ['06:15', '18:45'], ['17:00', '23:00'], ['23:30', '02:00']]) {
        const value = at(days, start!, end!)
        expect(shiftWeekly(shiftWeekly(value, shift), -shift)).toEqual(value)
      }
    }
  })
})
