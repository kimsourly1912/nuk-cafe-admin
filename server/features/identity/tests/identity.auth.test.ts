import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '#auth/schema'
import { identityAuthOptions } from '../identity.auth'
import { seedFirstAdmin } from '../staff.service'
import { createTestAuth, sessionHeaders, signIn, TEST_SITE as SITE } from '../../../tests/support/auth'
import type { TestAuth as Auth } from '../../../tests/support/auth'
import { createTestDb } from '../../../tests/support/db'
import type { Db } from '../../../utils/batch'

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

async function makeAdmin(userId: string) {
  await db.update(authSchema.user).set({ role: 'admin' }).where(eq(authSchema.user.id, userId))
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
    expect(identityAuthOptions({ siteUrl: 'https://cafe.example/some/path' }).trustedOrigins).toEqual([SITE])
    expect(identityAuthOptions({}).trustedOrigins).toEqual([])
  })
})

describe('temporary password', () => {
  async function staffOnTemporaryPassword() {
    const created = await seedFirstAdmin(db, { name: 'Owner', email: 'owner@example.com' })
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

describe('branches', () => {
  const branch = { name: 'Riverside', slug: 'riverside', timezone: 'Asia/Phnom_Penh' }

  it('only lets platform admins create branches', async () => {
    const customer = await signUp()
    await expect(auth.api.createOrganization({ body: branch, headers: customer.headers })).rejects.toThrow()

    const admin = await signUp()
    await makeAdmin(admin.userId)
    const created = await auth.api.createOrganization({ body: branch, headers: admin.headers })
    expect(created).toMatchObject({ slug: 'riverside', timezone: 'Asia/Phnom_Penh', currency: 'USD', status: 'active' })
    // Better Auth makes the creator a member, with one of our roles.
    expect(created!.members[0]).toMatchObject({ userId: admin.userId, role: 'manager' })
  })

  // Two guards: `disableOrganizationDeletion`, and no branch role holds `organization:delete`.
  it('never deletes a branch', async () => {
    const admin = await signUp()
    await makeAdmin(admin.userId)
    const created = await auth.api.createOrganization({ body: branch, headers: admin.headers })
    await expect(auth.api.deleteOrganization({ body: { organizationId: created!.id }, headers: admin.headers })).rejects.toThrow()
  })

  it('checks a member\'s branch role through Better Auth', async () => {
    const admin = await signUp()
    await makeAdmin(admin.userId)
    const created = await auth.api.createOrganization({ body: branch, headers: admin.headers })
    const staff = await signUp()
    await auth.api.addMember({ body: { organizationId: created!.id, userId: staff.userId, role: 'staff' } })

    const can = async (permissions: Record<string, string[]>) => {
      const result = await auth.api.hasPermission({ body: { organizationId: created!.id, permissions }, headers: staff.headers })
      return result.success
    }
    expect(await can({ order: ['cancel'] })).toBe(true)
    expect(await can({ payment: ['collect'] })).toBe(true)
    expect(await can({ payment: ['refund'] })).toBe(false)
    expect(await can({ voucher: ['issue'] })).toBe(false)
    expect(await can({ member: ['create'] })).toBe(false)
  })
})

describe('platform permissions', () => {
  it('checks the platform role through Better Auth', async () => {
    const customer = await signUp()
    const admin = await signUp()
    await makeAdmin(admin.userId)
    const can = async (userId: string, permissions: Record<string, string[]>) =>
      (await auth.api.userHasPermission({ body: { userId, permissions } })).success

    expect(await can(admin.userId, { menu: ['write'] })).toBe(true)
    expect(await can(admin.userId, { user: ['impersonate'] })).toBe(false)
    expect(await can(customer.userId, { menu: ['read'] })).toBe(false)
  })
})
