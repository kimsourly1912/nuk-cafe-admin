/**
 * Schedule times are local wall time in the schedule's own zone (the cafe's zone, D41), shown and
 * entered as they are: "Monday 09:00" means 09:00 at the cafe, whoever looks at it. No conversion
 * to the viewer's zone (that was D33, superseded).
 */

/** Short name for a zone, e.g. "GMT+7" or "UTC"; the zone id if the browser doesn't know it. */
export function zoneLabel(timeZone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value ?? timeZone
  }
  catch {
    return timeZone
  }
}

/** "Asia/Phnom_Penh (GMT+7)". */
export function describeZone(timeZone: string, date = new Date()): string {
  const label = zoneLabel(timeZone, date)
  return label === timeZone ? timeZone : `${timeZone} (${label})`
}
