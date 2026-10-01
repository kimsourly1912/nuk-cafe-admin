import { beforeEach, describe, expect, it } from 'vitest'
import { member, organization } from '#server/db/tables'
import { newId } from '#server/utils/ids'
import { adminSession, authorizeBranch, counterSession, authorizeCustomer, authorizePlatform, authorizeSignedIn } from '#server/features/identity/identity.service'
import type { SessionUser } from '#server/features/identity/identity.types'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'

const customer: SessionUser = { id: newId(), emailVerified: true, role: 'customer' }
const admin: SessionUser = { id: newId(), emailVerified: true, role: 'admin' }

describe('signed in', () => {
  it('refuses no session with 401', async () => {
    await expectApiError(() => authorizeSignedIn(null), 401, 'UNAUTHENTICATED')
    await expectApiError(() => authorizeSignedIn(undefined), 401, 'UNAUTHENTICATED')
  })

  it('refuses a banned user with 401', async () => {
    await expectApiError(() => authorizeSignedIn({ ...customer, banned: true }), 401, 'UNAUTHENTICATED')
  })

  it('refuses a temporary password with 403 on every surface', async () => {
    const staff = { ...customer, mustChangePassword: true }
    await expectApiError(() => authorizeSignedIn(staff), 403, 'PASSWORD_CHANGE_REQUIRED')
    await expectApiError(() => authorizeCustomer(staff), 403, 'PASSWORD_CHANGE_REQUIRED')
    await expectApiError(() => authorizePlatform({ ...admin, mustChangePassword: true }, { menu: ['read'] }), 403, 'PASSWORD_CHANGE_REQUIRED')
  })

  it('treats a missing or unknown role as customer', async () => {
    expect(authorizeSignedIn({ ...customer, role: null }).role).toBe('customer')
    expect(authorizeSignedIn({ ...customer, role: 'owner' }).role).toBe('customer')
    expect(authorizeSignedIn({ ...customer, role: 'customer,admin' }).role).toBe('admin')
  })
})

describe('shop', () => {
  it('needs a verified email', async () => {
    await expectApiError(() => authorizeCustomer({ ...customer, emailVerified: false }), 403, 'EMAIL_NOT_VERIFIED')
    expect(authorizeCustomer(customer)).toEqual({ userId: customer.id, role: 'customer' })
  })
})

describe('admin surface', () => {
  it('grants what the platform role grants', async () => {
    expect(authorizePlatform(admin, { menu: ['write'], staff: ['create'] })).toEqual({ userId: admin.id, role: 'admin' })
  })

  it('refuses customers with 403', async () => {
    await expectApiError(() => authorizePlatform(customer, { menu: ['read'] }), 403, 'FORBIDDEN')
  })

  it('refuses an action no role holds, and a request with any action not granted', async () => {
    await expectApiError(() => authorizePlatform(admin, { user: ['impersonate'] }), 403, 'FORBIDDEN')
    await expectApiError(() => authorizePlatform(admin, { menu: ['write'], user: ['impersonate'] }), 403, 'FORBIDDEN')
  })

  it('refuses no session with 401 before looking at permissions', async () => {
    await expectApiError(() => authorizePlatform(null, { menu: ['read'] }), 401, 'UNAUTHENTICATED')
  })
})

