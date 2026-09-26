import { Time } from '@internationalized/date'

/**
 * The form keeps times as the API's strings (`HH:mm`, plan S1) so the schema, the request mapping
 * and the unsaved-changes check stay plain. `UInputTime` works with `Time` objects: these convert.
 */

/** `"08:30"` / `"08:30:15"` → `Time`; anything else (empty, malformed) → `undefined`. */
export function parseTime(value: string): Time | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return undefined
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
  if (hour > 23 || minute > 59 || second > 59) return undefined
  return new Time(hour, minute, second)
}

/** `"08:30"` → `"8:30 AM"`, `"00:15"` → `"12:15 AM"`. Unparsable values are returned as they are. */
export function formatTime12(value: string): string {
  const time = parseTime(value)
  if (!time) return value
  const hour = time.hour % 12 || 12
  return `${hour}:${String(time.minute).padStart(2, '0')} ${time.hour < 12 ? 'AM' : 'PM'}`
}

/** `Time` → `"08:30"` (seconds only if a record had them); cleared input → `''`. */
export function formatTime(time: { hour: number, minute: number, second?: number } | undefined | null): string {
  if (!time) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${pad(time.hour)}:${pad(time.minute)}`
  return time.second ? `${base}:${pad(time.second)}` : base
}
