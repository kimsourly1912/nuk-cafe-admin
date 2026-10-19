import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { accountListQuerySchema } from '#shared/contracts/accounts'
import * as v from 'valibot'
import type { Db } from '#server/utils/batch'
import { auditEvents, member, session, user } from '#server/db/tables'
import { addBranchStaff, createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { createTestAuth, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import { banAccount, getPlatformAccount, listPlatformAccounts, setTemporaryPassword, signOutAccount, unbanAccount } from '#server/features/identity'
import { authorizeCustomer, authorizePlatform, authorizeTenant } from '#server/features/identity/identity.service'
import type { SessionUser } from '#server/features/identity/identity.types'

// The platform console's Accounts (step P1, D187): against SQLite built from the migrations, with
// Better Auth on the same database where signing in matters.

let db: Db
let auth: TestAuth
const SUPER = 'superadmin-1'
const actor = { userId: SUPER, requestId: 'req-1' }
const PASSWORD = 'the customer password'
const OTHER_TENANT = 'tenant-2'

const query = (overrides: Record<string, string> = {}) => v.parse(accountListQuerySchema, overrides)

async function signUp(email: string, name = 'Customer') {
  const { user: created } = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } })
  return created.id
}

const versionOf = async (userId: string) => (await getPlatformAccount(db, userId)).version
const sessionsOf = async (userId: string) => db.select().from(session).where(eq(session.userId, userId))
const sessionUser = async (headers: Headers) => (await auth.api.getSession({ headers }))?.user as SessionUser | undefined

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await ensureTenant(db, OTHER_TENANT, 'brown-bean')
  auth = createTestAuth(db)
  await db.insert(user).values({ id: SUPER, email: 'super@example.com', name: 'Super', role: 'superadmin' })
})

describe('the account list', () => {
  it('lists registered accounts newest first, never guests, with their cafes counted', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: OTHER_TENANT, userId: owner.userId, role: 'owner', createdAt: new Date() })
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    const staff = await createUser(db, 'staff@example.com', 'Staff')
    await addBranchStaff(db, 'branch-1', staff.id, 'staff')
    await db.insert(user).values({ id: 'guest-1', email: 'guest@anon.example', name: 'Guest', isAnonymous: true })

    const page = await listPlatformAccounts(db, query())
    expect(page.items.map(a => a.email)).not.toContain('guest@anon.example')
    expect(page.total).toBe(3)
    expect(page.items.find(a => a.id === owner.userId)).toMatchObject({ ownerOf: 2, staffOf: 0, isSuperadmin: false, ban: null })
    expect(page.items.find(a => a.id === staff.id)).toMatchObject({ ownerOf: 0, staffOf: 1 })
    expect(page.items.find(a => a.id === SUPER)).toMatchObject({ isSuperadmin: true })
  })

  it('filters by kind and searches names and emails', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    const staff = await createUser(db, 'staff@example.com', 'Sokha')
    await addBranchStaff(db, 'branch-1', staff.id, 'manager')
    const customer = await createUser(db, 'dara@example.com', 'Dara')
    const banned = await createUser(db, 'gone@example.com', 'Gone')
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.id))

    const ids = async (overrides: Record<string, string>) => (await listPlatformAccounts(db, query(overrides))).items.map(a => a.id).sort()
    expect(await ids({ kind: 'owner' })).toEqual([owner.userId])
    expect(await ids({ kind: 'staff' })).toEqual([staff.id])
    expect(await ids({ kind: 'customer' })).toEqual([banned.id, customer.id].sort())
    expect(await ids({ kind: 'superadmin' })).toEqual([SUPER])
    expect(await ids({ kind: 'banned' })).toEqual([banned.id])
    expect(await ids({ search: 'SOKH' })).toEqual([staff.id])
    expect(await ids({ search: 'dara@' })).toEqual([customer.id])
  })

  it('pages', async () => {
    for (let i = 0; i < 3; i++) await createUser(db, `p${i}@example.com`)
    const page = await listPlatformAccounts(db, query({ page: '2', pageSize: '3' }))
    expect(page).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 })
    expect(page.items).toHaveLength(1)
  })
})

