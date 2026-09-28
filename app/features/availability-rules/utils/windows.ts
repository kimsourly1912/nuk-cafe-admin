import type { AvailabilityRule, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { WindowRow } from '../schemas/availability-rule-form'
import { toRows } from '../schemas/availability-rule-form'

/** How a rule's windows read in the list: "Mon–Fri · 7:00 AM – 11:00 AM". */

export const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

const label = (day: number) => WEEKDAYS[day - 1]?.label ?? '?'

/** "Every day", "Mon–Fri", "Sat–Sun", "Mon, Wed–Fri" or "Mon, Wed": consecutive days as a range. */
export function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  const runs: number[][] = []
  for (const day of sorted) {
    const run = runs.at(-1)
    if (run && run.at(-1) === day - 1) run.push(day)
    else runs.push([day])
  }
  return runs.map(run => (run.length >= 2 ? `${label(run[0]!)}–${label(run.at(-1)!)}` : run.map(label).join(', '))).join(', ')
}

/** `450` → `"7:30 AM"`; `0` and `1440` → `"12:00 AM"`. */
export function formatClock(minute: number): string {
  const inDay = minute % 1440
  const hour = Math.floor(inDay / 60)
  return `${hour % 12 || 12}:${String(inDay % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

/** An end before the start runs into the next day; an end of 12:00 AM (0 or 1440) is midnight. */
export const isOvernight = (start: number, end: number) => end % 1440 !== 0 && end < start

/** "7:00 AM – 11:00 AM", "10:00 PM – 2:00 AM", "All day" (without the "next day" note). */
export function timeRange(start: number, end: number): string {
  if (start === 0 && end % 1440 === 0) return 'All day'
  return `${formatClock(start)} – ${formatClock(end)}`
}

/** "7:00 AM – 11:00 AM", "10:00 PM – 2:00 AM (next day)", "All day". */
export function formatTimes(start: number, end: number): string {
  return `${timeRange(start, end)}${isOvernight(start, end) ? ' (next day)' : ''}`
}

/** A row as one line: "Mon–Fri · 7:00 AM – 11:00 AM". */
export const formatRow = (row: Required<WindowRow>) => `${formatWeekdays(row.days)} · ${formatTimes(row.start, row.end)}`

/**
 * PUBLIC. A rule's times in words, one row per group of days: "Mon–Fri · 7:00 AM – 11:00 AM;
 * Sat, Sun · 8:00 AM – 12:00 PM". For other features that name a rule (the Categories list).
 */
export function describeWindows(windows: AvailabilityWindow[]): string {
  return toRows(windows).map(row => formatRow({ days: row.days, start: row.start ?? 0, end: row.end ?? 0 })).join('; ')
}

/** One line of a rule's weekly agenda: its days, its times, and whether it ends the next day. */
export interface ScheduleLine {
  days: string
  times: string
  nextDay: boolean
}

/** A rule's windows as agenda lines, one per group of days with the same times (D76). */
export function scheduleLines(windows: AvailabilityWindow[]): ScheduleLine[] {
  return toRows(windows).map(row => ({
    days: formatWeekdays(row.days),
    times: timeRange(row.start ?? 0, row.end ?? 0),
    nextDay: isOvernight(row.start ?? 0, row.end ?? 0),
  }))
}

/** The ISO weekdays a rule's windows start on. */
export const activeWeekdays = (windows: AvailabilityWindow[]) => new Set(windows.map(w => w.weekday))

/** "18 items · 2 categories", "1 item", "Not used yet". */
export function usageSummary(rule: Pick<AvailabilityRule, 'itemCount' | 'categoryCount'>): string {
  const parts = [
    ...(rule.itemCount ? [`${rule.itemCount} ${rule.itemCount === 1 ? 'item' : 'items'}`] : []),
    ...(rule.categoryCount ? [`${rule.categoryCount} ${rule.categoryCount === 1 ? 'category' : 'categories'}`] : []),
  ]
  return parts.length ? parts.join(' · ') : 'Not used yet'
}
