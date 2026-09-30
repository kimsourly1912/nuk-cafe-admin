import { describe, expect, it } from 'vitest'
import { branchRoles, platformRoles } from '#server/features/identity/identity.permissions'
import type { BranchRole, PlatformRole } from '#server/features/identity/identity.permissions'

// The role matrix of docs/server/security.md (D45), one row per grant. A change to a role must
// change this table too.
type Row = [resource: string, action: string, allowed: readonly string[]]

const platformMatrix: Row[] = [
  ['menu', 'read', ['admin']],
  ['menu', 'write', ['admin']],
  ['menu', 'publish', ['admin']],
  ['media', 'upload', ['admin']],
  ['branch', 'create', ['admin']],
  ['branch', 'update', ['admin']],
  ['staff', 'read', ['admin']],
  ['staff', 'create', ['admin']],
  ['staff', 'update', ['admin']],
  ['staff', 'disable', ['admin']],
  ['staff', 'reset-password', ['admin']],
  ['voucherTemplate', 'manage', ['admin']],
  ['loyalty', 'adjust', ['admin']],
  ['settings', 'manage', ['admin']],
  ['assistant', 'use', ['admin']],
  ['report', 'read', ['admin']],
  ['report', 'export', ['admin']],
  ['audit', 'read', ['admin']],
  // Better Auth's admin endpoints.
  ['user', 'create', ['admin']],
  ['user', 'set-role', ['admin']],
  ['user', 'ban', ['admin']],
  ['session', 'revoke', ['admin']],
  ['user', 'impersonate', []],
  ['user', 'impersonate-admins', []],
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
  // Better Auth's organization endpoints: staff management is admin-only (D45).
  ['organization', 'update', []],
  ['organization', 'delete', []],
  ['member', 'create', []],
  ['member', 'update', []],
  ['member', 'delete', []],
  ['invitation', 'create', []],
  ['ac', 'create', []],
]

function grants(role: { authorize: (request: Record<string, string[]>) => { success: boolean } }, resource: string, action: string) {
  return role.authorize({ [resource]: [action] }).success
}

describe('platform roles', () => {
  const roles = Object.keys(platformRoles) as PlatformRole[]
  it.each(platformMatrix)('%s:%s is granted to exactly %j', (resource, action, allowed) => {
    const granted = roles.filter(role => grants(platformRoles[role], resource, action))
    expect(granted).toEqual(allowed)
  })

  it('gives customers nothing', () => {
    for (const [resource, action] of platformMatrix) expect(grants(platformRoles.customer, resource, action)).toBe(false)
  })
})

describe('branch roles', () => {
  const roles = Object.keys(branchRoles) as BranchRole[]
  it.each(branchMatrix)('%s:%s is granted to exactly %j', (resource, action, allowed) => {
    const granted = roles.filter(role => grants(branchRoles[role], resource, action))
    expect(granted).toEqual(allowed)
  })
})
