import { describe, expect, it } from 'vitest'
import { formatDays, formatTimeRange, sortDays, timeBarSegments } from '../utils/days'

describe('timeBarSegments', () => {
  it('places a daytime range on the 24-hour bar', () => {
    expect(timeBarSegments('06:00', '12:00')).toEqual([{ left: 25, width: 25 }])
  })

  it('splits a range that runs past midnight', () => {
    expect(timeBarSegments('18:00', '06:00')).toEqual([{ left: 75, width: 25 }, { left: 0, width: 25 }])
    expect(timeBarSegments('18:00', '00:00')).toEqual([{ left: 75, width: 25 }])
  })

  it('draws nothing without both times', () => {
    expect(timeBarSegments('08:00', '')).toEqual([])
  })
})

describe('schedule days', () => {
  it('sorts days into week order and drops duplicates', () => {
    expect(sortDays(['SUNDAY', 'MONDAY', 'THURSDAY', 'MONDAY'])).toEqual(['MONDAY', 'THURSDAY', 'SUNDAY'])
  })

  it('names common sets, whatever order the API used', () => {
    expect(formatDays(['SUNDAY', 'SATURDAY', 'FRIDAY', 'THURSDAY', 'WEDNESDAY', 'TUESDAY', 'MONDAY'])).toBe('Every day')
    expect(formatDays(['FRIDAY', 'MONDAY', 'THURSDAY', 'TUESDAY', 'WEDNESDAY'])).toBe('Weekdays')
    expect(formatDays(['SUNDAY', 'SATURDAY'])).toBe('Weekends')
  })

  it('lists other sets as short labels', () => {
    expect(formatDays(['FRIDAY', 'MONDAY', 'WEDNESDAY'])).toBe('Mon, Wed, Fri')
    expect(formatDays(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'])).toBe('Mon, Tue, Wed, Thu, Fri, Sat')
    expect(formatDays([])).toBe('—')
  })

  it('shows time ranges in 12-hour form, marking ranges that end the next day', () => {
    expect(formatTimeRange('09:00', '23:30')).toBe('9:00 AM – 11:30 PM')
    expect(formatTimeRange('00:15', '12:00')).toBe('12:15 AM – 12:00 PM')
    expect(formatTimeRange('16:00', '06:30')).toBe('4:00 PM – 6:30 AM (next day)')
    expect(formatTimeRange()).toBe('—')
  })
})
