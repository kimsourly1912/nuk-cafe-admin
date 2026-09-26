import { Time } from '@internationalized/date'
import { describe, expect, it } from 'vitest'
import { formatTime, formatTime12, parseTime } from '../utils/time'

describe('schedule time conversion', () => {
  it('parses the API format', () => {
    expect(parseTime('08:30')).toEqual(new Time(8, 30))
    expect(parseTime('23:59:15')).toEqual(new Time(23, 59, 15))
  })

  it('treats empty or malformed values as no time', () => {
    expect(parseTime('')).toBeUndefined()
    expect(parseTime('8:30')).toBeUndefined()
    expect(parseTime('24:00')).toBeUndefined()
  })

  it('formats back to HH:mm, keeping seconds only when set', () => {
    expect(formatTime(new Time(8, 5))).toBe('08:05')
    expect(formatTime(new Time(23, 59, 15))).toBe('23:59:15')
    expect(formatTime(undefined)).toBe('')
  })

  it('round-trips every value the API returns', () => {
    for (const value of ['00:00', '09:00', '11:30', '23:59', '07:45:30']) expect(formatTime(parseTime(value))).toBe(value)
  })

  it('formats 12-hour times for display', () => {
    expect(formatTime12('00:00')).toBe('12:00 AM')
    expect(formatTime12('08:05')).toBe('8:05 AM')
    expect(formatTime12('12:30')).toBe('12:30 PM')
    expect(formatTime12('23:59')).toBe('11:59 PM')
  })
})
