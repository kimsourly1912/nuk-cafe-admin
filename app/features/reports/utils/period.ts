import { daysBetween, REPORT_MAX_DAYS } from '#shared/contracts/reports'

/**
 * A report's period: business dates `from` to `to` inclusive (`YYYY-MM-DD`, 04:00 to 04:00 in the
 * branch's zone, D110). "Today" is the branch's business date, which the server sends
 * (`GET /api/admin/reports/branches`), so no date here depends on the browser's time zone.
 */
export interface Period { from: string, to: string }

export type PresetId = 'today' | 'yesterday' | 'last7' | 'thisMonth'

export const PRESETS: { id: PresetId, label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'thisMonth', label: 'This month' },
]

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A business date moved by whole days: `addDays('2026-10-01', -1)` → `'2026-09-30'`. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

export function presetPeriod(id: PresetId, today: string): Period {
  switch (id) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) }
    case 'last7': return { from: addDays(today, -6), to: today }
    case 'thisMonth': return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

/** The preset a period matches, if any (the date button then shows its name). */
export function presetOf(period: Period, today: string): PresetId | undefined {
  return PRESETS.find(({ id }) => {
    const preset = presetPeriod(id, today)
    return preset.from === period.from && preset.to === period.to
  })?.id
}

/**
 * The period in the URL, if it's one a report can show: real dates, in order, at most
 * `REPORT_MAX_DAYS` days, not after today. Anything else falls back to today.
 */
export function validPeriod(from: unknown, to: unknown, today: string): Period {
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to)) return { from: today, to: today }
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return { from: today, to: today }
  if (from > to || to > today || daysBetween(from, to) >= REPORT_MAX_DAYS) return { from: today, to: today }
  return { from, to }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(date: string) {
  const at = new Date(`${date}T00:00:00Z`)
  return { weekday: WEEKDAYS[at.getUTCDay()]!, day: at.getUTCDate(), month: MONTHS[at.getUTCMonth()]!, year: at.getUTCFullYear() }
}

/** `'2026-09-30'` → "Tue 30 Sep 2026". */
export function dateLabel(date: string): string {
  const { weekday, day, month, year } = parts(date)
  return `${weekday} ${day} ${month} ${year}`
}

/** "Tue 30 Sep 2026", "24 – 30 Sep 2026", "28 Aug – 3 Sep 2026", "29 Dec 2025 – 4 Jan 2026". */
export function periodLabel(period: Period): string {
  if (period.from === period.to) return dateLabel(period.from)
  const a = parts(period.from)
  const b = parts(period.to)
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`
  return `${a.day} – ${b.day} ${b.month} ${b.year}`
}

/** The date button's text: the preset's name ("Today"), or the dates. */
export function periodButtonLabel(period: Period, today: string): string {
  const preset = presetOf(period, today)
  return preset ? PRESETS.find(p => p.id === preset)!.label : periodLabel(period)
}

/** "vs yesterday", "vs the 7 days before": what the Summary's change compares with. */
export function previousLabel(period: Period, today: string): string {
  const days = daysBetween(period.from, period.to) + 1
  if (days === 1) return period.from === today ? 'vs yesterday' : 'vs the day before'
  return `vs the ${days} days before`
}
