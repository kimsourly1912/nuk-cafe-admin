import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { scheduleFormSchema, toScheduleForm, toScheduleRequest } from '../schemas/schedule-form'
import type { ScheduleForm } from '../schemas/schedule-form'

const existing = {
  id: 7,
  name: 'Lunch',
  description: 'Midday menu',
  status: 'INACTIVE' as const,
  startTime: '11:00',
  endTime: '14:30',
  timezone: 'UTC',
  // The API returns days in random order.
  days: ['FRIDAY', 'MONDAY', 'WEDNESDAY'] as ScheduleForm['days'],
  items: [
    { id: 1, productId: 40, productName: 'Latte', price: 3 },
    { id: 2, productId: 41, productName: 'Mocha', price: 3.5 },
  ],
  nameI18n: { 'zh-HK': '午餐' },
  descriptionI18n: { km: 'ម៉ឺនុយ' },
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

  it('fills the form from an existing schedule, days in week order', () => {
    expect(toScheduleForm(existing)).toEqual({
      name: 'Lunch',
      description: 'Midday menu',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
      startTime: '11:00',
      endTime: '14:30',
      status: 'INACTIVE',
    })
  })

  it('re-sends the linked product ids and copies the translations on update', () => {
    const body = toScheduleRequest({ ...valid, name: 'Brunch', days: ['SUNDAY', 'MONDAY'] }, existing)
    expect(body).toEqual({
      name: 'Brunch',
      description: '',
      status: 'ACTIVE',
      startTime: '11:00',
      endTime: '14:30',
      days: ['MONDAY', 'SUNDAY'],
      items: [40, 41],
      nameI18n: { 'zh-HK': '午餐' },
      descriptionI18n: { km: 'ម៉ឺនុយ' },
    })
  })

  it('shows days and times in the viewer zone and sends them back in the record zone', () => {
    // UTC record, viewer at UTC+7: Fri 20:00 UTC is Sat 03:00 local.
    const utc = { ...existing, days: ['MONDAY', 'FRIDAY'] as ScheduleForm['days'], startTime: '20:00', endTime: '23:00' }
    const form = toScheduleForm(utc, 420)
    expect(form).toMatchObject({ days: ['TUESDAY', 'SATURDAY'], startTime: '03:00', endTime: '06:00' })
    expect(toScheduleRequest(form, utc, 420)).toMatchObject({ days: ['MONDAY', 'FRIDAY'], startTime: '20:00', endTime: '23:00' })
  })

  it('sends no items for a new schedule', () => {
    expect(toScheduleRequest(valid).items).toEqual([])
  })

  it('skips items without a product id instead of sending undefined', () => {
    expect(toScheduleRequest(valid, { items: [{ id: 1 }, { id: 2, productId: 9 }] }).items).toEqual([9])
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
    expect(errorsOf({ ...valid, startTime: '08:30:00' })).toEqual([])
  })

  it('leaves overnight ranges to the backend', () => {
    expect(errorsOf({ ...valid, startTime: '22:00', endTime: '02:00' })).toEqual([])
  })

  it('limits the description length', () => {
    expect(errorsOf({ ...valid, description: 'x'.repeat(501) })).toEqual(['Max 500 characters'])
  })
})