describe('an account', () => {
  it('shows the cafes it works in, never a customer profile, and its open sessions', async () => {
    const userId = await signUp('dara@example.com', 'Dara')
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: OTHER_TENANT, userId, role: 'owner', createdAt: new Date() })
    await signIn(auth, 'dara@example.com', PASSWORD)

    const account = await getPlatformAccount(db, userId)
    // Signing up made a customer profile in a cafe: that is the cafe's data, not listed.
    expect(account.cafes).toEqual([{ id: OTHER_TENANT, name: `Cafe ${OTHER_TENANT}`, slug: 'brown-bean', role: 'owner', onlyActiveOwner: true }])
    expect(account.activeSessions).toBeGreaterThanOrEqual(1)
    expect(account.lastActiveAt).not.toBeNull()
  })

  it('is 404 for a guest and an unknown id', async () => {
    await db.insert(user).values({ id: 'guest-1', email: 'guest@anon.example', name: 'Guest', isAnonymous: true })
    await expectApiError(async () => getPlatformAccount(db, 'guest-1'), 404, 'NOT_FOUND')
    await expectApiError(async () => getPlatformAccount(db, 'nobody'), 404, 'NOT_FOUND')
  })

  it('says when it is a cafe\'s only owner who can sign in', async () => {
    const first = await createAdmin(db, 'first@example.com')
    expect((await getPlatformAccount(db, first.userId)).cafes[0]!.onlyActiveOwner).toBe(true)
    const second = await createAdmin(db, 'second@example.com')
    expect((await getPlatformAccount(db, first.userId)).cafes[0]!.onlyActiveOwner).toBe(false)
    await db.update(user).set({ banned: true }).where(eq(user.id, second.userId))
    expect((await getPlatformAccount(db, first.userId)).cafes[0]!.onlyActiveOwner).toBe(true)
  })
})

describe('banning', () => {
  it('blocks signing in everywhere, ends every session and audits who and why', async () => {
    const userId = await signUp('dara@example.com')
    const headers = await signIn(auth, 'dara@example.com', PASSWORD)

    const banned = await banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'Fraudulent orders' })
    expect(banned.ban).toEqual({ reason: 'Fraudulent orders', until: null })
    expect(banned.activeSessions).toBe(0)
    expect(await sessionsOf(userId)).toEqual([])
    expect(await sessionUser(headers)).toBeUndefined()
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).rejects.toThrow()

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'platform.account.ban'))
    expect(row).toMatchObject({ actorId: SUPER, tenantId: null, targetType: 'user', targetId: userId, requestId: 'req-1', metadata: { reason: 'Fraudulent orders', until: null } })
  })

  it('refuses the banned account in every workspace even with a session left over', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    await banAccount(db, actor, owner.userId, { version: await versionOf(owner.userId), reason: 'Abuse' })
    const [row] = await db.select().from(user).where(eq(user.id, owner.userId))
    const leftover = row as unknown as SessionUser
    await expectApiError(async () => authorizeTenant(db, leftover, TEST_TENANT, { menu: ['read'] }), 401, 'UNAUTHENTICATED')
    await expectApiError(async () => authorizeCustomer(db, leftover, TEST_TENANT), 401, 'UNAUTHENTICATED')
  })

  it('ends by itself: Better Auth lifts an expired ban at the next sign-in', async () => {
    const userId = await signUp('dara@example.com')
    const now = new Date()
    const until = new Date(now.getTime() + 60_000)
    const banned = await banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'Cool off', until: until.toISOString() }, now)
    expect(banned.ban).toEqual({ reason: 'Cool off', until: until.toISOString() })
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).rejects.toThrow()

    await db.update(user).set({ banExpires: new Date(Date.now() - 1000) }).where(eq(user.id, userId))
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).resolves.toBeDefined()
    expect((await getPlatformAccount(db, userId)).ban).toBeNull()
  })

  it('keeps a cafe whose only owner is banned running, flagged without an active owner', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    const account = await banAccount(db, actor, owner.userId, { version: await versionOf(owner.userId), reason: 'Abuse' })
    expect(account.cafes).toEqual([expect.objectContaining({ id: TEST_TENANT, role: 'owner', onlyActiveOwner: false })])
    const [cafe] = await db.select().from(member).where(eq(member.userId, owner.userId))
    expect(cafe).toMatchObject({ organizationId: TEST_TENANT, role: 'owner' })
  })

  it('refuses one\'s own account, a super admin, a banned account, a past end and a stale version', async () => {
    const userId = await signUp('dara@example.com')
    await db.insert(user).values({ id: 'super-2', email: 'super2@example.com', name: 'Super 2', role: 'customer,superadmin' })
    const version = await versionOf(userId)

    await expectApiError(async () => banAccount(db, actor, SUPER, { version: 1, reason: 'x' }), 409, 'OWN_ACCOUNT')
    await expectApiError(async () => banAccount(db, actor, 'super-2', { version: await versionOf('super-2'), reason: 'x' }), 409, 'PLATFORM_ACCOUNT')
    await expectApiError(async () => banAccount(db, actor, userId, { version: version + 1, reason: 'x' }), 409, 'VERSION_CONFLICT')
    await expectApiError(async () => banAccount(db, actor, userId, { version, reason: 'x', until: new Date(Date.now() - 1000).toISOString() }), 400, 'VALIDATION_FAILED', ['until'])
    await banAccount(db, actor, userId, { version, reason: 'x' })
    await expectApiError(async () => banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'x' }), 409, 'ALREADY_BANNED')
  })

  it('a change to the account between the read and the write wins: nothing is banned', async () => {
    const userId = await signUp('dara@example.com')
    const version = await versionOf(userId)
    const racing = interleaved(db, () => db.update(user).set({ updatedAt: new Date(version + 5) }).where(eq(user.id, userId)))
    await expectApiError(async () => banAccount(racing, actor, userId, { version, reason: 'x' }), 409, 'VERSION_CONFLICT')
    expect((await getPlatformAccount(db, userId)).ban).toBeNull()
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'platform.account.ban'))).toEqual([])
  })

  it('an account made a super admin meanwhile is not banned', async () => {
    const userId = await signUp('dara@example.com')
    const version = await versionOf(userId)
    // Granted by hand (operations.md → Super admins): the version doesn't move.
    const racing = interleaved(db, () => db.update(user).set({ role: 'superadmin', updatedAt: new Date(version) }).where(eq(user.id, userId)))
    await expectApiError(async () => banAccount(racing, actor, userId, { version, reason: 'x' }), 409, 'VERSION_CONFLICT')
    expect((await getPlatformAccount(db, userId)).ban).toBeNull()
  })
  it('an account banned meanwhile by a write that keeps the version is not banned twice', async () => {
    const userId = await signUp('dara@example.com')
    const version = await versionOf(userId)
    const racing = interleaved(db, () => db.update(user).set({ banned: true, banReason: 'First', updatedAt: new Date(version) }).where(eq(user.id, userId)))
    await expectApiError(async () => banAccount(racing, actor, userId, { version, reason: 'Second' }), 409, 'VERSION_CONFLICT')
    expect((await getPlatformAccount(db, userId)).ban).toEqual({ reason: 'First', until: null })
  })
})

