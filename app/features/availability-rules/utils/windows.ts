import type { WindowRow } from '../schemas/availability-rule-form'

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

/** "Every day", "Mon–Fri", "Sat, Sun" or "Mon, Wed–Fri". */
export function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  const runs: number[][] = []
  for (const day of sorted) {
    const run = runs.at(-1)
    if (run && run.at(-1) === day - 1) run.push(day)
    else runs.push([day])
  }
  return runs.map(run => (run.length >= 3 ? `${label(run[0]!)}–${label(run.at(-1)!)}` : run.map(label).join(', '))).join(', ')
}

/** `450` → `"7:30 AM"`; `0` and `1440` → `"12:00 AM"`. */
export function formatClock(minute: number): string {
  const inDay = minute % 1440
  const hour = Math.floor(inDay / 60)
  return `${hour % 12 || 12}:${String(inDay % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

/** "7:00 AM – 11:00 AM", "10:00 PM – 2:00 AM (next day)", "All day". */
export function formatTimes(start: number, end: number): string {
  if (start === 0 && end % 1440 === 0) return 'All day'
  const nextDay = end !== 0 && end < start ? ' (next day)' : ''
  return `${formatClock(start)} – ${formatClock(end)}${nextDay}`
}

/** A row as one line: "Mon–Fri · 7:00 AM – 11:00 AM". */
export const formatRow = (row: Required<WindowRow>) => `${formatWeekdays(row.days)} · ${formatTimes(row.start, row.end)}`
