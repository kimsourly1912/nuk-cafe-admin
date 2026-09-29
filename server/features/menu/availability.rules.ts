import type { AvailabilityStatus, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { LocalTime } from '../../utils/weekly-windows'
import { isInWindow } from '../../utils/weekly-windows'

/**
 * Pure availability rules (no I/O; docs/server/data-model.md → Menu, D45, D63). The window rules
 * themselves (overlap, "is it in the window", the branch's wall clock) are shared with branch hours
 * in `server/utils/weekly-windows.ts` (D91), and re-exported here for the menu.
 */

export type { LocalTime } from '../../utils/weekly-windows'
export { describeWindow, isInWindow, localTime, sortWindows, windowsProblem } from '../../utils/weekly-windows'

/** A rule as the availability check needs it. */
export interface RuleForCheck {
  status: AvailabilityStatus
  windows: AvailabilityWindow[]
}

/** Whether an active rule matches `at`. An archived rule never matches. */
export const ruleMatches = (rule: RuleForCheck, at: LocalTime) =>
  rule.status === 'active' && rule.windows.some(window => isInWindow(window, at))

/**
 * Whether something is available at `at`, given the rules of each level it depends on: the item,
 * its category, and that category's parent. A level without rules doesn't limit; a level with
 * rules needs one of them to match (D45). An item is available only when every level is.
 *
 * Only the menu's own rules: the branch being open and sold-out switches are checked separately.
 */
export function isAvailableAt(levels: RuleForCheck[][], at: LocalTime): boolean {
  return levels.every(rules => rules.length === 0 || rules.some(rule => ruleMatches(rule, at)))
}
