import type { WeeklyWindow } from '#shared/contracts/common'
import { MINUTES_PER_DAY } from '#shared/contracts/common'

/**
 * Pure weekly-window rules (no I/O), shared by the menu's availability rules (D63) and branch hours
 * (D91). A window is placed on the week as a stretch of minutes from Monday 00:00; one that ends
 * before it starts runs past midnight, and Sunday night runs into Monday morning.
 */

const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** A moment as the branch's wall clock shows it. */
export interface LocalTime {
  /** ISO: 1 = Monday … 7 = Sunday. */
  weekday: number
  /** Minutes after midnight, 0–1439. */
  minute: number
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Where the window starts on the week, and how many minutes it lasts. */
function stretch(window: WeeklyWindow) {
  const start = (window.weekday - 1) * MINUTES_PER_DAY + window.startMinute
  const length = window.endMinute > window.startMinute
    ? window.endMinute - window.startMinute
    : window.endMinute + MINUTES_PER_DAY - window.startMinute
  return { start, length }
}

function overlaps(a: WeeklyWindow, b: WeeklyWindow) {
  const x = stretch(a)
  const y = stretch(b)
  return mod(y.start - x.start, MINUTES_PER_WEEK) < x.length || mod(x.start - y.start, MINUTES_PER_WEEK) < y.length
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** "Monday 22:00–02:00". */
export const describeWindow = (window: WeeklyWindow) =>
  `${WEEKDAY_NAMES[window.weekday - 1]} ${clock(window.startMinute)}–${clock(window.endMinute % MINUTES_PER_DAY)}`

/**
 * Why a week of windows can't be saved, or `undefined`. Two windows may not overlap, overnight
 * ones included (Monday 22:00–02:00 and Tuesday 01:00–03:00 do): an overlap is always a typo, and
 * it would make "when" ambiguous on the admin screen. `field` names the window, under `path`.
 */
export function windowsProblem(windows: WeeklyWindow[], path = 'windows'): { field: string, message: string } | undefined {
  for (let j = 1; j < windows.length; j++) {
    for (let i = 0; i < j; i++) {
      if (overlaps(windows[i]!, windows[j]!)) {
        return { field: `${path}.${j}`, message: `Overlaps another window (${describeWindow(windows[i]!)}).` }
      }
    }
  }
  return undefined
}

/** Windows by weekday, then start time: how they're listed. */
export const sortWindows = <T extends WeeklyWindow>(windows: T[]) =>
  [...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)

/** Whether `at` falls in the window (start included, end excluded). */
export function isInWindow(window: WeeklyWindow, at: LocalTime): boolean {
  const { start, length } = stretch(window)
  return mod((at.weekday - 1) * MINUTES_PER_DAY + at.minute - start, MINUTES_PER_WEEK) < length
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The branch's wall clock at `instant`, in the IANA `timeZone` ("Asia/Phnom_Penh"). */
export function localTime(instant: Date, timeZone: string): LocalTime {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]))
  return { weekday: WEEKDAYS[parts.weekday!]!, minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) }
}

/** Whether the runtime knows the IANA zone ("Asia/Phnom_Penh"; not "Mars/Base"). */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  }
  catch {
    return false
  }
}
