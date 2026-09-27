import { and, eq, sql } from 'drizzle-orm'
import type { BootstrapAdminBody, Permission, StaffRole, StaffSession } from '#shared/contracts/identity'
import { ROLE_PERMISSIONS } from '#shared/contracts/identity'
import { auditEvents, staffProfiles, user } from '../../db/tables'
import type { Db } from '../../utils/batch'
import { requireCount } from '../../utils/batch'
import { apiError } from '../../utils/errors'

/** Who performs a privileged action, for audit events. */
export interface Actor {
  userId: string
}

/** The active staff profile of a user with their permissions, or `null` (no profile, or disabled). */
export async function findStaffSession(db: Db, userId: string): Promise<StaffSession | null> {
  const [row] = await db
    .select({ userId: staffProfiles.userId, email: user.email, displayName: staffProfiles.displayName, role: staffProfiles.role })
    .from(staffProfiles)
    .innerJoin(user, eq(user.id, staffProfiles.userId))
    .where(and(eq(staffProfiles.userId, userId), eq(staffProfiles.status, 'active')))
  if (!row) return null
  const role: StaffRole = row.role
  return { ...row, role, permissions: [...ROLE_PERMISSIONS[role]] }
}

/**
 * The gate of every admin route: signed in (401), active staff (403 NOT_STAFF), and holding the
 * permission (403 FORBIDDEN). A signed-in customer is not staff.
 */
export async function authorizeStaff(db: Db, userId: string | null | undefined, permission?: Permission): Promise<StaffSession> {
  if (!userId) throw apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  const staff = await findStaffSession(db, userId)
  if (!staff) throw apiError(403, 'NOT_STAFF', 'This account doesn\'t have staff access.')
  if (permission && !staff.permissions.includes(permission)) {
    throw apiError(403, 'FORBIDDEN', 'You don\'t have permission to do this.')
  }
  return staff
}

/** Tokens shorter than this are refused: the endpoint is reachable by anyone who knows it. */
export const MIN_BOOTSTRAP_TOKEN_LENGTH = 32

/** Constant-time comparison (no `node:crypto`: it must also run on Workers). */
function sameToken(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let difference = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return difference === 0
}

/**
 * Makes an existing account (created through Better Auth sign-up) the first admin (D40).
 * - Disabled unless the server has a bootstrap token of at least 32 characters; the token sent
 *   must match it.
 * - Refused once any admin exists, so it can't be used to take over later.
 */
export async function bootstrapAdmin(db: Db, configuredToken: string | undefined, input: BootstrapAdminBody) {
  if (!configuredToken || configuredToken.length < MIN_BOOTSTRAP_TOKEN_LENGTH) {
    throw apiError(404, 'BOOTSTRAP_DISABLED', 'Bootstrap is not enabled on this server.')
  }
  if (!sameToken(input.token, configuredToken)) throw apiError(403, 'FORBIDDEN', 'The bootstrap token is wrong.')

  const [existing] = await db.select({ userId: staffProfiles.userId }).from(staffProfiles).where(eq(staffProfiles.role, 'admin')).limit(1)
  if (existing) throw apiError(409, 'ADMIN_EXISTS', 'An admin already exists. Ask them to add staff.')

  const [account] = await db.select().from(user).where(eq(user.email, input.email))
  if (!account) throw apiError(404, 'USER_NOT_FOUND', 'No account uses this email. Sign up first.')

  const displayName = input.displayName ?? account.name
  // Checked again inside the write: two bootstrap calls at once still create one admin.
  await db.batch([
    requireCount(db, sql`select count(*) from ${staffProfiles} where ${staffProfiles.role} = 'admin'`, 0),
    db.insert(staffProfiles).values({ userId: account.id, displayName, role: 'admin' }),
    db.insert(auditEvents).values({
      actorUserId: account.id,
      action: 'staff.bootstrap_admin',
      targetType: 'staff',
      targetId: account.id,
      metadata: { email: account.email },
    }),
  ])
  return findStaffSession(db, account.id)
}
