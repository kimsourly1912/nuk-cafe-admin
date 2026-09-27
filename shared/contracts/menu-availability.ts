import * as v from 'valibot'
import { idSchema, nameSchema, versionSchema } from './common'

/**
 * Availability rules (`/api/admin/menu/availability-rules`, D45, D63): named sets of weekly time
 * windows ("Breakfast": Mon–Fri 07:00–11:00) that limit when menu items and categories are sold.
 * Times are minutes after midnight in the branch's time zone. An item or category with no rule is
 * available whenever the branch is open; with several, when any of them matches. A rule's `version`
 * covers its windows: they're edited together.
 */

export const AVAILABILITY_STATUSES = ['active', 'archived'] as const
export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number]

export const AVAILABILITY_RULE_NAME_MAX = 40
/** Windows per rule: three a day, every day. */
export const MAX_AVAILABILITY_WINDOWS = 21
/** Rules on one item or category. */
export const MAX_TARGET_RULES = 5
export const MINUTES_PER_DAY = 1440

/**
 * One weekly window. `weekday` is ISO 8601: 1 = Monday … 7 = Sunday. `endMinute` before
 * `startMinute` runs past midnight into the next day (22:00–02:00); the window belongs to the day
 * it starts on. `endMinute: 1440` is midnight at the end of the day.
 */
export interface AvailabilityWindow {
  weekday: number
  startMinute: number
  endMinute: number
}

export interface AvailabilityRule {
  id: string
  name: string
  status: AvailabilityStatus
  /** By weekday, then start time. */
  windows: AvailabilityWindow[]
  /** Menu items (drafts and active ones) that use this rule. */
  itemCount: number
  /** Active categories that use this rule. */
  categoryCount: number
  version: number
  createdAt: string
  updatedAt: string
}

/** A rule as an item or category shows it. An archived rule never matches (D63). */
export interface AvailabilityRuleRef {
  id: string
  name: string
  status: AvailabilityStatus
}

const minute = (min: number, max: number) => v.pipe(v.number(), v.integer('Must be whole minutes'), v.minValue(min), v.maxValue(max))

const windowSchema = v.pipe(
  v.strictObject({
    weekday: v.pipe(v.number(), v.integer(), v.minValue(1, 'Must be 1 (Monday) to 7 (Sunday)'), v.maxValue(7, 'Must be 1 (Monday) to 7 (Sunday)')),
    startMinute: minute(0, MINUTES_PER_DAY - 1),
    endMinute: minute(1, MINUTES_PER_DAY),
  }),
  v.forward(v.check(w => w.startMinute !== w.endMinute, 'Must end at a different time than it starts'), ['endMinute']),
)

/** Overlaps between windows are checked by the server, which names the window. */
const windowsSchema = v.pipe(
  v.array(windowSchema),
  v.minLength(1, 'Add at least one time window'),
  v.maxLength(MAX_AVAILABILITY_WINDOWS, `At most ${MAX_AVAILABILITY_WINDOWS} time windows`),
)

const ruleName = nameSchema(AVAILABILITY_RULE_NAME_MAX)

/** The rules an item or category uses; `[]`: available whenever the branch is open. */
export const availabilityRuleIdsSchema = v.pipe(
  v.array(idSchema),
  v.maxLength(MAX_TARGET_RULES, `At most ${MAX_TARGET_RULES} availability rules`),
  v.check(ids => new Set(ids).size === ids.length, 'Each rule can be chosen once'),
)

export const availabilityRuleListQuerySchema = v.object({
  status: v.optional(v.picklist(['active', 'archived', 'all']), 'active'),
})
export type AvailabilityRuleListQuery = v.InferOutput<typeof availabilityRuleListQuerySchema>

export const createAvailabilityRuleSchema = v.strictObject({
  name: ruleName,
  windows: windowsSchema,
})
export type CreateAvailabilityRuleInput = v.InferOutput<typeof createAvailabilityRuleSchema>

/** Only the fields to change: absent keeps. `windows` replaces them all. */
export const updateAvailabilityRuleSchema = v.strictObject({
  version: versionSchema,
  name: v.optional(ruleName),
  windows: v.optional(windowsSchema),
})
export type UpdateAvailabilityRuleInput = v.InferOutput<typeof updateAvailabilityRuleSchema>

/** Archive or restore: the version read. */
export const availabilityRuleVersionSchema = v.strictObject({ version: versionSchema })
export type AvailabilityRuleVersionInput = v.InferOutput<typeof availabilityRuleVersionSchema>
