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
