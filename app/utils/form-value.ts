import { toRaw } from 'vue'

/**
 * Snapshot of form state to compare against later (see `useUnsavedChanges`).
 * Deep-copies plain objects and arrays (unwrapping Vue proxies); keeps files, blobs and dates
 * by reference, since forms replace them rather than mutate them.
 */
export function cloneFormValue<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(cloneFormValue) as T
  if (isPlainObject(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, cloneFormValue(item)])) as T
  }
  return raw
}

/**
 * Whether two form states hold the same input, ignoring differences a user can't see:
 * `''`, `null`, `undefined`, `[]` and a missing key all mean "empty". Array order matters.
 * Reads through reactive proxies (no `toRaw`), so a `computed` using it tracks every field.
 */
export function isSameFormValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true
  if (Object.is(a, b)) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isSameFormValue(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every(key => isSameFormValue(a[key], b[key]))
  }
  return false
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
