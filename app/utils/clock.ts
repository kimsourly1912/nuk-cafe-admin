import { Time } from '@internationalized/date'

/**
 * Times of day as the admin shows and edits them: minutes after midnight in a branch's local time
 * (the API's weekly windows), "7:30 AM" on screen, `Time` objects in `UInputTime`. Used by
 * Availability rules and Branch hours (D91).
 */

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

/** Minutes after midnight as `UInputTime`'s value; `undefined` stays empty. */
export const minuteToTime = (minute?: number) => (minute === undefined ? undefined : new Time(Math.floor(minute / 60) % 24, minute % 60))

/** `UInputTime`'s value as minutes after midnight; `undefined` when cleared. */
export function timeToMinute(time: unknown): number | undefined {
  if (!time || typeof time !== 'object' || !('hour' in time) || !('minute' in time)) return undefined
  return Number(time.hour) * 60 + Number(time.minute)
}
