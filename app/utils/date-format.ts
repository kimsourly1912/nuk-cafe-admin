/**
 * Dates and times on screen, in one style (owner, 2026-10-21): the day first, as dates are written
 * in Cambodia and as the reports, promotions and Telegram messages already show them ("21 Oct
 * 2026"), and the 12-hour clock of the rest of the app ("9:05 AM", like `formatClock`).
 *
 * `at` is an ISO timestamp, epoch milliseconds or a `Date`. With `timeZone` (a branch's or the
 * cafe's zone) it shows that zone's day and time; without one, this device's. A calendar day with no
 * time (`YYYY-MM-DD`) is `formatDay`'s.
 *
 * The `Intl.DateTimeFormat` for each style is built once and reused: long tables format hundreds.
 */
export type DateInput = string | number | Date

export interface DateFormatOptions {
  /** An IANA zone (`Asia/Phnom_Penh`); this device's zone when left out. */
  timeZone?: string
}

export interface ShortDateOptions extends DateFormatOptions {
  /** With the weekday first: "Tue 30 Sep". */
  weekday?: boolean
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterOf(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale} ${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, formatter)
  }
  return formatter
}

const toDate = (at: DateInput) => (at instanceof Date ? at : new Date(at))

/**
 * The day's parts from `en-US`, whose short months are stable ("Sep"): `en-GB` gives "Sept" and a
 * comma after the weekday in current browsers, unlike the reports' and Telegram's "Wed 30 Sep 2026".
 */
function dayParts(at: DateInput, timeZone: string | undefined) {
  const parts = formatterOf('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone }).formatToParts(toDate(at))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return { weekday: part('weekday'), day: part('day'), month: part('month'), year: part('year') }
}

/** "21 Oct 2026". */
export function formatDate(at: DateInput, options: DateFormatOptions = {}): string {
  const { day, month, year } = dayParts(at, options.timeZone)
  return `${day} ${month} ${year}`
}

/** "21 Oct" ("Wed 21 Oct" with `weekday`): a day of this year, where the year goes without saying. */
export function formatShortDate(at: DateInput, options: ShortDateOptions = {}): string {
  const { weekday, day, month } = dayParts(at, options.timeZone)
  return options.weekday ? `${weekday} ${day} ${month}` : `${day} ${month}`
}

/** "9:05 AM". */
export function formatTime(at: DateInput, options: DateFormatOptions = {}): string {
  return formatterOf('en-US', { hour: 'numeric', minute: '2-digit', timeZone: options.timeZone }).format(toDate(at))
}

/** "21 Oct 2026, 9:05 AM". */
export function formatDateTime(at: DateInput, options: DateFormatOptions = {}): string {
  return `${formatDate(at, options)}, ${formatTime(at, options)}`
}

/** "21 Oct, 9:05 AM" ("Wed 21 Oct, 9:05 AM" with `weekday`): recent activity, where the year goes without saying. */
export function formatShortDateTime(at: DateInput, options: ShortDateOptions = {}): string {
  return `${formatShortDate(at, options)}, ${formatTime(at, options)}`
}

/** `2026-10-21` → "Wed 21 Oct 2026": a calendar day, the same in every time zone. */
export function formatDay(day: string): string {
  const { weekday, day: date, month, year } = dayParts(`${day}T00:00:00Z`, 'UTC')
  return `${weekday} ${date} ${month} ${year}`
}
