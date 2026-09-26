import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Schedule } from '#shared/contracts/menu'
import { scheduleFormSchema, toCreateScheduleBody, toScheduleForm, toUpdateScheduleBody } from '../schemas/schedule-form'
import type { ScheduleForm } from '../schemas/schedule-form'

const existing: Schedule = {
  id: 's7',
  name: 'Lunch',
  description: 'Midday menu',
  status: 'INACTIVE',
  startTime: '11:00',
  endTime: '14:30',
  timeZone: 'Asia/Phnom_Penh',
  days: ['FRIDAY', 'MONDAY', 'WEDNESDAY'],
  productCount: 2,
  version: 3,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
}

const valid: ScheduleForm = {
  name: 'Lunch',
  description: '',
  days: ['MONDAY'],
  startTime: '11:00',
  endTime: '14:30',
  status: 'ACTIVE',
}

function errorsOf(input: unknown) {
  const result = v.safeParse(scheduleFormSchema, input)
  return result.success ? [] : result.issues.map(i => i.message)
}

describe('schedule form', () => {
  it('defaults a new schedule to active with no days or times', () => {
    expect(toScheduleForm()).toEqual({ name: '', description: '', days: [], startTime: '', endTime: '', status: 'ACTIVE' })
  })

  it('fills the form from an existing schedule as stored (cafe time), days in week order', () => {
    expect(toScheduleForm(existing)).toEqual({
      name: 'Lunch',
      description: 'Midday menu',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
      startTime: '11:00',
      endTime: '14:30',
      status: 'INACTIVE',
    })
  })

  it('creates with the edited fields, days in week order', () => {
    expect(toCreateScheduleBody({ ...valid, days: ['SUNDAY', 'MONDAY'] })).toEqual({ ...valid, days: ['MONDAY', 'SUNDAY'] })
  })

  it('updates from the version it was opened with, and never sends menu items', () => {
    const body = toUpdateScheduleBody({ ...valid, name: 'Brunch' }, existing)
    expect(body).toEqual({ ...valid, name: 'Brunch', version: 3 })
    expect(body).not.toHaveProperty('items')
  })

  it('accepts a valid form', () => {
    expect(errorsOf(valid)).toEqual([])
  })

  it('requires a name, at least one day and both times', () => {
    expect(errorsOf({ ...valid, name: '  ', days: [], startTime: '', endTime: '' })).toEqual([
      'Name is required',
      'Pick at least one day',
      'Start time is required',
      'End time is required',
    ])
  })

  it('checks the time format', () => {
    expect(errorsOf({ ...valid, startTime: '8:30' })).toEqual(['Use HH:mm, e.g. 08:30'])
    expect(errorsOf({ ...valid, startTime: '24:00' })).toEqual(['Use HH:mm, e.g. 08:30'])
  })

  it('requires the end after the start (no overnight ranges yet, D41)', () => {
    expect(errorsOf({ ...valid, startTime: '22:00', endTime: '02:00' })).toEqual(['End time must be after the start time'])
    expect(errorsOf({ ...valid, startTime: '09:00', endTime: '09:00' })).toEqual(['End time must be after the start time'])
  })

  it('limits the description length', () => {
    expect(errorsOf({ ...valid, description: 'x'.repeat(501) })).toEqual(['Max 500 characters'])
  })
})
