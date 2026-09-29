/**
 * Sentinel for "no filter" in selects (USelect cannot hold `undefined` or '').
 * `toApiQuery` strips it before the request.
 */
export const ANY = 'ALL'
export type Any = typeof ANY

/** Filter values as sent to the API: `ANY` and empty strings become `undefined`. */
export type ApiQuery<T> = { [K in keyof T]?: Exclude<T[K], Any> }

export function toApiQuery<T extends Record<string, unknown>>(filters: T): ApiQuery<T> {
  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    query[key] = value === ANY || value === '' ? undefined : value
  }
  return query as ApiQuery<T>
}

type UrlQuery = Record<string, string | null | (string | null)[] | undefined>

/**
 * List state → URL query. Only values that differ from the defaults are written, and page 1
 * is omitted, so a list without filters has a clean URL (`/admin/categories`).
 */
export function toUrlQuery(filters: Record<string, unknown>, defaults: Record<string, unknown>, page: number) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value !== defaults[key] && value !== undefined && value !== null && value !== '') query[key] = String(value)
  }
  if (page > 1) query.page = String(page)
  return query
}

/**
 * URL query → list state, typed by the defaults (a number default parses a number).
 * Missing or unreadable values fall back to the default; a bad page falls back to 1.
 */
export function fromUrlQuery<T extends Record<string, unknown>>(query: UrlQuery, defaults: T): { filters: T, page: number } {
  const filters = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const raw = query[key]
    if (typeof raw !== 'string' || raw === '') continue
    if (typeof defaults[key] === 'number') {
      const number = Number(raw)
      if (Number.isFinite(number)) filters[key] = number as T[typeof key]
    }
    else {
      filters[key] = raw as T[typeof key]
    }
  }
  const page = Number(query.page)
  return { filters, page: Number.isInteger(page) && page >= 1 ? page : 1 }
}
