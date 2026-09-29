import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { BranchSettings } from '#shared/contracts/branches'
import { branchFormSchema, copyDay, formFieldOf, isClosedAllWeek, newWindow, toBranchForm, toHours, toUpdateBranchBody } from '../schemas/branch-form'

const settings = (hours: BranchSettings['hours']): BranchSettings => ({
  id: 'b-1',
  name: 'Main branch',
  timezone: 'Asia/Phnom_Penh',
  address: null,
  phone: '012',
  status: 'active',
  hours,
  openNow: false,
  today: 1,
  version: 4,
})
const w = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute })
const errorsOf = (form: unknown) => (v.safeParse(branchFormSchema, form).issues ?? []).map(issue => `${v.getDotPath(issue)}: ${issue.message}`)

describe('branch form', () => {
  it('opens each day with its windows; closed days keep default times', () => {
    const form = toBranchForm(settings([w(1, 480, 1140), w(1, 1200, 1320), w(5, 1080, 120), w(6, 0, 1440)]))
    expect(form).toMatchObject({ name: 'Main branch', timezone: 'Asia/Phnom_Penh', address: '', phone: '012' })
    expect(form.days[0]).toEqual({ open: true, windows: [{ start: 480, end: 1140 }, { start: 1200, end: 1320 }] })
    expect(form.days[1]).toEqual({ open: false, windows: [{ start: 480, end: 1140 }] })
    expect(form.days[4]).toEqual({ open: true, windows: [{ start: 1080, end: 120 }] })
    // Midnight at the end of the day shows as 12:00 AM (0).
    expect(form.days[5]).toEqual({ open: true, windows: [{ start: 0, end: 0 }] })
  })

  it('sends the complete draft: open days only, 12:00 AM as the end of the day, blanks as null', () => {
    const form = toBranchForm(settings([w(6, 0, 1440)]))
    form.days[0] = { open: true, windows: [{ start: 420, end: 1140 }] }
    form.address = '  '
    expect(toUpdateBranchBody(form, 4)).toEqual({
      version: 4,
      name: 'Main branch',
      timezone: 'Asia/Phnom_Penh',
      address: null,
      phone: '012',
      hours: [w(1, 420, 1140), w(6, 0, 1440)],
    })
  })

  it('checks open days only: times required, closing different from opening', () => {
    const form = toBranchForm(settings([]))
    expect(errorsOf(form)).toEqual([])
    form.days[0] = { open: true, windows: [{ start: 480, end: undefined }, { start: 600, end: 600 }] }
    form.days[1] = { open: false, windows: [{ start: undefined, end: undefined }] }
    expect(errorsOf(form)).toEqual(['days.0.windows.0.end: Closing time is required', 'days.0.windows.1.end: Must close at a different time than it opens'])
    expect(errorsOf({ ...form, name: ' ', days: form.days.map(() => ({ open: false, windows: [] })) })).toEqual(['name: Name is required'])
  })

  it('maps the server\'s hours.N to the window it names, counting open days only', () => {
    const form = toBranchForm(settings([w(1, 480, 600), w(1, 660, 900), w(3, 480, 900)]))
    expect(formFieldOf(form, 'hours.2')).toBe('days.2.windows.0.end')
    expect(formFieldOf(form, 'hours.1')).toBe('days.0.windows.1.end')
    expect(formFieldOf(form, 'timezone')).toBe('timezone')
  })

  it('copies a day onto others, as copies', () => {
    const form = toBranchForm(settings([w(1, 480, 1140)]))
    copyDay(form, 0, [1, 2, 3, 4])
    expect(toHours(form).map(x => x.weekday)).toEqual([1, 2, 3, 4, 5])
    form.days[1]!.windows[0]!.start = 500
    expect(form.days[0]!.windows[0]!.start).toBe(480)
    // Copying a closed day closes the others.
    copyDay(form, 6, [0])
    expect(form.days[0]!.open).toBe(false)
  })

  it('adds a window after the day\'s last one; knows a week with no open day', () => {
    expect(newWindow({ open: true, windows: [{ start: 480, end: 720 }] })).toEqual({ start: 720, end: 840 })
    expect(newWindow({ open: true, windows: [] })).toEqual({ start: 480, end: 1140 })
    expect(newWindow({ open: true, windows: [{ start: 1320, end: 1380 }] })).toEqual({ start: 1380, end: 1439 })
    expect(isClosedAllWeek(toBranchForm(settings([])))).toBe(true)
    expect(isClosedAllWeek(toBranchForm(settings([w(2, 0, 60)])))).toBe(false)
  })
})
