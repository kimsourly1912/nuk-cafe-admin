import type { Day } from '#shared/contracts/menu'
import { formatTime12 } from './time'

export type { Day }

/** Days in week order, with short labels. */
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

/** Week order, duplicates removed. */
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

/** Minutes since midnight of `HH:mm[:ss]`, or `undefined`. */
function minutesOf(time?: string) {
  const match = /^(\d{2}):(\d{2})/.exec(time ?? '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

/**
 * Where a range sits on a 24-hour bar, in percent. A range ending at or before its start runs
 * past midnight, so it's two segments: start → midnight and midnight → end.
 */
export function timeBarSegments(start?: string, end?: string): { left: number, width: number }[] {
  const from = minutesOf(start)
  const to = minutesOf(end)
  if (from === undefined || to === undefined) return []
  const pct = (minutes: number) => (minutes / (24 * 60)) * 100
  if (to > from) return [{ left: pct(from), width: pct(to - from) }]
  return [
    { left: pct(from), width: 100 - pct(from) },
    ...(to > 0 ? [{ left: 0, width: pct(to) }] : []),
  ]
}

/**
 * "9:00 AM – 5:30 PM" (12-hour), "(next day)" when the range ends after midnight. Times are the
 * schedule's local wall time (utils/timezone.ts).
 */
export function formatTimeRange(start?: string, end?: string): string {
  if (!start && !end) return '—'
  const nextDay = start && end && end <= start ? ' (next day)' : ''
  return `${start ? formatTime12(start) : '?'} – ${end ? formatTime12(end) : '?'}${nextDay}`
}
