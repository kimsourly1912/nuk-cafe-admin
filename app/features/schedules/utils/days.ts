import type { ScheduleResponse } from '~/generated/api'
import { formatTime12 } from './time'

export type Day = NonNullable<ScheduleResponse['days']>[number]

/**
 * Days in week order, labelled like `GET /staff/schedules/days-of-week` returns them. A local
 * constant instead of that request: the enum is fixed by the spec (docs/plans/schedules.md).
 */
export const DAYS: { value: Day, label: string }[] = [
  { value: 'MONDAY', label: 'Mon' },
  { value: 'TUESDAY', label: 'Tue' },
  { value: 'WEDNESDAY', label: 'Wed' },
  { value: 'THURSDAY', label: 'Thu' },
  { value: 'FRIDAY', label: 'Fri' },
  { value: 'SATURDAY', label: 'Sat' },
  { value: 'SUNDAY', label: 'Sun' },
]

export const DAY_VALUES = DAYS.map(d => d.value)
export const WEEKDAYS: Day[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
export const WEEKEND: Day[] = ['SATURDAY', 'SUNDAY']

/** Week order, duplicates removed. The API returns days in random order (a Java `Set`). */
export function sortDays(days: readonly Day[] = []): Day[] {
  return DAY_VALUES.filter(d => days.includes(d))
}

function sameDays(a: readonly Day[], b: readonly Day[]) {
  return a.length === b.length && a.every(d => b.includes(d))
}

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function formatDays(days: readonly Day[] = []): string {
  const sorted = sortDays(days)
  if (sorted.length === 0) return '—'
  if (sorted.length === DAYS.length) return 'Every day'
  if (sameDays(sorted, WEEKDAYS)) return 'Weekdays'
  if (sameDays(sorted, WEEKEND)) return 'Weekends'
  return sorted.map(d => DAYS.find(x => x.value === d)!.label).join(', ')
}

/**
 * "9:00 AM – 5:30 PM" (12-hour), "(next day)" when the range ends after midnight. Pass times
 * already converted to the viewer's zone (utils/timezone.ts).
 */
export function formatTimeRange(start?: string, end?: string): string {
  if (!start && !end) return '—'
  const nextDay = start && end && end <= start ? ' (next day)' : ''
  return `${start ? formatTime12(start) : '?'} – ${end ? formatTime12(end) : '?'}${nextDay}`
}
