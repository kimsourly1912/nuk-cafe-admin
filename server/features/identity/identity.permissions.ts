import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements as adminPluginStatements } from 'better-auth/plugins/admin/access'
import { defaultStatements as organizationPluginStatements } from 'better-auth/plugins/organization/access'

/**
 * Who may do what (docs/server/security.md → Roles and permissions, D45, D134). Three layers:
 * - **platform** roles on the user (`admin` plugin): `customer` (everyone), `superadmin` (the
 *   platform team: tenants, never a tenant's data);
 * - **tenant** roles on the membership (`organization` plugin, a tenant is an organization):
 *   `owner` (everything in the cafe), `member` (nothing beyond their branches);
 * - **branch** roles in `branch_staff`: `manager`, `staff` (our own table; checked with this
 *   access control, outside Better Auth).
 * A tenant's owner holds every branch permission in every branch of that tenant;
 * `requireBranchPermission` grants that.
 */

// --- Platform (admin plugin) ---

export const platformStatements = {
  // Better Auth's own admin endpoints (create user, set role, ban, sessions…).
  ...adminPluginStatements,
  tenant: ['create', 'read', 'update', 'suspend'],
  // Accounts in the console (step P1, D187): through our routes, audited in the same batch.
  account: ['read', 'ban', 'sign-out', 'reset-password'],
  // A cafe's owners and the platform's notes about it (step P2, D189).
  owner: ['add', 'remove', 'transfer'],
  notes: ['update'],
  // The console's Activity: what the platform team did (step P3, D191).
  activity: ['read'],
  // System health: counts and dates, never a secret (step P4, D192).
  health: ['read'],
  // Opening a cafe its owner allowed support for (step P5, D193).
  support: ['open'],
} as const

export const platformAc = createAccessControl(platformStatements)

export const platformRoles = {
  customer: platformAc.newRole({}),
  superadmin: platformAc.newRole({
    // None of Better Auth's `user` / `session` admin endpoints (D187): they write without our audit
    // row or version guard, so accounts change only through the console's routes. No impersonation
    // either: off until there is a support process for it (QP1).
    tenant: ['create', 'read', 'update', 'suspend'],
    account: ['read', 'ban', 'sign-out', 'reset-password'],
    owner: ['add', 'remove', 'transfer'],
    notes: ['update'],
    activity: ['read'],
    health: ['read'],
    support: ['open'],
  }),
}

export type PlatformRole = keyof typeof platformRoles
export const PLATFORM_ROLES = Object.keys(platformRoles) as PlatformRole[]

// --- Tenant (organization plugin) ---

export const tenantStatements = {
  // Better Auth's own organization endpoints (members, invitations, teams, access control): unused,
  // our staff routes manage memberships; listed so no role gets them by accident.
  ...organizationPluginStatements,
  menu: ['read', 'write', 'publish'],
  media: ['upload'],
  branch: ['create', 'read', 'update'],
  staff: ['read', 'create', 'update', 'disable', 'reset-password'],
  voucherTemplate: ['manage'],
  loyalty: ['adjust'],
  settings: ['manage'],
  report: ['read', 'export'],
  audit: ['read'],
  // The AI assistant (phase 9, D107): owners only for now.
  assistant: ['use'],
  // Allowing platform support (step P5, D193): owners only.
  support: ['grant'],
} as const

export const tenantAc = createAccessControl(tenantStatements)

export const tenantRoles = {
  owner: tenantAc.newRole({
    menu: ['read', 'write', 'publish'],
    media: ['upload'],
    branch: ['create', 'read', 'update'],
    staff: ['read', 'create', 'update', 'disable', 'reset-password'],
    voucherTemplate: ['manage'],
    loyalty: ['adjust'],
    settings: ['manage'],
    report: ['read', 'export'],
    audit: ['read'],
    assistant: ['use'],
    support: ['grant'],
  }),
  // Works at some branches (branch_staff); nothing tenant-wide.
  member: tenantAc.newRole({}),
}

export type TenantRole = keyof typeof tenantRoles
export const TENANT_ROLES = Object.keys(tenantRoles) as TenantRole[]

// --- Branch (branch_staff) ---

export const branchStatements = {
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
  // Staff management and refunds stay with the tenant's owners (D45).
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
/** A permission request on the platform layer, e.g. `{ tenant: ['create'] }`. */
export type PlatformPermission = Actions<typeof platformStatements>
/** A permission request on the tenant layer, e.g. `{ menu: ['write'] }`. */
export type TenantPermission = Actions<typeof tenantStatements>
/** A permission request on the branch layer, e.g. `{ order: ['cancel'] }`. */
export type BranchPermission = Actions<typeof branchStatements>
