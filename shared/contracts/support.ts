import * as v from 'valibot'

/**
 * Support access (step P5, D193; QP1 answered with the defaults, 2026-10-19): a cafe's owner allows
 * the platform team to look at the cafe's admin for 24 hours, read-only; any super admin may then
 * open it after a fresh two-step code. The owners see it and can end it at any time.
 */

export const SUPPORT_GRANT_HOURS = 24
/** A visit lasts at most this long (and never past the grant): then a new code is asked. */
export const SUPPORT_VISIT_MINUTES = 60

export interface SupportPerson {
  id: string
  /** `null` when the account can't be found any more. */
  name: string | null
}

export interface SupportVisit {
  id: string
  by: SupportPerson
  openedAt: string
  expiresAt: string
  closedAt: string | null
}

export interface SupportGrant {
  id: string
  grantedBy: SupportPerson
  grantedAt: string
  expiresAt: string
  endedAt: string | null
  endedBy: SupportPerson | null
  /** Active: not ended and not expired. */
  active: boolean
  visits: SupportVisit[]
}

/** `GET /api/c/<slug>/admin/support`: the grant in force (if any) and the latest ones, newest first. */
export interface CafeSupport {
  active: SupportGrant | null
  history: SupportGrant[]
}

/** `POST /api/platform/tenants/{id}/support/open`: a fresh code from the super admin's authenticator app. */
export const openSupportSchema = v.object({
  code: v.pipe(v.string(), v.trim(), v.regex(/^\d{6}$/, 'Enter the 6-digit code from your app')),
})
export type OpenSupportInput = v.InferOutput<typeof openSupportSchema>

export interface SupportOpened {
  /** The cafe's admin, to open with a full page load. */
  path: string
  expiresAt: string
}

/** On a cafe in the console: whether its owner allows support now. */
export interface TenantSupport {
  grantedAt: string
  expiresAt: string
}
