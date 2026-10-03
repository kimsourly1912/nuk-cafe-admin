import { beforeEach, describe, expect, it } from 'vitest'
import { branches, member, organization } from '#server/db/tables'
import { eq } from 'drizzle-orm'
import { newId } from '#server/utils/ids'
import { adminSession, authorizeBranch, authorizeCustomer, authorizePlatform, authorizeSignedIn, authorizeTenant, counterSession, currentTenant, platformSession, tenantBySlug, workspacesOf } from '#server/features/identity/identity.service'
import type { SessionUser } from '#server/features/identity/identity.types'
import { addBranchStaff, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'

// Access decisions with tenants (D134): a membership in one tenant gives nothing in another, and
// another tenant's branches don't exist from here.

const OTHER = 'tenant-2'
let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT)
  await ensureTenant(db, OTHER)
})

async function person(tenantRole: 'owner' | 'member' | null = null, tenantId = TEST_TENANT): Promise<SessionUser> {
  const row = await createUser(db)
  if (tenantRole) await db.insert(member).values({ id: newId(), organizationId: tenantId, userId: row.id, role: tenantRole, createdAt: new Date() })
  return { id: row.id, emailVerified: true, role: 'customer', email: row.email, name: 'Test User' }
}

async function addBranch(status = 'active', tenantId = TEST_TENANT) {
  const id = newId()
  await insertBranch(db, { id, name: `Branch ${id}`, timezone: 'Asia/Phnom_Penh', status, tenantId })
  return id
}

async function staffAt(branchId: string, role: string, tenantId = TEST_TENANT): Promise<SessionUser> {
  const user = await person()
  await addBranchStaff(db, branchId, user.id, role, tenantId)
  return user
}

describe('the tenant a request acts in (D140)', () => {
  it('is the one its address names; an unknown address is 404, a paused cafe 403', async () => {
    expect(await tenantBySlug(db, OTHER)).toEqual({ id: OTHER, slug: OTHER, name: `Cafe ${OTHER}` })
    expect((await tenantBySlug(db, TEST_TENANT)).id).toBe(TEST_TENANT)
    await expectApiError(() => tenantBySlug(db, 'nowhere'), 404, 'NOT_FOUND')
    await expectApiError(() => tenantBySlug(db, ''), 404, 'NOT_FOUND')
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, OTHER))
    await expectApiError(() => tenantBySlug(db, OTHER), 403, 'TENANT_SUSPENDED')
    expect((await tenantBySlug(db, TEST_TENANT)).id).toBe(TEST_TENANT)
  })
})

describe('the platform\'s first tenant (work without an address)', () => {
  it('is the oldest tenant; none, or a suspended one, is 404', async () => {
    expect((await currentTenant(db)).id).toBe(TEST_TENANT)
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, TEST_TENANT))
    await expectApiError(async () => currentTenant(db), 404, 'NOT_FOUND')
    await expectApiError(async () => currentTenant(await createTestDb()), 404, 'NOT_FOUND')
  })
})

describe('signed in', () => {
  it('refuses no session or a banned user with 401, a temporary password with 403 on every surface', async () => {
    const customer = await person()
    await expectApiError(async () => authorizeSignedIn(db, null, TEST_TENANT), 401, 'UNAUTHENTICATED')
    await expectApiError(async () => authorizeSignedIn(db, { ...customer, banned: true }, TEST_TENANT), 401, 'UNAUTHENTICATED')
    const temporary = { ...customer, mustChangePassword: true }
    await expectApiError(async () => authorizeSignedIn(db, temporary, TEST_TENANT), 403, 'PASSWORD_CHANGE_REQUIRED')
    await expectApiError(async () => authorizeCustomer(db, temporary, TEST_TENANT), 403, 'PASSWORD_CHANGE_REQUIRED')
    await expectApiError(async () => authorizeTenant(db, { ...(await person('owner')), mustChangePassword: true }, TEST_TENANT, { menu: ['read'] }), 403, 'PASSWORD_CHANGE_REQUIRED')
    await expectApiError(async () => authorizePlatform({ ...customer, role: 'superadmin', mustChangePassword: true }, { tenant: ['read'] }), 403, 'PASSWORD_CHANGE_REQUIRED')
  })

  it('acts in the tenant with their role there, or as a customer', async () => {
    const owner = await person('owner')
    expect(await authorizeSignedIn(db, owner, TEST_TENANT)).toEqual({ userId: owner.id, tenantId: TEST_TENANT, role: 'owner' })
    // Owning another cafe changes nothing here; nor does a platform role.
    expect((await authorizeSignedIn(db, owner, OTHER)).role).toBe('customer')
    expect((await authorizeSignedIn(db, { ...owner, role: 'superadmin' }, OTHER)).role).toBe('customer')
  })
})

