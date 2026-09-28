import type { AvailabilityRule, AvailabilityWindow, CreateAvailabilityRuleInput, UpdateAvailabilityRuleInput } from '#shared/contracts/menu-availability'
import { AVAILABILITY_RULE_NAME_MAX, MAX_AVAILABILITY_WINDOWS, MINUTES_PER_DAY } from '#shared/contracts/menu-availability'
import * as v from 'valibot'

/**
 * The form edits **rows** (some days + one start and end); the API stores one **window** per day.
 * "Mon–Fri 7:00–11:00" is one row and five windows. Times are minutes after midnight in the
 * branch's local time; an end of 0 (12:00 AM) means midnight at the end of the day.
 */

export interface WindowRow {
  /** ISO weekdays, 1 = Monday. */
  days: number[]
  /** Minutes after midnight; `undefined` until entered. */
  start?: number
  end?: number
}

export interface AvailabilityRuleForm {
  name: string
  rows: WindowRow[]
}

/** The end as the API wants it: 12:00 AM is the end of the day. */
const apiEnd = (end: number) => (end === 0 ? MINUTES_PER_DAY : end)

/** A time the form holds as `undefined` until it's entered. */
const requiredMinute = (message: string) => v.pipe(
  v.optional(v.number()),
  v.check(minute => minute !== undefined, message),
  v.transform(minute => minute as number),
)

const rowSchema = v.pipe(
  v.object({
    days: v.pipe(v.array(v.number()), v.minLength(1, 'Pick at least one day')),
    start: requiredMinute('Start time is required'),
    end: requiredMinute('End time is required'),
  }),
  v.forward(v.check(row => row.end === undefined || row.start !== apiEnd(row.end), 'Must end at a different time than it starts'), ['end']),
)

export const availabilityRuleFormSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(AVAILABILITY_RULE_NAME_MAX, `Max ${AVAILABILITY_RULE_NAME_MAX} characters`)),
  rows: v.pipe(
    v.array(rowSchema),
    v.minLength(1, 'Add at least one time'),
    v.check(rows => rows.reduce((n, row) => n + row.days.length, 0) <= MAX_AVAILABILITY_WINDOWS, `At most ${MAX_AVAILABILITY_WINDOWS} day-and-time combinations`),
  ),
})

/**
 * The API's windows as rows: windows with the same start and end become one row, in the order
 * they first appear (the API lists them by weekday, then start).
 */
export function toRows(windows: AvailabilityWindow[]): WindowRow[] {
  const rows: WindowRow[] = []
  for (const window of windows) {
    const end = window.endMinute % MINUTES_PER_DAY
    const row = rows.find(r => r.start === window.startMinute && r.end === end)
    if (row) row.days.push(window.weekday)
    else rows.push({ days: [window.weekday], start: window.startMinute, end })
  }
  return rows.map(row => ({ ...row, days: [...row.days].sort((a, b) => a - b) }))
}

/**
 * Initial form state: the rule's values, or one empty weekday row for a new rule. A stored rule
 * without windows (older data) opens with one empty row, so it can be given times.
 */
export function toAvailabilityRuleForm(rule?: AvailabilityRule): AvailabilityRuleForm {
  const rows = rule ? toRows(rule.windows) : [{ days: [1, 2, 3, 4, 5], start: undefined, end: undefined }]
  return { name: rule?.name ?? '', rows: rows.length ? rows : [{ days: [], start: undefined, end: undefined }] }
}

/** One window per day of each row, rows in order and days in week order. */
export function toWindows(form: AvailabilityRuleForm): AvailabilityWindow[] {
  return form.rows.flatMap(row => [...row.days].sort((a, b) => a - b)
    .map(weekday => ({ weekday, startMinute: row.start!, endMinute: apiEnd(row.end!) })))
}

/** The row a window of `toWindows(form)` came from (to show a server error on it). */
export function rowOfWindow(form: AvailabilityRuleForm, windowIndex: number): number | undefined {
  let seen = 0
  for (const [i, row] of form.rows.entries()) {
    seen += row.days.length
    if (windowIndex < seen) return i
  }
  return undefined
}

export function toCreateAvailabilityRuleBody(form: AvailabilityRuleForm): CreateAvailabilityRuleInput {
  return { name: form.name.trim(), windows: toWindows(form) }
}

/** The rule's name and all its windows (they're replaced whole), from the version the form opened. */
export function toUpdateAvailabilityRuleBody(form: AvailabilityRuleForm, existing: AvailabilityRule): UpdateAvailabilityRuleInput {
  return { version: existing.version, ...toCreateAvailabilityRuleBody(form) }
}
