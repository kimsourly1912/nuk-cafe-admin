import * as v from 'valibot'
import { nameSchema, optionalParam, pageQuerySchema, versionSchema } from './common'

/**
 * The platform console's Accounts (step P1, D187): super admins see every registered account and
 * can ban it, sign it out everywhere or give it a temporary password. An account is identity only:
 * its name, email and sign-in facts, and the cafes it works in. Never the cafes a customer has
 * ordered from or has a profile in (D186): that is order data.
 */

export const ACCOUNT_KINDS = ['owner', 'staff', 'customer', 'superadmin', 'banned'] as const
export type AccountKind = typeof ACCOUNT_KINDS[number]

/** `GET /api/platform/accounts`: guests never appear. */
export const accountListQuerySchema = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  kind: optionalParam(v.picklist(ACCOUNT_KINDS)),
})
export type AccountListQuery = v.InferOutput<typeof accountListQuerySchema>

export const ACCOUNT_REASON_MAX = 500

/** Why a super admin acted: kept in the platform's audit log, never shown to the account. */
const reasonSchema = nameSchema(ACCOUNT_REASON_MAX)

/**
 * `POST …/accounts/{id}/ban`: `until` ends the ban by itself (Better Auth lifts it at the next
 * sign-in after it); without it the ban lasts until someone unbans the account.
 */
export const banAccountSchema = v.object({
  version: versionSchema,
  reason: reasonSchema,
  until: v.optional(v.nullable(v.pipe(v.string(), v.isoTimestamp('Must be a date and time')))),
})
export type BanAccountInput = v.InferOutput<typeof banAccountSchema>

export const unbanAccountSchema = v.object({ version: versionSchema })
export type UnbanAccountInput = v.InferOutput<typeof unbanAccountSchema>

export const accountPasswordSchema = v.object({ version: versionSchema, reason: reasonSchema })
export type AccountPasswordInput = v.InferOutput<typeof accountPasswordSchema>

export type AccountCafeRole = 'owner' | 'staff'

/** A cafe the account works in. */
export interface AccountCafeAccess {
  id: string
  name: string
  slug: string
  role: AccountCafeRole
  /** An owner who is the cafe's only owner able to sign in: banning them leaves it without one. */
  onlyActiveOwner: boolean
}

export interface AccountBan {
  reason: string | null
  /** `null`: until unbanned. */
  until: string | null
}

export interface PlatformAccountSummary {
  id: string
  name: string
  email: string
  emailVerified: boolean
  isSuperadmin: boolean
  /** How many cafes it owns, and works in as staff. */
  ownerOf: number
  staffOf: number
  ban: AccountBan | null
  createdAt: string
}

export interface PlatformAccountDetail extends PlatformAccountSummary {
  cafes: AccountCafeAccess[]
  /** Must choose a new password at the next sign-in (a temporary one is set). */
  mustChangePassword: boolean
  /** Sessions still open, and the latest activity among them. */
  activeSessions: number
  lastActiveAt: string | null
  /** Send it back with every change (409 when someone changed the account meanwhile). */
  version: number
}

export interface AccountTemporaryPassword {
  account: PlatformAccountDetail
  /** Shown once; only its hash is kept. */
  temporaryPassword: string
}
