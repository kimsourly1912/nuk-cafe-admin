import { describe, expect, it } from 'vitest'
import { branchRoles, platformRoles, tenantRoles } from '#server/features/identity/identity.permissions'
import type { BranchRole, PlatformRole, TenantRole } from '#server/features/identity/identity.permissions'

// The role matrix of docs/server/security.md (D45, D134), one row per grant. A change to a role
// must change this table too.
type Row = [resource: string, action: string, allowed: readonly string[]]

const platformMatrix: Row[] = [
  ['tenant', 'create', ['superadmin']],
  ['tenant', 'read', ['superadmin']],
  ['tenant', 'update', ['superadmin']],
  ['tenant', 'suspend', ['superadmin']],
  // Better Auth's admin endpoints.
  ['user', 'create', ['superadmin']],
  ['user', 'set-role', ['superadmin']],
  ['user', 'ban', ['superadmin']],
  ['session', 'revoke', ['superadmin']],
  ['user', 'impersonate', []],
  ['user', 'impersonate-admins', []],
]

const tenantMatrix: Row[] = [
  ['menu', 'read', ['owner']],
  ['menu', 'write', ['owner']],
  ['menu', 'publish', ['owner']],
  ['media', 'upload', ['owner']],
  ['branch', 'create', ['owner']],
  ['branch', 'update', ['owner']],
  ['staff', 'read', ['owner']],
  ['staff', 'create', ['owner']],
  ['staff', 'update', ['owner']],
  ['staff', 'disable', ['owner']],
  ['staff', 'reset-password', ['owner']],
  ['voucherTemplate', 'manage', ['owner']],
  ['loyalty', 'adjust', ['owner']],
  ['settings', 'manage', ['owner']],
  ['assistant', 'use', ['owner']],
  ['report', 'read', ['owner']],
  ['report', 'export', ['owner']],
  ['audit', 'read', ['owner']],
  // Better Auth's organization endpoints: memberships go through our staff routes (D134).
  ['organization', 'update', []],
  ['organization', 'delete', []],
  ['member', 'create', []],
  ['member', 'update', []],
  ['member', 'delete', []],
  ['invitation', 'create', []],
  ['ac', 'create', []],
]

const branchMatrix: Row[] = [
  ['menu', 'read', ['manager', 'staff']],
  ['menu', 'setSoldOut', ['manager', 'staff']],
  ['branch', 'read', ['manager', 'staff']],
  ['table', 'manage', ['manager']],
  ['table', 'rotateQr', ['manager']],
  ['order', 'read', ['manager', 'staff']],
  ['order', 'ready', ['manager', 'staff']],
  ['order', 'complete', ['manager', 'staff']],
  ['order', 'cancel', ['manager', 'staff']],
  ['payment', 'collect', ['manager', 'staff']],
  ['payment', 'refund', []],
  ['voucher', 'lookup', ['manager', 'staff']],
  ['voucher', 'redeem', ['manager', 'staff']],
  ['voucher', 'issue', ['manager']],
  ['loyalty', 'adjust', ['manager']],
  ['report', 'read', ['manager']],
  ['audit', 'read', ['manager']],
]

function grants(role: { authorize: (request: Record<string, string[]>) => { success: boolean } }, resource: string, action: string) {
  return role.authorize({ [resource]: [action] }).success
}

describe('platform roles', () => {
  const roles = Object.keys(platformRoles) as PlatformRole[]
  it.each(platformMatrix)('%s:%s is granted to exactly %j', (resource, action, allowed) => {
    expect(roles.filter(role => grants(platformRoles[role], resource, action))).toEqual(allowed)
  })

  it('gives customers nothing, and a super admin nothing inside a cafe', () => {
    for (const [resource, action] of platformMatrix) expect(grants(platformRoles.customer, resource, action)).toBe(false)
    // A cafe's data is the cafe's: tenant permissions come only from a membership (D134).
    for (const [resource, action] of tenantMatrix) expect(grants(platformRoles.superadmin, resource, action)).toBe(false)
  })
})

describe('tenant roles', () => {
  const roles = Object.keys(tenantRoles) as TenantRole[]
  it.each(tenantMatrix)('%s:%s is granted to exactly %j', (resource, action, allowed) => {
    expect(roles.filter(role => grants(tenantRoles[role], resource, action))).toEqual(allowed)
  })
})

describe('branch roles', () => {
  const roles = Object.keys(branchRoles) as BranchRole[]
  it.each(branchMatrix)('%s:%s is granted to exactly %j', (resource, action, allowed) => {
    expect(roles.filter(role => grants(branchRoles[role], resource, action))).toEqual(allowed)
  })
})