describe('unbanning', () => {
  it('lets the account sign in again and audits it', async () => {
    const userId = await signUp('dara@example.com')
    await banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'x' })
    const account = await unbanAccount(db, actor, userId, { version: await versionOf(userId) })
    expect(account.ban).toBeNull()
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).resolves.toBeDefined()
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'platform.account.unban'))).toHaveLength(1)
  })

  it('refuses an account that isn\'t banned, a stale version and one\'s own', async () => {
    const userId = await signUp('dara@example.com')
    await expectApiError(async () => unbanAccount(db, actor, userId, { version: await versionOf(userId) }), 409, 'NOT_BANNED')
    await banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'x' })
    await expectApiError(async () => unbanAccount(db, actor, userId, { version: 1 }), 409, 'VERSION_CONFLICT')
    await expectApiError(async () => unbanAccount(db, actor, SUPER, { version: 1 }), 409, 'OWN_ACCOUNT')
  })
})

describe('signing out everywhere', () => {
  it('ends every session, keeps the account as it was and audits it', async () => {
    const userId = await signUp('dara@example.com')
    const headers = await signIn(auth, 'dara@example.com', PASSWORD)
    const before = await versionOf(userId)

    const account = await signOutAccount(db, actor, userId)
    expect(account.activeSessions).toBe(0)
    expect(account.version).toBe(before)
    expect(await sessionUser(headers)).toBeUndefined()
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).resolves.toBeDefined()
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'platform.account.sign-out'))).toHaveLength(1)
  })

  it('refuses one\'s own account and a super admin\'s', async () => {
    await db.insert(user).values({ id: 'super-2', email: 'super2@example.com', name: 'Super 2', role: 'superadmin' })
    await expectApiError(async () => signOutAccount(db, actor, SUPER), 409, 'OWN_ACCOUNT')
    await expectApiError(async () => signOutAccount(db, actor, 'super-2'), 409, 'PLATFORM_ACCOUNT')
  })
})

