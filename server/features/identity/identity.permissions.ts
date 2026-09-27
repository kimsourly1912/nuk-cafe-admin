import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements as adminPluginStatements } from 'better-auth/plugins/admin/access'
import { defaultStatements as organizationPluginStatements } from 'better-auth/plugins/organization/access'

/**
 * Who may do what (docs/server/security.md → Roles and permissions, D45). Two layers, both checked
 * by Better Auth's access control:
 * - **platform** roles on the user (`admin` plugin): `customer` (everyone who signs up), `admin`;
 * - **branch** roles on the membership (`organization` plugin, a branch is an organization):
 *   `manager`, `staff`.
 * A platform admin holds every branch permission in every branch; `requireBranchPermission`
 * grants that, because Better Auth only knows branch roles for members of that branch.
 */

// --- Platform (admin plugin) ---

export const platformStatements = {
  // Better Auth's own admin endpoints (create user, set role, ban, sessions…).
  ...adminPluginStatements,
  menu: ['read', 'write', 'publish'],
  media: ['upload'],
  branch: ['create', 'read', 'update'],
  staff: ['read', 'create', 'update', 'disable'],
  voucherTemplate: ['manage'],
  loyalty: ['adjust'],
  settings: ['manage'],
  report: ['read'],
  audit: ['read'],
} as const

export const platformAc = createAccessControl(platformStatements)

export const platformRoles = {
  customer: platformAc.newRole({}),
  admin: platformAc.newRole({
    // No impersonation: off until there is a support process for it (security.md).
    user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'set-email', 'get', 'update'],
    session: ['list', 'revoke', 'delete'],
    menu: ['read', 'write', 'publish'],
    media: ['upload'],
    branch: ['create', 'read', 'update'],
    staff: ['read', 'create', 'update', 'disable'],
    voucherTemplate: ['manage'],
    loyalty: ['adjust'],
    settings: ['manage'],
    report: ['read'],
    audit: ['read'],
  }),
}

export type PlatformRole = keyof typeof platformRoles
export const PLATFORM_ROLES = Object.keys(platformRoles) as PlatformRole[]

// --- Branch (organization plugin) ---

export const branchStatements = {
  // Better Auth's own organization endpoints (members, invitations, teams, access control).
  ...organizationPluginStatements,
  menu: ['read', 'setSoldOut'],
  branch: ['read'],
  table: ['manage', 'rotateQr'],
  order: ['read', 'ready', 'complete', 'cancel'],
  payment: ['collect', 'refund'],
  voucher: ['lookup', 'redeem', 'issue'],
  loyalty: ['adjust'],
  report: ['read'],
  audit: ['read'],
} as const

export const branchAc = createAccessControl(branchStatements)

export const branchRoles = {
  // Staff management and refunds stay with platform admins (D45): no member/invitation rights here.
  manager: branchAc.newRole({
    menu: ['read', 'setSoldOut'],
    branch: ['read'],
    table: ['manage', 'rotateQr'],
    order: ['read', 'ready', 'complete', 'cancel'],
    payment: ['collect'],
    voucher: ['lookup', 'redeem', 'issue'],
    loyalty: ['adjust'],
    report: ['read'],
    audit: ['read'],
  }),
  staff: branchAc.newRole({
    menu: ['read', 'setSoldOut'],
    branch: ['read'],
    order: ['read', 'ready', 'complete', 'cancel'],
    payment: ['collect'],
    voucher: ['lookup', 'redeem'],
  }),
}

export type BranchRole = keyof typeof branchRoles
export const BRANCH_ROLES = Object.keys(branchRoles) as BranchRole[]

type Actions<S> = { [K in keyof S]?: S[K] extends readonly (infer A)[] ? A[] : never }
/** A permission request on the platform layer, e.g. `{ menu: ['write'] }`. */
export type PlatformPermission = Actions<typeof platformStatements>
/** A permission request on the branch layer, e.g. `{ order: ['cancel'] }`. */
export type BranchPermission = Actions<typeof branchStatements>
