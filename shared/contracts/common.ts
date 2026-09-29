import * as v from 'valibot'

/**
 * Shared API conventions (docs/server/architecture.md → Conventions):
 * - JSON in and out; ids are opaque strings; timestamps are ISO 8601 UTC strings.
 * - Failures use an HTTP status and the error body below; never HTTP 200 with a failure flag.
 * - Lists that can grow are paginated with `page` (1-based) and `pageSize`.
 */

export const STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type Status = typeof STATUSES[number]

/**
 * The error body of every failed API request (the `data` of h3's JSON error response;
 * docs/server/architecture.md → Errors). `code` is machine-readable (shared codes in
 * server/utils/errors.ts, feature codes in each feature's `*.errors.ts`); `message` is safe to
 * show to users; `fieldErrors` maps a request field path (`name`, `variations.0.priceMinor`) to
 * its messages; `requestId` finds the log line.
 */
export interface ApiErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string[]>
  requestId?: string
}

export interface Page<T> {
  items: T[]
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export const MAX_PAGE_SIZE = 100

export const idSchema = v.pipe(v.string(), v.uuid('Must be a valid id'))
export const statusSchema = v.picklist(STATUSES, 'Must be ACTIVE or INACTIVE')
export const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(1))

export const nameSchema = (max = 100) =>
  v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(max, `Max ${max} characters`))
export const textSchema = (max = 500) => v.pipe(v.string(), v.trim(), v.maxLength(max, `Max ${max} characters`))

/** A query-string integer (query values arrive as strings). */
export const intParam = (min: number, max: number) => v.pipe(
  v.string(),
  v.regex(/^\d+$/, 'Must be a whole number'),
  v.transform(Number),
  v.minValue(min),
  v.maxValue(max),
)

/** An optional query-string filter: '' counts as absent. */
export const optionalParam = <T extends v.GenericSchema<string, unknown>>(schema: T) =>
  v.optional(v.pipe(v.string(), v.transform(value => value || undefined), v.optional(schema)))

export const pageQuerySchema = {
  page: v.optional(intParam(1, 100_000), '1'),
  pageSize: v.optional(intParam(1, MAX_PAGE_SIZE), '20'),
}

export function totalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}

// --- Weekly windows: availability rules and branch hours ---

export const MINUTES_PER_DAY = 1440
/** Windows in one week: three a day, every day. */
export const MAX_WEEKLY_WINDOWS = 21

/**
 * One weekly window in a branch's local time. `weekday` is ISO 8601: 1 = Monday … 7 = Sunday.
 * `endMinute` before `startMinute` runs past midnight into the next day (22:00–02:00); the window
 * belongs to the day it starts on. `endMinute: 1440` is midnight at the end of the day. Overlaps
 * between windows are checked by the server, which names the window.
 */
export interface WeeklyWindow {
  weekday: number
  startMinute: number
  endMinute: number
}

const minuteOfDay = (min: number, max: number) => v.pipe(v.number(), v.integer('Must be whole minutes'), v.minValue(min), v.maxValue(max))

export const weeklyWindowSchema = v.pipe(
  v.strictObject({
    weekday: v.pipe(v.number(), v.integer(), v.minValue(1, 'Must be 1 (Monday) to 7 (Sunday)'), v.maxValue(7, 'Must be 1 (Monday) to 7 (Sunday)')),
    startMinute: minuteOfDay(0, MINUTES_PER_DAY - 1),
    endMinute: minuteOfDay(1, MINUTES_PER_DAY),
  }),
  v.forward(v.check(w => w.startMinute !== w.endMinute, 'Must end at a different time than it starts'), ['endMinute']),
)
