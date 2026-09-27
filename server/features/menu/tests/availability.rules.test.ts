import { describe, expect, it } from 'vitest'
import type { AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { RuleForCheck } from '../availability.rules'
import { isAvailableAt, isInWindow, localTime, sortWindows, windowsProblem } from '../availability.rules'

const MON = 1
const TUE = 2
const SUN = 7
const at = (weekday: number, hhmm: string) => ({ weekday, minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) })
const w = (weekday: number, start: string, end: string): AvailabilityWindow => ({ weekday, startMinute: at(weekday, start).minute, endMinute: end === '24:00' ? 1440 : at(weekday, end).minute })
const rule = (...windows: AvailabilityWindow[]): RuleForCheck => ({ status: 'active', windows })

describe('a window', () => {
  it('includes its start and excludes its end, on its own day only', () => {
    const breakfast = w(MON, '07:00', '11:00')
    expect(isInWindow(breakfast, at(MON, '07:00'))).toBe(true)
    expect(isInWindow(breakfast, at(MON, '10:59'))).toBe(true)
    expect(isInWindow(breakfast, at(MON, '11:00'))).toBe(false)
    expect(isInWindow(breakfast, at(MON, '06:59'))).toBe(false)
    expect(isInWindow(breakfast, at(TUE, '08:00'))).toBe(false)
  })

  it('runs past midnight when it ends before it starts, belonging to the day it starts on', () => {
    const late = w(MON, '22:00', '02:00')
    expect(isInWindow(late, at(MON, '22:00'))).toBe(true)
    expect(isInWindow(late, at(MON, '23:59'))).toBe(true)
    expect(isInWindow(late, at(TUE, '00:00'))).toBe(true)
    expect(isInWindow(late, at(TUE, '01:59'))).toBe(true)
    expect(isInWindow(late, at(TUE, '02:00'))).toBe(false)
    expect(isInWindow(late, at(MON, '01:00'))).toBe(false)
    expect(isInWindow(late, at(TUE, '22:00'))).toBe(false)
  })

  it('runs from Sunday night into Monday morning', () => {
    const late = w(SUN, '23:00', '01:00')
    expect(isInWindow(late, at(SUN, '23:30'))).toBe(true)
    expect(isInWindow(late, at(MON, '00:30'))).toBe(true)
    expect(isInWindow(late, at(MON, '01:00'))).toBe(false)
    expect(isInWindow(late, at(SUN, '00:30'))).toBe(false)
  })

  it('can cover a whole day, ending at midnight', () => {
    const allDay = w(MON, '00:00', '24:00')
    expect(isInWindow(allDay, at(MON, '00:00'))).toBe(true)
    expect(isInWindow(allDay, at(MON, '23:59'))).toBe(true)
    expect(isInWindow(allDay, at(TUE, '00:00'))).toBe(false)
    expect(isInWindow(allDay, at(SUN, '23:59'))).toBe(false)
  })
})

describe('windows of one rule', () => {
  it('accept windows that touch, and the same hours on different days', () => {
    expect(windowsProblem([w(MON, '07:00', '11:00'), w(MON, '11:00', '14:00'), w(TUE, '07:00', '11:00')])).toBeUndefined()
    expect(windowsProblem([w(MON, '22:00', '02:00'), w(TUE, '02:00', '06:00')])).toBeUndefined()
  })

  it('refuse overlaps, naming the later window and the one it overlaps', () => {
    expect(windowsProblem([w(MON, '07:00', '11:00'), w(TUE, '07:00', '09:00'), w(MON, '10:00', '12:00')]))
      .toEqual({ field: 'windows.2', message: 'Overlaps another window (Monday 07:00–11:00).' })
    expect(windowsProblem([w(MON, '07:00', '11:00'), w(MON, '07:00', '11:00')])?.field).toBe('windows.1')
    // One inside the other.
    expect(windowsProblem([w(MON, '07:00', '18:00'), w(MON, '09:00', '10:00')])?.field).toBe('windows.1')
  })

  it('refuse an overnight window that overlaps the next morning, also from Sunday into Monday', () => {
    expect(windowsProblem([w(TUE, '01:00', '03:00'), w(MON, '22:00', '02:00')]))
      .toEqual({ field: 'windows.1', message: 'Overlaps another window (Tuesday 01:00–03:00).' })
    expect(windowsProblem([w(MON, '00:00', '01:00'), w(SUN, '23:00', '00:30')])?.field).toBe('windows.1')
    expect(windowsProblem([w(SUN, '23:00', '24:00'), w(MON, '00:00', '01:00')])).toBeUndefined()
  })

  it('are listed by weekday, then start', () => {
    expect(sortWindows([w(TUE, '07:00', '09:00'), w(MON, '12:00', '14:00'), w(MON, '07:00', '09:00')]))
      .toEqual([w(MON, '07:00', '09:00'), w(MON, '12:00', '14:00'), w(TUE, '07:00', '09:00')])
  })
})

describe('availability of an item', () => {
  const breakfast = rule(w(MON, '07:00', '11:00'))
  const lunch = rule(w(MON, '11:00', '14:00'))
  const mornings = rule(w(MON, '06:00', '12:00'))

  it('is unlimited without rules at any level', () => {
    expect(isAvailableAt([[], [], []], at(MON, '03:00'))).toBe(true)
  })

  it('needs any one of its own rules to match', () => {
    expect(isAvailableAt([[breakfast, lunch]], at(MON, '08:00'))).toBe(true)
    expect(isAvailableAt([[breakfast, lunch]], at(MON, '13:00'))).toBe(true)
    expect(isAvailableAt([[breakfast, lunch]], at(MON, '15:00'))).toBe(false)
  })

  it('needs its category and the parent category to allow it too', () => {
    expect(isAvailableAt([[lunch], [mornings]], at(MON, '11:30'))).toBe(true)
    expect(isAvailableAt([[lunch], [mornings]], at(MON, '13:00'))).toBe(false)
    expect(isAvailableAt([[], [], [mornings]], at(MON, '13:00'))).toBe(false)
    expect(isAvailableAt([[], [], [mornings]], at(MON, '07:00'))).toBe(true)
  })

  it('never matches on an archived rule, even when that is the only one', () => {
    const archived: RuleForCheck = { ...breakfast, status: 'archived' }
    expect(isAvailableAt([[archived]], at(MON, '08:00'))).toBe(false)
    expect(isAvailableAt([[archived, lunch]], at(MON, '12:00'))).toBe(true)
  })
})

describe('the branch\'s wall clock', () => {
  it('converts an instant to the weekday and minute in the branch\'s zone', () => {
    // Sunday 17:30 UTC is already Monday 00:30 in Phnom Penh (UTC+7).
    expect(localTime(new Date('2026-09-27T17:30:00Z'), 'Asia/Phnom_Penh')).toEqual({ weekday: MON, minute: 30 })
  })

  it('follows daylight saving time', () => {
    // New York skips from 02:00 to 03:00 on 8 March 2026 (a Sunday).
    expect(localTime(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toEqual({ weekday: SUN, minute: 119 })
    expect(localTime(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toEqual({ weekday: SUN, minute: 180 })
  })
})
