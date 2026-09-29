import type { PublicBranch } from '#shared/contracts/branches'
import { formatClock } from '~/utils/clock'

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * When a closed branch opens, on its own clock (the server works out the day, D93):
 * "Opens today at 7:00 AM", "Opens tomorrow at 7:00 AM", "Opens Friday at 7:00 AM",
 * "Opens next Monday at 7:00 AM" (a week away). `undefined` while open or without hours.
 */
export function openingText(branch: Pick<PublicBranch, 'openNow' | 'nextOpening'>): string | undefined {
  const next = branch.nextOpening
  if (branch.openNow || !next) return undefined
  const time = formatClock(next.startMinute)
  if (next.inDays === 0) return `Opens today at ${time}`
  if (next.inDays === 1) return `Opens tomorrow at ${time}`
  const day = WEEKDAY_NAMES[next.weekday - 1]
  return next.inDays === 7 ? `Opens next ${day} at ${time}` : `Opens ${day} at ${time}`
}
