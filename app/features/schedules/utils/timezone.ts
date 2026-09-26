import type { Day } from './days'
import { DAY_VALUES, sortDays } from './days'

/**
 * Schedules are stored in the zone the API reports on each record (`timezone`, "UTC" on every
 * record seen). Staff see and enter them in their **browser's** timezone (user decision,
 * 2026-09-26, docs/plans/schedules.md S2): times are converted both ways, and weekdays move with
 * a start time that crosses midnight.
 *
 * Offsets are taken at the current date. A zone with daylight saving time shifts by its current
 * offset all year round; the cafe's zone (Cambodia) has none.
 */

/** Zone assumed for new schedules (the request has no timezone field; every record says UTC). */
export const SERVER_TIME_ZONE = 'UTC'

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Minutes `timeZone` is ahead of UTC at `date`, or `undefined` for a zone the browser doesn't know. */
export function zoneOffsetMinutes(timeZone: string, date = new Date()): number | undefined {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value
    // "GMT", "GMT+07:00", "GMT-03:30"
    const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? '')
    if (!match) return undefined
    if (!match[1]) return 0
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  }
  catch {
    return undefined
  }
}

/** Short name for a zone, e.g. "GMT+7" or "UTC". */
export function zoneLabel(timeZone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value ?? timeZone
  }
  catch {
    return timeZone
  }
}

/**
 * Minutes to add to times stored in `recordZone` to show them in `viewerZone`.
 * `undefined` if either zone is unknown: then nothing may be converted.
 */
export function zoneShift(recordZone: string = SERVER_TIME_ZONE, viewerZone = viewerTimeZone(), date = new Date()) {
  const record = zoneOffsetMinutes(recordZone, date)
  const viewer = zoneOffsetMinutes(viewerZone, date)
  return record === undefined || viewer === undefined ? undefined : viewer - record
}

export interface WeeklyTime {
  days: Day[]
  startTime: string
  endTime: string
}

const DAY_MINUTES = 24 * 60
const TIME = /^(\d{2}):(\d{2})(:\d{2})?$/

function shiftTime(time: string, minutes: number): { time: string, dayShift: number } {
  const match = TIME.exec(time)
  if (!match) return { time, dayShift: 0 } // empty or unparsable: left for validation
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes
  const dayShift = Math.floor(total / DAY_MINUTES)
  const inDay = total - dayShift * DAY_MINUTES
  const pad = (n: number) => String(n).padStart(2, '0')
  return { time: `${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}${match[3] ?? ''}`, dayShift }
}

/**
 * Moves a weekly range by `minutes` (positive = later). The days move with the **start** time:
 * Monday 20:00 UTC is Tuesday 03:00 at UTC+7. Exactly reversible with `-minutes`.
 */
export function shiftWeekly(value: WeeklyTime, minutes: number): WeeklyTime {
  if (!minutes) return { days: sortDays(value.days), startTime: value.startTime, endTime: value.endTime }
  const start = shiftTime(value.startTime, minutes)
  const end = shiftTime(value.endTime, minutes)
  const days = value.days.map(day => DAY_VALUES[(((DAY_VALUES.indexOf(day) + start.dayShift) % 7) + 7) % 7]!)
  return { days: sortDays(days), startTime: start.time, endTime: end.time }
}