describe('counter surface', () => {
  let db: Db
  let branchId: string
  let otherBranchId: string

  async function addBranch(status = 'active') {
    const id = newId()
    await db.insert(organization).values({ id, name: `Branch ${id}`, slug: id, timezone: 'Asia/Phnom_Penh', status, createdAt: new Date() })
    return id
  }

  async function signedInMember(role: string | null, inBranch = branchId): Promise<SessionUser> {
    const row = await createUser(db)
    if (role) await db.insert(member).values({ id: newId(), organizationId: inBranch, userId: row.id, role, createdAt: new Date() })
    return { id: row.id, emailVerified: true, role: 'customer' }
  }

  beforeEach(async () => {
    db = await createTestDb()
    branchId = await addBranch()
    otherBranchId = await addBranch()
  })

  it('grants a member what their branch role grants, and says who acts', async () => {
    const staff = await signedInMember('staff')
    await expect(authorizeBranch(db, staff, branchId, { order: ['cancel'], payment: ['collect'] }))
      .resolves.toEqual({ userId: staff.id, role: 'customer', branchId, branchRole: 'staff' })
    const manager = await signedInMember('manager')
    await expect(authorizeBranch(db, manager, branchId, { voucher: ['issue'] })).resolves.toMatchObject({ branchRole: 'manager' })
  })

  it('refuses a member without the permission with 403', async () => {
    const staff = await signedInMember('staff')
    await expectApiError(() => authorizeBranch(db, staff, branchId, { voucher: ['issue'] }), 403, 'FORBIDDEN')
    const manager = await signedInMember('manager')
    await expectApiError(() => authorizeBranch(db, manager, branchId, { payment: ['refund'] }), 403, 'FORBIDDEN')
  })

  it('answers 404 for another branch, as for one that doesn\'t exist', async () => {
    const staff = await signedInMember('staff', otherBranchId)
    await expectApiError(() => authorizeBranch(db, staff, branchId, { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(() => authorizeBranch(db, staff, newId(), { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('answers 404 for a signed-in customer with no membership', async () => {
    const nobody = await signedInMember(null)
    await expectApiError(() => authorizeBranch(db, nobody, branchId, { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('answers 404 for a membership role we don\'t know', async () => {
    const owner = await signedInMember('owner')
    await expectApiError(() => authorizeBranch(db, owner, branchId, { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('answers 404 for an archived branch, even to its members and admins', async () => {
    const archived = await addBranch('archived')
    const staff = await signedInMember('staff', archived)
    await expectApiError(() => authorizeBranch(db, staff, archived, { order: ['read'] }), 404, 'NOT_FOUND')
    await expectApiError(() => authorizeBranch(db, admin, archived, { order: ['read'] }), 404, 'NOT_FOUND')
  })

  it('lets a platform admin act in any branch without being a member', async () => {
    await expect(authorizeBranch(db, admin, branchId, { payment: ['refund'], voucher: ['issue'] }))
      .resolves.toEqual({ userId: admin.id, role: 'admin', branchId })
  })

  it('checks the session before the branch', async () => {
    await expectApiError(() => authorizeBranch(db, null, newId(), { order: ['read'] }), 401, 'UNAUTHENTICATED')
    const staff = { ...(await signedInMember('staff')), mustChangePassword: true }
    await expectApiError(() => authorizeBranch(db, staff, branchId, { order: ['read'] }), 403, 'PASSWORD_CHANGE_REQUIRED')
  })

  describe('the counter app\'s session (D102)', () => {
    it('lists the active branches a member works at, with the role; not archived ones or unknown roles', async () => {
      const archived = await addBranch('archived')
      const staff = await signedInMember('staff')
      await db.insert(member).values({ id: newId(), organizationId: otherBranchId, userId: staff.id, role: 'manager', createdAt: new Date() })
      await db.insert(member).values({ id: newId(), organizationId: archived, userId: staff.id, role: 'staff', createdAt: new Date() })
      const session = await counterSession(db, staff)
      expect(session.branches.map(b => [b.id, b.role]).sort()).toEqual([[branchId, 'staff'], [otherBranchId, 'manager']].sort())
    })

    it('gives a platform admin every active branch (their own role where they are a member)', async () => {
      const session = await counterSession(db, admin)
      expect(session.branches.map(b => b.role)).toEqual(['admin', 'admin'])
    })

    it('answers on a temporary password; refuses no session (401) and a customer with no branch (403 NOT_STAFF)', async () => {
      const staff = { ...(await signedInMember('staff')), mustChangePassword: true }
      expect((await counterSession(db, staff)).mustChangePassword).toBe(true)
      await expectApiError(() => counterSession(db, null), 401, 'UNAUTHENTICATED')
      const customerOnly = await signedInMember(null)
      const unknownRole = await signedInMember('owner')
      await expectApiError(() => counterSession(db, customerOnly), 403, 'NOT_STAFF')
      await expectApiError(() => counterSession(db, unknownRole), 403, 'NOT_STAFF')
    })
  })
})

describe('admin app session', () => {
  const owner: SessionUser = { ...admin, email: 'owner@example.com', name: 'Owner' }

  it('describes an admin, with what they may do', () => {
    const session = adminSession(owner)
    expect(session).toMatchObject({ userId: owner.id, email: 'owner@example.com', name: 'Owner', role: 'admin', mustChangePassword: false })
    expect(session.permissions).toEqual(expect.arrayContaining(['menu:write', 'staff:create', 'branch:read']))
    expect(session.permissions).not.toContain('user:impersonate')
  })

  it('answers an admin on a temporary password, so the app can ask for a new one', () => {
    expect(adminSession({ ...owner, mustChangePassword: true })).toMatchObject({ mustChangePassword: true })
  })

  it('refuses everyone else: 401 without a session, 403 NOT_ADMIN for customers and branch staff', async () => {
    await expectApiError(() => adminSession(null), 401, 'UNAUTHENTICATED')
    await expectApiError(() => adminSession({ ...owner, banned: true }), 401, 'UNAUTHENTICATED')
    await expectApiError(() => adminSession(customer), 403, 'NOT_ADMIN')
  })
})