describe('a temporary password', () => {
  it('replaces the password, asks for a new one, ends the sessions and audits it without the password', async () => {
    const userId = await signUp('dara@example.com')
    const headers = await signIn(auth, 'dara@example.com', PASSWORD)

    const { account, temporaryPassword } = await setTemporaryPassword(db, actor, userId, { version: await versionOf(userId), reason: 'Owner lost access' })
    expect(account.mustChangePassword).toBe(true)
    expect(await sessionUser(headers)).toBeUndefined()
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).rejects.toThrow()
    await expect(signIn(auth, 'dara@example.com', temporaryPassword)).resolves.toBeDefined()

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'platform.account.password.temporary'))
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(temporaryPassword)
    expect(rows[0]!.metadata).toEqual({ reason: 'Owner lost access' })
  })

  it('works for an account that had no password', async () => {
    const created = await createUser(db, 'nopass@example.com')
    const { temporaryPassword } = await setTemporaryPassword(db, actor, created.id, { version: await versionOf(created.id), reason: 'x' })
    await expect(signIn(auth, 'nopass@example.com', temporaryPassword)).resolves.toBeDefined()
  })

  it('refuses a banned account, a super admin, one\'s own and a stale version', async () => {
    const userId = await signUp('dara@example.com')
    await db.insert(user).values({ id: 'super-2', email: 'super2@example.com', name: 'Super 2', role: 'superadmin' })
    await expectApiError(async () => setTemporaryPassword(db, actor, userId, { version: 1, reason: 'x' }), 409, 'VERSION_CONFLICT')
    await expectApiError(async () => setTemporaryPassword(db, actor, SUPER, { version: 1, reason: 'x' }), 409, 'OWN_ACCOUNT')
    await expectApiError(async () => setTemporaryPassword(db, actor, 'super-2', { version: await versionOf('super-2'), reason: 'x' }), 409, 'PLATFORM_ACCOUNT')
    await banAccount(db, actor, userId, { version: await versionOf(userId), reason: 'x' })
    await expectApiError(async () => setTemporaryPassword(db, actor, userId, { version: await versionOf(userId), reason: 'x' }), 409, 'ACCOUNT_BANNED')
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).rejects.toThrow()
  })

  it('an account banned meanwhile keeps its password', async () => {
    const userId = await signUp('dara@example.com')
    const version = await versionOf(userId)
    // Even by a write that doesn't move the version: the batch checks the state too.
    const racing = interleaved(db, () => db.update(user).set({ banned: true, updatedAt: new Date(version) }).where(eq(user.id, userId)))
    await expectApiError(async () => setTemporaryPassword(racing, actor, userId, { version, reason: 'x' }), 409, 'VERSION_CONFLICT')
    expect((await getPlatformAccount(db, userId)).mustChangePassword).toBe(false)
    await db.update(user).set({ banned: false }).where(eq(user.id, userId))
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).resolves.toBeDefined()
  })
})

describe('Better Auth\'s own admin endpoints', () => {
  it('refuse a super admin: accounts change only through the console', async () => {
    const userId = await signUp('dara@example.com')
    await signUp('boss@example.com', 'Boss')
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.email, 'boss@example.com'))
    const headers = await signIn(auth, 'boss@example.com', PASSWORD)

    await expect(auth.api.banUser({ headers, body: { userId } })).rejects.toThrow()
    await expect(auth.api.revokeUserSessions({ headers, body: { userId } })).rejects.toThrow()
    await expect(auth.api.setUserPassword({ headers, body: { userId, newPassword: 'a brand new password' } })).rejects.toThrow()
    await expect(auth.api.impersonateUser({ headers, body: { userId } })).rejects.toThrow()
    expect((await getPlatformAccount(db, userId)).ban).toBeNull()
  })

  it('while the console\'s own permission is granted', () => {
    const superadmin = { id: SUPER, role: 'superadmin' } as SessionUser
    expect(authorizePlatform(superadmin, { account: ['read', 'ban', 'sign-out', 'reset-password'] })).toEqual({ userId: SUPER })
  })
})
