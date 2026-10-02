import * as v from 'valibot'
import type { BranchSettings, UpdateBranchSettingsInput } from '#shared/contracts/branches'
import { BRANCH_ADDRESS_MAX, BRANCH_NAME_MAX } from '#shared/contracts/branches'
import type { WeeklyWindow } from '#shared/contracts/common'
import { MINUTES_PER_DAY } from '#shared/contracts/common'
import type { PhoneCountry } from '#shared/contracts/phone'
import { DEFAULT_PHONE_COUNTRY, parsePhone, PHONE_COUNTRIES } from '#shared/contracts/phone'

/**
 * The Branch settings draft (D91, page-patterns §3: one draft, one Save). Hours are edited per day,
 * Monday first: open or closed, and up to three windows (minutes after midnight in the branch's
 * timezone; an end before the start runs past midnight, 12:00 AM is the end of the day). A closed
 * day keeps its times, so switching it back on restores them.
 */

export const MAX_DAY_WINDOWS = 3
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** A new or closed day's times: 8:00 AM – 7:00 PM. */
const DEFAULT_WINDOW = { start: 480, end: 1140 }

export interface DayWindow {
  /** Minutes after midnight; `undefined` until entered. */
  start?: number
  end?: number
}

export interface DayHours {
  open: boolean
  windows: DayWindow[]
}

export interface BranchForm {
  name: string
  timezone: string
  address: string
  /** As typed, for `phoneCountry` (D127); sent as E.164. */
  phone: string
  phoneCountry: PhoneCountry
  /** Monday (index 0) to Sunday. */
  days: DayHours[]
}

/** The end as the API wants it: 12:00 AM is the end of the day. */
const apiEnd = (end: number) => (end === 0 ? MINUTES_PER_DAY : end)

const requiredMinute = (message: string) => v.pipe(
  v.optional(v.number()),
  v.check(minute => minute !== undefined, message),
)

const windowSchema = v.pipe(
  v.object({ start: requiredMinute('Opening time is required'), end: requiredMinute('Closing time is required') }),
  v.forward(v.check(w => w.start === undefined || w.end === undefined || w.start !== apiEnd(w.end), 'Must close at a different time than it opens'), ['end']),
)

/** Closed days aren't checked: their times aren't sent. */
const daySchema = v.variant('open', [
  v.object({ open: v.literal(true), windows: v.pipe(v.array(windowSchema), v.minLength(1), v.maxLength(MAX_DAY_WINDOWS)) }),
  v.object({ open: v.literal(false), windows: v.array(v.any()) }),
])

/** What's wrong with the phone, if anything: blank is fine (no phone). */
function phoneProblem(form: { phone: string, phoneCountry: PhoneCountry }): string | undefined {
  if (!form.phone.trim()) return undefined
  const result = parsePhone(form.phone, form.phoneCountry)
  return result.ok ? undefined : result.message
}

export const branchFormSchema = v.pipe(v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(BRANCH_NAME_MAX, `Max ${BRANCH_NAME_MAX} characters`)),
  timezone: v.pipe(v.string(), v.minLength(1, 'Choose a time zone')),
  address: v.pipe(v.string(), v.maxLength(BRANCH_ADDRESS_MAX, `Max ${BRANCH_ADDRESS_MAX} characters`)),
  phone: v.string(),
  phoneCountry: v.picklist(PHONE_COUNTRIES.map(country => country.code)),
  days: v.pipe(v.array(daySchema), v.length(7)),
}), v.forward(
  v.partialCheck([['phone'], ['phoneCountry']], form => !phoneProblem(form), issue => phoneProblem(issue.input as { phone: string, phoneCountry: PhoneCountry }) ?? ''),
  ['phone'],
))

/** The draft for these settings: each day open with its windows, or closed with the default times. */
export function toBranchForm(settings: BranchSettings): BranchForm {
  const days = WEEKDAY_NAMES.map((_, i) => {
    const windows = settings.hours
      .filter(window => window.weekday === i + 1)
      .map(window => ({ start: window.startMinute, end: window.endMinute % MINUTES_PER_DAY }))
    return windows.length ? { open: true, windows } : { open: false, windows: [{ ...DEFAULT_WINDOW }] }
  })
  // A saved number shows without its country code; one saved as free text before D127 shows as it is.
  const saved = settings.phone ? parsePhone(settings.phone) : undefined
  const phone = saved?.ok ? { phone: saved.local, phoneCountry: saved.country } : { phone: settings.phone ?? '', phoneCountry: DEFAULT_PHONE_COUNTRY }
  return { name: settings.name, timezone: settings.timezone, address: settings.address ?? '', ...phone, days }
}

/** Where each window sent in `hours` sits in the form, in the same order. */
function sentWindows(form: BranchForm) {
  return form.days.flatMap((day, dayIndex) => (day.open
    ? day.windows.map((window, windowIndex) => ({ dayIndex, windowIndex, window }))
    : []))
}

/** The week as the API takes it: every open day's windows, Monday first. Call with a validated form. */
export function toHours(form: BranchForm): WeeklyWindow[] {
  return sentWindows(form).map(({ dayIndex, window }) => ({ weekday: dayIndex + 1, startMinute: window.start!, endMinute: apiEnd(window.end!) }))
}

/** The phone to send: E.164 when it reads; else as typed, for the server to refuse. */
function toE164(form: BranchForm): string | null {
  if (!form.phone.trim()) return null
  const result = parsePhone(form.phone, form.phoneCountry)
  return result.ok ? result.e164 : form.phone.trim()
}

/** The complete draft in one request, from the version it was based on (the settings blueprint). */
export function toUpdateBranchBody(form: BranchForm, version: number): UpdateBranchSettingsInput {
  return {
    version,
    name: form.name.trim(),
    timezone: form.timezone,
    address: form.address.trim() || null,
    phone: toE164(form),
    hours: toHours(form),
  }
}

/**
 * A server field as the form names it: `hours.3` (the fourth window sent) → the window's end field,
 * where an overlap is shown; other fields keep their names.
 */
export function formFieldOf(form: BranchForm, serverField: string): string {
  const match = /^hours\.(\d+)/.exec(serverField)
  if (!match) return serverField
  const place = sentWindows(form)[Number(match[1])]
  return place ? `days.${place.dayIndex}.windows.${place.windowIndex}.end` : 'days'
}

/** Copies one day's hours (open or closed, and its times) onto other days. */
export function copyDay(form: BranchForm, from: number, to: number[]) {
  const source = form.days[from]!
  for (const day of to) {
    form.days[day] = { open: source.open, windows: source.windows.map(window => ({ ...window })) }
  }
}

/** A new window for a day: after its last one, else the default times. */
export function newWindow(day: DayHours): DayWindow {
  const last = day.windows.at(-1)
  if (last?.end === undefined) return { ...DEFAULT_WINDOW }
  const start = last.end % MINUTES_PER_DAY
  return { start, end: Math.min(start + 120, MINUTES_PER_DAY - 1) }
}

/** Whether the draft keeps the branch closed every day (customers can't order then, D45). */
export const isClosedAllWeek = (form: BranchForm) => form.days.every(day => !day.open)