describe('shop', () => {
  it('needs a verified email', async () => {
    const customer = await person()
    await expectApiError(async () => authorizeCustomer(db, { ...customer, emailVerified: false }, TEST_TENANT), 403, 'EMAIL_NOT_VERIFIED')
    expect(await authorizeCustomer(db, customer, TEST_TENANT)).toEqual({ userId: customer.id, tenantId: TEST_TENANT, role: 'customer' })
  })
})

describe('admin surface', () => {
  it('grants an owner what the owner role grants, in their own tenant only', async () => {
    const owner = await person('owner')
    expect(await authorizeTenant(db, owner, TEST_TENANT, { menu: ['write'], staff: ['create'] })).toEqual({ userId: owner.id, tenantId: TEST_TENANT, role: 'owner' })
    await expectApiError(async () => authorizeTenant(db, owner, OTHER, { menu: ['read'] }), 403, 'FORBIDDEN')
  })

  it('refuses members, customers and super admins with 403, and an action no role holds', async () => {
    await expectApiError(async () => authorizeTenant(db, await person('member'), TEST_TENANT, { menu: ['read'] }), 403, 'FORBIDDEN')
    await expectApiError(async () => authorizeTenant(db, await person(), TEST_TENANT, { menu: ['read'] }), 403, 'FORBIDDEN')
    await expectApiError(async () => authorizeTenant(db, { ...(await person()), role: 'superadmin' }, TEST_TENANT, { menu: ['read'] }), 403, 'FORBIDDEN')
    const owner = await person('owner')
    await expectApiError(async () => authorizeTenant(db, owner, TEST_TENANT, { menu: ['write'], member: ['create'] }), 403, 'FORBIDDEN')
  })

  it('refuses no session with 401 before looking at permissions', async () => {
    await expectApiError(async () => authorizeTenant(db, null, TEST_TENANT, { menu: ['read'] }), 401, 'UNAUTHENTICATED')
  })
})

describe('platform surface (T2)', () => {
  it('grants a super admin the platform\'s actions; refuses everyone else', async () => {
    const superadmin = { ...(await person()), role: 'superadmin' }
    expect(authorizePlatform(superadmin, { tenant: ['create'] })).toEqual({ userId: superadmin.id })
    await expectApiError(async () => authorizePlatform(await person('owner'), { tenant: ['read'] }), 403, 'FORBIDDEN')
    await expectApiError(async () => authorizePlatform(null, { tenant: ['read'] }), 401, 'UNAUTHENTICATED')
  })

  it('the console\'s session check: a super admin, also on a temporary password; nobody else (D142)', async () => {
    const superadmin = { ...(await person()), role: 'superadmin' }
    expect(platformSession(superadmin)).toEqual({ userId: superadmin.id, email: superadmin.email, name: 'Test User', mustChangePassword: false })
    expect(platformSession({ ...superadmin, mustChangePassword: true }).mustChangePassword).toBe(true)
    // An owner of a cafe is not on the platform team.
    await expectApiError(async () => platformSession(await person('owner')), 403, 'NOT_PLATFORM_ADMIN')
    await expectApiError(async () => platformSession({ ...superadmin, banned: true }), 401, 'UNAUTHENTICATED')
    await expectApiError(async () => platformSession(null), 401, 'UNAUTHENTICATED')
  })
})

