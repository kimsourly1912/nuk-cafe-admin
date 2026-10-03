import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '#auth/schema'
import { identityAuthOptions } from '#server/features/identity/identity.auth'
import { seedFirstOwner } from '#server/features/identity/staff.service'
import { seedTenant } from '#server/features/tenants'
import { createTestAuth, sessionHeaders, signIn, TEST_SITE as SITE } from '#server/tests/support/auth'
import type { TestAuth as Auth } from '#server/tests/support/auth'
import { createTestDb } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'

// Our Better Auth configuration against the real migration (server/db/migrations).
let db: Db
let auth: Auth
let accounts = 0

beforeEach(async () => {
  db = await createTestDb()
  auth = createTestAuth(db)
})

/** Signs up a new account and returns its id and the headers of its session. */
async function signUp(body: Record<string, unknown> = {}) {
  const email = `person${++accounts}@example.com`
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'a long enough password', name: 'Person', ...body } as never,
    returnHeaders: true,
  })
  return { userId: response.user.id, headers: sessionHeaders(headers) }
}

async function makeSuperadmin(userId: string) {
  await db.update(authSchema.user).set({ role: 'superadmin' }).where(eq(authSchema.user.id, userId))
}

async function userRow(userId: string) {
  const rows = await db.select().from(authSchema.user).where(eq(authSchema.user.id, userId))
  return rows[0]!
}

describe('accounts', () => {
  it('signs everyone up as a customer who needs no password change', async () => {
    const { userId } = await signUp()
    const row = await userRow(userId)
    expect(row.role).toBe('customer')
    expect(row.mustChangePassword).toBe(false)
  })

  it('ignores a sign-up that tries to set its own flags', async () => {
    // `input: false`: Better Auth drops the field instead of refusing the request.
    const { userId } = await signUp({ mustChangePassword: true })
    expect((await userRow(userId)).mustChangePassword).toBe(false)
  })

  it('never lets a sign-up choose its role', async () => {
    const attempt = signUp({ role: 'admin' }).then(({ userId }) => userRow(userId))
    // Either refused or ignored; never an admin.
    const row = await attempt.catch(() => undefined)
    expect(row?.role ?? 'refused').not.toBe('admin')
  })

  it('lets the server create a staff account that must change its password', async () => {
    const { user } = await auth.api.createUser({
      body: { email: 'new.staff@example.com', password: 'a temporary password', name: 'New Staff', data: { mustChangePassword: true, emailVerified: true } },
    })
    const row = await userRow(user.id)
    expect(row).toMatchObject({ role: 'customer', mustChangePassword: true, emailVerified: true })
  })

  it('keeps sessions for 7 days', async () => {
    const { headers } = await signUp()
    const session = await auth.api.getSession({ headers })
    const days = (session!.session.expiresAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.99)
    expect(days).toBeLessThanOrEqual(7)
  })

  it('trusts only the site origin', () => {
    expect(identityAuthOptions({ db, siteUrl: 'https://cafe.example/some/path' }).trustedOrigins).toEqual([SITE])
    expect(identityAuthOptions({ db }).trustedOrigins).toEqual([])
  })
})

describe('temporary password', () => {
  async function staffOnTemporaryPassword() {
    const tenant = await seedTenant(db, { name: 'NUK Cafe', slug: 'nuk' })
    const created = await seedFirstOwner(db, tenant.id, { name: 'Owner', email: 'owner@example.com' })
    const headers = await signIn(auth, 'owner@example.com', created!.temporaryPassword!)
    return { userId: created!.staff.id, password: created!.temporaryPassword!, headers }
  }

  it('is cleared once its owner changes it', async () => {
    const staff = await staffOnTemporaryPassword()
    await auth.api.changePassword({ body: { currentPassword: staff.password, newPassword: 'a brand new password', revokeOtherSessions: true }, headers: staff.headers })
    expect((await userRow(staff.userId)).mustChangePassword).toBe(false)
  })

  it('stays when the change fails', async () => {
    const staff = await staffOnTemporaryPassword()
    await expect(auth.api.changePassword({ body: { currentPassword: 'wrong password', newPassword: 'a brand new password' }, headers: staff.headers })).rejects.toThrow()
    expect((await userRow(staff.userId)).mustChangePassword).toBe(true)
  })
})

// A tenant (a cafe business) is a Better Auth organization (D134). Our routes manage memberships;
// these check Better Auth's own endpoints can't be used to go around them.
describe('tenants', () => {
  const tenant = { name: 'NUK Cafe', slug: 'nuk' }

  it('only lets super admins create a tenant, and makes the creator its owner', async () => {
    const customer = await signUp()
    await expect(auth.api.createOrganization({ body: tenant, headers: customer.headers })).rejects.toThrow()

    const superadmin = await signUp()
    await makeSuperadmin(superadmin.userId)
    const created = await auth.api.createOrganization({ body: tenant, headers: superadmin.headers })
    expect(created).toMatchObject({ slug: 'nuk', status: 'active' })
    expect(created!.members[0]).toMatchObject({ userId: superadmin.userId, role: 'owner' })
  })

  // Two guards: `disableOrganizationDeletion`, and no tenant role holds `organization:delete`.
  it('never deletes a tenant', async () => {
    const superadmin = await signUp()
    await makeSuperadmin(superadmin.userId)
    const created = await auth.api.createOrganization({ body: tenant, headers: superadmin.headers })
    await expect(auth.api.deleteOrganization({ body: { organizationId: created!.id }, headers: superadmin.headers })).rejects.toThrow()
  })

  it('checks a member\'s tenant role through Better Auth: owners hold the cafe, members nothing, nobody the membership endpoints', async () => {
    const superadmin = await signUp()
    await makeSuperadmin(superadmin.userId)
    const created = await auth.api.createOrganization({ body: tenant, headers: superadmin.headers })
    const staff = await signUp()
    await auth.api.addMember({ body: { organizationId: created!.id, userId: staff.userId, role: 'member' } })

    const can = async (headers: Headers, permissions: Record<string, string[]>) =>
      (await auth.api.hasPermission({ body: { organizationId: created!.id, permissions }, headers })).success
    expect(await can(superadmin.headers, { menu: ['write'], staff: ['create'] })).toBe(true)
    expect(await can(superadmin.headers, { member: ['create'] })).toBe(false)
    expect(await can(staff.headers, { menu: ['read'] })).toBe(false)
    expect(await can(staff.headers, { invitation: ['create'] })).toBe(false)
  })
})

describe('platform permissions', () => {
  it('checks the platform role through Better Auth', async () => {
    const customer = await signUp()
    const superadmin = await signUp()
    await makeSuperadmin(superadmin.userId)
    const can = async (userId: string, permissions: Record<string, string[]>) =>
      (await auth.api.userHasPermission({ body: { userId, permissions } })).success

    expect(await can(superadmin.userId, { tenant: ['create'] })).toBe(true)
    expect(await can(superadmin.userId, { user: ['impersonate'] })).toBe(false)
    expect(await can(customer.userId, { tenant: ['read'] })).toBe(false)
  })
})
