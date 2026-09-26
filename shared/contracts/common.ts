import * as v from 'valibot'

/**
 * Conventions every `/api/v1` route follows (docs/reference/api.md):
 * - JSON in and out; ids are opaque strings; timestamps are ISO 8601 UTC strings.
 * - Failures use an HTTP status and the error body below; never HTTP 200 with a failure flag.
 * - Lists that can grow are paginated with `page` (1-based) and `pageSize`.
 */

export const STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type Status = typeof STATUSES[number]

/** Machine-readable error codes. The HTTP status says the kind; the code says the reason. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'NOT_STAFF',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'REFERENCE_NOT_FOUND',
  'CATEGORY_DEPTH',
  'CATEGORY_HAS_CHILDREN',
  'CATEGORY_IN_USE',
  'ORDER_STALE',
  'SCHEDULE_IN_USE',
  'UNSUPPORTED_MEDIA',
  'MEDIA_TOO_LARGE',
  'BOOTSTRAP_DISABLED',
  'ADMIN_EXISTS',
  'USER_NOT_FOUND',
  'INTERNAL',
] as const
export type ErrorCode = typeof ERROR_CODES[number]

/**
 * The error body of every failed `/api/v1` request (the `data` of the JSON error response).
 * `message` is safe to show to users; `fieldErrors` maps a request field path (`name`,
 * `variantGroups.0.name`) to its messages.
 */
export interface ApiErrorBody {
  code: ErrorCode
  message: string
  fieldErrors?: Record<string, string[]>
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