describe('counter surface', () => {
  let branchId: string
  let otherBranchId: string

  beforeEach(async () => {
    branchId = await addBranch()
    otherBranchId = await addBranch()
  })

  it('grants staff what their branch role grants, and says who acts', async () => {
    const staff = await staffAt(branchId, 'staff')
    await expect(authorizeBranch(db, staff, TEST_TENANT, branchId, { order: ['cancel'], payment: ['collect'] }))
      .resolves.toEqual({ userId: staff.id, tenantId: TEST_TENANT, role: 'member', branchId, branchRole: 'staff' })
    const manager = await staffAt(branchId, 'manager')
    await expect(authorizeBranch(db, manager, TEST_TENANT, branchId, { voucher: ['issue'] })).resolves.toMatchObject({ branchRole: 'manager' })
  })

  it('refuses staff without the permission with 403', async () => {
    await expectApiError(async () => authorizeBranch(db, await staffAt(branchId, 'staff'), TEST_TENANT, branchId, { voucher: ['issue'] }), 403, 'FORBIDDEN')
    await expectApiError(async () => authorizeBranch(db, await staffAt(branchId, 'manager'), TEST_TENANT, branchId, { payment: ['refund'] }), 403, 'FORBIDDEN')
  })

  it('answers 404 for another branch, an unknown one, and one the caller doesn\'t work at', async () => {
    const staff = await staffAt(otherBranchId, 'staff')
    await expectApiError(async () => authorizeBranch(db, staff, TEST_TENANT, branchId, { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(async () => authorizeBranch(db, staff, TEST_TENANT, newId(), { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(async () => authorizeBranch(db, await person(), TEST_TENANT, branchId, { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('answers 404 for another tenant\'s branch, even to its own staff and owners (D134)', async () => {
    const theirs = await addBranch('active', OTHER)
    const theirStaff = await staffAt(theirs, 'manager', OTHER)
    const theirOwner = await person('owner', OTHER)
    // From this tenant, their branch doesn't exist…
    await expectApiError(async () => authorizeBranch(db, theirStaff, TEST_TENANT, theirs, { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(async () => authorizeBranch(db, theirOwner, TEST_TENANT, theirs, { order: ['read'] }), 404, 'NOT_FOUND')
    // …and an owner here holds nothing there.
    await expectApiError(async () => authorizeBranch(db, await person('owner'), OTHER, theirs, { order: ['read'] }), 404, 'NOT_FOUND')
    await expect(authorizeBranch(db, theirStaff, OTHER, theirs, { order: ['read'] })).resolves.toMatchObject({ tenantId: OTHER, branchRole: 'manager' })
  })

  it('answers 404 for an archived branch, even to its staff and owners', async () => {
    const archived = await addBranch('archived')
    await expectApiError(async () => authorizeBranch(db, await staffAt(archived, 'staff'), TEST_TENANT, archived, { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(async () => authorizeBranch(db, await person('owner'), TEST_TENANT, archived, { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('lets an owner act in any branch of the tenant without being on its staff', async () => {
    const owner = await person('owner')
    await expect(authorizeBranch(db, owner, TEST_TENANT, branchId, { payment: ['refund'], voucher: ['issue'] }))
      .resolves.toEqual({ userId: owner.id, tenantId: TEST_TENANT, role: 'owner', branchId })
  })

  it('checks the session before the branch', async () => {
    await expectApiError(async () => authorizeBranch(db, null, TEST_TENANT, newId(), { order: ['read'] }), 401, 'UNAUTHENTICATED')
    const staff = { ...(await staffAt(branchId, 'staff')), mustChangePassword: true }
    await expectApiError(async () => authorizeBranch(db, staff, TEST_TENANT, branchId, { order: ['read'] }), 403, 'PASSWORD_CHANGE_REQUIRED')
  })

  describe('the counter app\'s session (D102)', () => {
    it('lists the tenant\'s active branches a person works at, with the role; not archived ones nor another tenant\'s', async () => {
      const archived = await addBranch('archived')
      const theirs = await addBranch('active', OTHER)
      const staff = await staffAt(branchId, 'staff')
      await addBranchStaff(db, otherBranchId, staff.id, 'manager')
      await addBranchStaff(db, archived, staff.id, 'staff')
      await addBranchStaff(db, theirs, staff.id, 'manager', OTHER)
      const session = await counterSession(db, staff, TEST_TENANT)
      expect(session.branches.map(b => [b.id, b.role]).sort()).toEqual([[branchId, 'staff'], [otherBranchId, 'manager']].sort())
      expect((await counterSession(db, staff, OTHER)).branches.map(b => b.id)).toEqual([theirs])
    })

    it('gives an owner every active branch of the tenant', async () => {
      await addBranch('active', OTHER)
      const session = await counterSession(db, await person('owner'), TEST_TENANT)
      expect(session.branches.map(b => b.role)).toEqual(['admin', 'admin'])
    })

    it('answers on a temporary password; refuses no session (401) and someone with no branch here (403 NOT_STAFF)', async () => {
      const staff = { ...(await staffAt(branchId, 'staff')), mustChangePassword: true }
      expect((await counterSession(db, staff, TEST_TENANT)).mustChangePassword).toBe(true)
      await expectApiError(async () => counterSession(db, null, TEST_TENANT), 401, 'UNAUTHENTICATED')
      await expectApiError(async () => counterSession(db, await person(), TEST_TENANT), 403, 'NOT_STAFF')
      await expectApiError(async () => counterSession(db, await person('member'), TEST_TENANT), 403, 'NOT_STAFF')
      await expectApiError(async () => counterSession(db, await person('owner', OTHER), TEST_TENANT), 403, 'NOT_STAFF')
    })
  })

  describe('the workspaces in the account menu (D124)', () => {
    it('offers an owner both, branch staff the counter, and a customer neither, in this tenant', async () => {
      expect(await workspacesOf(db, await person('owner'), TEST_TENANT)).toEqual(['admin', 'counter'])
      expect(await workspacesOf(db, await staffAt(branchId, 'manager'), TEST_TENANT)).toEqual(['counter'])
      expect(await workspacesOf(db, await person(), TEST_TENANT)).toEqual([])
      expect(await workspacesOf(db, await person('owner', OTHER), TEST_TENANT)).toEqual([])
    })

    it('doesn\'t offer the counter for an archived branch', async () => {
      const archived = await addBranch('archived')
      expect(await workspacesOf(db, await staffAt(archived, 'staff'), TEST_TENANT)).toEqual([])
    })
  })
})

describe('admin app session', () => {
  it('describes an owner, with what they may do', async () => {
    const owner = await person('owner')
    const session = await adminSession(db, owner, TEST_TENANT)
    expect(session).toMatchObject({ userId: owner.id, email: owner.email, role: 'admin', mustChangePassword: false })
    expect(session.permissions).toEqual(expect.arrayContaining(['menu:write', 'staff:create', 'branch:read']))
    expect(session.permissions).not.toContain('member:create')
  })

  it('answers an owner on a temporary password, so the app can ask for a new one', async () => {
    expect(await adminSession(db, { ...(await person('owner')), mustChangePassword: true }, TEST_TENANT)).toMatchObject({ mustChangePassword: true })
  })

  it('refuses everyone else: 401 without a session, 403 NOT_ADMIN for customers, branch staff and other tenants\' owners', async () => {
    await expectApiError(async () => adminSession(db, null, TEST_TENANT), 401, 'UNAUTHENTICATED')
    await expectApiError(async () => adminSession(db, { ...(await person('owner')), banned: true }, TEST_TENANT), 401, 'UNAUTHENTICATED')
    await expectApiError(async () => adminSession(db, await person(), TEST_TENANT), 403, 'NOT_ADMIN')
    await expectApiError(async () => adminSession(db, await person('member'), TEST_TENANT), 403, 'NOT_ADMIN')
    await expectApiError(async () => adminSession(db, await person('owner', OTHER), TEST_TENANT), 403, 'NOT_ADMIN')
    await expectApiError(async () => adminSession(db, { ...(await person()), role: 'superadmin' }, TEST_TENANT), 403, 'NOT_ADMIN')
  })
})

// The branches table keeps a branch inside its tenant (D134): the composite key refuses staff,
// hours or tables pointing at another tenant's branch.
describe('the database keeps branches in their tenant', () => {
  it('refuses a staff row naming another tenant for a branch', async () => {
    const branchId = await addBranch()
    const user = await person()
    await expect(addBranchStaff(db, branchId, user.id, 'staff', OTHER)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/FOREIGN KEY/) } })
    expect(await db.select().from(branches).where(eq(branches.id, branchId))).toHaveLength(1)
  })
})
