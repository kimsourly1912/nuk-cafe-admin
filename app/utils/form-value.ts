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

/** A part of a form that changes as one (an image's id and its preview; option sets and their grid). */
export interface FormPart<T> {
  label: string
  keys: readonly (keyof T)[]
}

/**
 * Someone else saved the record while this form was open (a 409, D41): their version, with this
 * person's changes put back on top. Part by part, against what the form opened with (`base`): a part
 * this person changed keeps their input; any other part takes the newer version. `overlap` names the
 * parts both changed differently, where this input won over theirs: say so, so they check it before
 * saving. Keys in no part are compared one by one, named by the key.
 */
export function mergeFormChanges<T extends object>(options: { base: T, mine: T, theirs: T, parts?: readonly FormPart<T>[] }) {
  const { base, mine, theirs, parts = [] } = options
  const grouped = new Set(parts.flatMap(part => part.keys))
  const all: FormPart<T>[] = [
    ...parts,
    ...(Object.keys({ ...theirs, ...mine }) as (keyof T)[])
      .filter(key => !grouped.has(key))
      .map(key => ({ label: String(key), keys: [key] })),
  ]
  const changed = (a: T, b: T, part: FormPart<T>) => part.keys.some(key => !isSameFormValue(a[key], b[key]))

  const merged = cloneFormValue(theirs)
  const overlap: string[] = []
  for (const part of all) {
    if (!changed(mine, base, part)) continue
    for (const key of part.keys) merged[key] = cloneFormValue(mine[key])
    if (changed(theirs, base, part) && changed(mine, theirs, part)) overlap.push(part.label)
  }
  return { merged, overlap }
}
