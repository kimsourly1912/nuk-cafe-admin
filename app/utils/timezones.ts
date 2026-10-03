/**
 * Time zones as people pick them: "(GMT+07:00) Phnom Penh", by offset, then name. The browser's
 * list (`Intl.supportedValuesOf`), plus the current zone if the browser doesn't list it. Used by
 * the branch form and a new cafe's first branch (D142).
 */

export interface TimezoneOption {
  value: string
  label: string
  /** Minutes east of UTC now, for sorting. */
  offset: number
}

/** "GMT+07:00" for the zone now ("GMT" for UTC itself). */
export function gmtOffset(timeZone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')
  return part?.value ?? 'GMT'
}

function offsetMinutes(gmt: string): number {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(gmt)
  if (!match) return 0
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
}

/** "Asia/Phnom_Penh" → "Phnom Penh"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const cityOf = (timeZone: string) => (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ')

/** "UTC+7", "UTC+5:30", "UTC" for the zone now: the short form on the status card. */
export function utcOffset(timeZone: string, at = new Date()): string {
  const minutes = offsetMinutes(gmtOffset(timeZone, at))
  if (!minutes) return 'UTC'
  const sign = minutes < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

export function timezoneOptions(current?: string, at = new Date()): TimezoneOption[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'))
  if (current) zones.add(current)
  return [...zones]
    .map((zone) => {
      const gmt = gmtOffset(zone, at)
      return { value: zone, label: `(${gmt === 'GMT' ? 'GMT+00:00' : gmt}) ${cityOf(zone)}`, offset: offsetMinutes(gmt) }
    })
    .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
}
