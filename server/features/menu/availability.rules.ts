import type { AvailabilityStatus, AvailabilityWindow } from '#shared/contracts/menu-availability'
import { MINUTES_PER_DAY } from '#shared/contracts/menu-availability'

/**
 * Pure availability rules (no I/O; docs/server/data-model.md → Menu, D45, D63). A window is placed
 * on the week as a stretch of minutes from Monday 00:00; one that ends before it starts runs past
 * midnight, and Sunday night runs into Monday morning.
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

/** A rule as the availability check needs it. */
export interface RuleForCheck {
  status: AvailabilityStatus
  windows: AvailabilityWindow[]
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Where the window starts on the week, and how many minutes it lasts. */
function stretch(window: AvailabilityWindow) {
  const start = (window.weekday - 1) * MINUTES_PER_DAY + window.startMinute
  const length = window.endMinute > window.startMinute
    ? window.endMinute - window.startMinute
    : window.endMinute + MINUTES_PER_DAY - window.startMinute
  return { start, length }
}

function overlaps(a: AvailabilityWindow, b: AvailabilityWindow) {
  const x = stretch(a)
  const y = stretch(b)
  return mod(y.start - x.start, MINUTES_PER_WEEK) < x.length || mod(x.start - y.start, MINUTES_PER_WEEK) < y.length
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** "Monday 22:00–02:00". */
export const describeWindow = (window: AvailabilityWindow) =>
  `${WEEKDAY_NAMES[window.weekday - 1]} ${clock(window.startMinute)}–${clock(window.endMinute % MINUTES_PER_DAY)}`

/**
 * Why a rule's windows can't be saved, or `undefined`. Two windows may not overlap, overnight ones
 * included (Monday 22:00–02:00 and Tuesday 01:00–03:00 do): an overlap is always a typo, and it
 * would make "when is this sold" ambiguous on the admin screen.
 */
export function windowsProblem(windows: AvailabilityWindow[]): { field: string, message: string } | undefined {
  for (let j = 1; j < windows.length; j++) {
    for (let i = 0; i < j; i++) {
      if (overlaps(windows[i]!, windows[j]!)) {
        return { field: `windows.${j}`, message: `Overlaps another window (${describeWindow(windows[i]!)}).` }
      }
    }
  }
  return undefined
}

/** Windows by weekday, then start time: how they're listed. */
export const sortWindows = (windows: AvailabilityWindow[]) =>
  [...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)

/** Whether `at` falls in the window (start included, end excluded). */
export function isInWindow(window: AvailabilityWindow, at: LocalTime): boolean {
  const { start, length } = stretch(window)
  return mod((at.weekday - 1) * MINUTES_PER_DAY + at.minute - start, MINUTES_PER_WEEK) < length
}

/** Whether an active rule matches `at`. An archived rule never matches. */
export const ruleMatches = (rule: RuleForCheck, at: LocalTime) =>
  rule.status === 'active' && rule.windows.some(window => isInWindow(window, at))

/**
 * Whether something is available at `at`, given the rules of each level it depends on: the item,
 * its category, and that category's parent. A level without rules doesn't limit; a level with
 * rules needs one of them to match (D45). An item is available only when every level is.
 *
 * Only the menu's own rules: the branch being open and sold-out switches are checked separately.
 */
export function isAvailableAt(levels: RuleForCheck[][], at: LocalTime): boolean {
  return levels.every(rules => rules.length === 0 || rules.some(rule => ruleMatches(rule, at)))
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
