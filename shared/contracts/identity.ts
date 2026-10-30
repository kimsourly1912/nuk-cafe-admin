import * as v from 'valibot'

/**
 * `GET /api/admin/me`: the signed-in admin, for the admin app (D52). Only platform admins may use
 * the admin app for now; branch managers and staff get 403 (their screens come with the counter).
 */
export interface AdminSession {
  userId: string
  email: string
  name: string
  /** `support`: a super admin's read-only visit, allowed by the cafe's owner (P5, D193). */
  role: 'admin' | 'support'
  /**
   * The platform actions this account may take, as `resource:action` (`menu:write`,
   * `staff:create`). For hiding UI only: the server checks every request itself.
   */
  permissions: string[]
  /**
   * Still on a temporary password: every other admin route answers 403
   * `PASSWORD_CHANGE_REQUIRED` until it's changed, and the app shows the change-password page.
   */
  mustChangePassword: boolean
  /** During a support visit: when the visit and the owner's permission end. */
  support?: { tenantId: string, visitExpiresAt: string, grantExpiresAt: string }
  /** Platform support is allowed until then (the owners' banner); `null` when it isn't. */
  supportAllowedUntil: string | null
}

/** Better Auth's limits (`minPasswordLength` / `maxPasswordLength` defaults). */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const newPasswordSchema = v.pipe(
  v.string(),
  v.minLength(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`),
  v.maxLength(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`),
)

/**
 * `GET /api/password-ranges/{prefix}` (D210): the leaked-password list's entries whose SHA-1 starts
 * with these 5 hex characters, so a new-password field can say "Not easy to guess" while typing.
 * Only the hash's first 5 characters leave the browser (Have I Been Pwned's k-anonymity); the
 * browser compares the rest itself. Advisory: Better Auth checks again when the password is saved.
 */
export const passwordRangePrefixSchema = v.pipe(
  v.string(),
  v.regex(/^[0-9a-f]{5}$/i, 'Five hexadecimal characters'),
  v.toUpperCase(),
)

export interface PasswordRange {
  /** The other 35 characters of each leaked password's SHA-1, upper case. */
  suffixes: string[]
}

/**
 * `GET /api/counter/me`: the signed-in staff member, for the counter app (step 6.3b, D102): the
 * branches they work at (every active branch for a platform admin). Answers while a temporary
 * password is in place, like `/admin/me`, so the app can ask for a new one. A customer with no
 * branch is 403 `NOT_STAFF`.
 */
export interface CounterSession {
  userId: string
  email: string
  name: string
  mustChangePassword: boolean
  /**
   * `permissions`: what the session may do at that branch, as `resource:action` (`table:manage`); an
   * owner's are all of them (D240). For the app to show only what opens: the server checks every
   * request itself.
   */
  branches: { id: string, name: string, role: 'admin' | 'manager' | 'staff', permissions: string[] }[]
}
