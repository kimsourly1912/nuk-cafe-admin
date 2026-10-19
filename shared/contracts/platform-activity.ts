import * as v from 'valibot'
import { optionalParam, pageQuerySchema } from './common'
import type { CafeRef, TenantCounts } from './tenants'

/**
 * The platform console's Overview and Activity (step P3, D191). The Overview is counts only (D186:
 * never a cafe's contents). Activity is what the platform team did: the audit rows the console
 * writes, never a cafe's own staff's rows, even under the `tenant.*` names (an owner's
 * `tenant.profile.update`).
 */

/** Every action the console writes (D142, D187, D189), and the seed task's grant. Nothing else is Activity. */
export const PLATFORM_ACTIONS = [
  'tenant.create',
  'tenant.suspend',
  'tenant.resume',
  'tenant.slug.change',
  'tenant.owner.add',
  'tenant.owner.remove',
  'tenant.owner.transfer',
  'tenant.notes.update',
  'platform.account.ban',
  'platform.account.unban',
  'platform.account.sign-out',
  'platform.account.password.temporary',
  'platform.superadmin.grant',
] as const
export type PlatformAction = typeof PLATFORM_ACTIONS[number]

const isoDate = v.pipe(v.string(), v.isoDate('A date like 2026-10-19'))

/**
 * `GET /api/platform/activity`: newest first. `from` and `to` are dates in the platform's time
 * zone, both included.
 */
export const activityQuerySchema = v.pipe(v.object({
  ...pageQuerySchema,
  actorId: optionalParam(v.pipe(v.string(), v.uuid())),
  tenantId: optionalParam(v.pipe(v.string(), v.maxLength(64))),
  action: optionalParam(v.picklist(PLATFORM_ACTIONS)),
  from: optionalParam(isoDate),
  to: optionalParam(isoDate),
}), v.check(query => !query.from || !query.to || query.from <= query.to, 'The start must not be after the end'))
export type ActivityQuery = v.InferOutput<typeof activityQuerySchema>

export interface ActivityPerson {
  id: string
  /** `null` when the account can't be found any more. */
  name: string | null
  email: string | null
}

/** The facts of an entry the console shows; only these keys of the audit row's metadata. */
export interface ActivityDetails {
  reason?: string | null
  /** An address change. */
  from?: string
  to?: string
  /** A ban's end; `null`: until unbanned. */
  until?: string | null
  /** Notes fields changed (never their values). */
  fields?: string[]
  /** The owner added was a new account. */
  newAccount?: boolean
  /** The owner removed kept their branch roles. */
  staysStaff?: boolean
}

export interface ActivityEntry {
  id: string
  at: string
  action: PlatformAction
  /** `null`: the system (the seed task). */
  actor: ActivityPerson | null
  /** The cafe acted on, for `tenant.*`. */
  cafe: CafeRef | null
  /** The account acted on: the banned account, the owner added or removed, the new owner of a transfer. */
  account: ActivityPerson | null
  /** A transfer's previous owner. */
  previousOwner: ActivityPerson | null
  details: ActivityDetails
}

/** `GET /api/platform/overview`: counts only. */
export interface PlatformOverview {
  cafes: TenantCounts
  /** Created since the first of this month, in the platform's time zone. */
  newCafesThisMonth: number
  /** Active cafes with no order placed in the last 7 days. */
  quietCafes: number
  /** Cafes with no owner who can sign in (D189). */
  noActiveOwner: number
  /** Registered accounts banned now. */
  bannedAccounts: number
  /** The platform's time zone the month starts in. */
  timeZone: string
}
