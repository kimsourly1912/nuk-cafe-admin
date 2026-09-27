import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { availabilityRuleFormSchema, rowOfWindow, toAvailabilityRuleForm, toCreateAvailabilityRuleBody, toRows, toUpdateAvailabilityRuleBody, toWindows } from '../schemas/availability-rule-form'
import { formatRow, formatTimes, formatWeekdays } from '../utils/windows'

const rule = (windows: AvailabilityRule['windows']): AvailabilityRule => ({
  id: 'rule-1',
  name: 'Breakfast',
  status: 'active',
  windows,
  itemCount: 0,
  categoryCount: 0,
  version: 3,
  createdAt: '',
  updatedAt: '',
})
const w = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute })

describe('rows and windows', () => {
  it('groups windows with the same times into one row, days in week order', () => {
    expect(toRows([w(1, 420, 660), w(2, 420, 660), w(3, 420, 660), w(6, 480, 720), w(7, 480, 720)])).toEqual([
      { days: [1, 2, 3], start: 420, end: 660 },
      { days: [6, 7], start: 480, end: 720 },
    ])
  })

  it('expands each row to one window per day, and back', () => {
    const form = { name: 'Brunch', rows: [{ days: [7, 6], start: 600, end: 840 }, { days: [1], start: 420, end: 540 }] }
    expect(toWindows(form)).toEqual([w(6, 600, 840), w(7, 600, 840), w(1, 420, 540)])
  })

  it('sends a 12:00 AM end as midnight at the end of the day, and shows it back as 12:00 AM', () => {
    const form = { name: 'Late', rows: [{ days: [5], start: 1080, end: 0 }] }
    expect(toWindows(form)).toEqual([w(5, 1080, 1440)])
    expect(toRows([w(5, 1080, 1440)])).toEqual([{ days: [5], start: 1080, end: 0 }])
  })

  it('keeps an overnight window as entered: it ends the next day', () => {
    expect(toWindows({ name: 'Night', rows: [{ days: [5], start: 1320, end: 120 }] })).toEqual([w(5, 1320, 120)])
  })

  it('finds the row a window came from, for the server\'s overlap error', () => {
    const form = { name: 'x', rows: [{ days: [1, 2], start: 0, end: 60 }, { days: [3], start: 0, end: 60 }, { days: [4, 5], start: 0, end: 60 }] }
    expect([0, 1, 2, 3, 4].map(i => rowOfWindow(form, i))).toEqual([0, 0, 1, 2, 2])
    expect(rowOfWindow(form, 5)).toBeUndefined()
  })

  it('starts a new rule with one weekday row, and opens an existing one grouped', () => {
    expect(toAvailabilityRuleForm()).toEqual({ name: '', rows: [{ days: [1, 2, 3, 4, 5], start: undefined, end: undefined }] })
    expect(toAvailabilityRuleForm(rule([w(1, 420, 660), w(2, 420, 660)])).rows).toEqual([{ days: [1, 2], start: 420, end: 660 }])
  })

  it('builds the bodies: the name trimmed, every window, the version read', () => {
    const form = { name: ' Breakfast ', rows: [{ days: [1], start: 420, end: 660 }] }
    expect(toCreateAvailabilityRuleBody(form)).toEqual({ name: 'Breakfast', windows: [w(1, 420, 660)] })
    expect(toUpdateAvailabilityRuleBody(form, rule([]))).toEqual({ version: 3, name: 'Breakfast', windows: [w(1, 420, 660)] })
  })
})

describe('form rules', () => {
  const issues = (form: unknown) => v.safeParse(availabilityRuleFormSchema, form).issues?.map(i => [v.getDotPath(i), i.message]) ?? []

  it('needs a name, a day and both times per row', () => {
    expect(issues({ name: ' ', rows: [{ days: [], start: undefined, end: undefined }] })).toEqual([
      ['name', 'Name is required'],
      ['rows.0.days', 'Pick at least one day'],
      ['rows.0.start', 'Start time is required'],
      ['rows.0.end', 'End time is required'],
    ])
  })

  it('refuses a row that ends when it starts, but accepts all day (12:00 AM to 12:00 AM)', () => {
    expect(issues({ name: 'x', rows: [{ days: [1], start: 420, end: 420 }] })).toEqual([['rows.0.end', 'Must end at a different time than it starts']])
    expect(issues({ name: 'x', rows: [{ days: [1], start: 0, end: 0 }] })).toEqual([])
  })

  it('refuses more than 21 day-and-time combinations', () => {
    const all = { days: [1, 2, 3, 4, 5, 6, 7], start: 0, end: 60 }
    expect(issues({ name: 'x', rows: [all, { ...all, start: 120, end: 180 }, { ...all, start: 240, end: 300 }] })).toEqual([])
    expect(issues({ name: 'x', rows: [all, all, all, { days: [1], start: 400, end: 500 }] })).toEqual([['rows', 'At most 21 day-and-time combinations']])
  })
})

describe('wording', () => {
  it('names days as ranges, lists or every day', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(formatWeekdays([6, 7])).toBe('Sat, Sun')
    expect(formatWeekdays([1, 3, 4, 5])).toBe('Mon, Wed–Fri')
    expect(formatWeekdays([7, 1, 2, 3, 4, 5, 6])).toBe('Every day')
  })

  it('shows 12-hour times, overnight ones as the next day, and all day', () => {
    expect(formatTimes(420, 660)).toBe('7:00 AM – 11:00 AM')
    expect(formatTimes(1320, 120)).toBe('10:00 PM – 2:00 AM (next day)')
    expect(formatTimes(1080, 0)).toBe('6:00 PM – 12:00 AM')
    expect(formatTimes(0, 0)).toBe('All day')
    expect(formatRow({ days: [1, 2, 3, 4, 5], start: 750, end: 810 })).toBe('Mon–Fri · 12:30 PM – 1:30 PM')
  })
})
