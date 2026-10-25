// @module-tag slow
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { auditEvents, session, twoFactor, user } from '#server/db/tables'
import { newId } from '#server/utils/ids'
import type { Db } from '#server/utils/batch'
import { createTestAuth, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant, insertBranch } from '#server/tests/support/db'
import { adminSession, counterSession, platformSession } from '#server/features/identity/identity.service'
import { DEV_PASSWORD, resetDevAccount, resetDevSignIn } from '#server/features/identity/dev-accounts.service'
import type { DevAccountSpec } from '#server/features/identity/dev-accounts.service'
import type { SessionUser } from '#server/features/identity/identity.types'

// Test accounts for the dev server (D209). Several password hashes: tagged slow.

let db: Db
let auth: TestAuth
const NUK = 'cafe-nuk'
const SECOND = 'cafe-second'
let nukBranch: string
let secondBranch: string

const DEV = { dev: true, password: DEV_PASSWORD }

async function sessionUser(email: string, password = DEV_PASSWORD) {
  const headers = await signIn(auth, email, password)
  return (await auth.api.getSession({ headers }))!.user as SessionUser
}

const accountRow = async (email: string) => (await db.select().from(user).where(eq(user.email, email)))[0]!

beforeEach(async () => {
  db = await createTestDb()
  auth = createTestAuth(db)
  nukBranch = newId()
  secondBranch = newId()
  await ensureTenant(db, NUK, 'nuk')
  await ensureTenant(db, SECOND, 'second')
  await insertBranch(db, { id: nukBranch, name: 'Main branch', timezone: 'Asia/Phnom_Penh', tenantId: NUK })
  await insertBranch(db, { id: secondBranch, name: 'Main branch', timezone: 'Asia/Phnom_Penh', tenantId: SECOND })
})

describe('resetDevAccount', () => {
  it('creates each role with the password and exactly its access, no forced change', async () => {
    const specs: DevAccountSpec[] = [
      { email: 'superadmin@nuk.test', name: 'Super', role: 'superadmin' },
      { email: 'owner@nuk.test', name: 'Owner', role: 'owner', tenantId: NUK },
      { email: 'manager@nuk.test', name: 'Manager', role: 'manager', tenantId: NUK, branchId: nukBranch },
      { email: 'staff@nuk.test', name: 'Staff', role: 'staff', tenantId: NUK, branchId: nukBranch },
      { email: 'customer@nuk.test', name: 'Customer', role: 'customer', tenantId: NUK },
    ]
    for (const spec of specs) expect((await resetDevAccount(db, spec, DEV)).created).toBe(true)

    const superadmin = await sessionUser('superadmin@nuk.test')
    expect(platformSession(superadmin).mustChangePassword).toBe(false)
    // A super admin gets no cafe's data (D135).
    await expect(adminSession(db, superadmin, NUK)).rejects.toMatchObject({ statusCode: 403 })

    const owner = await sessionUser('owner@nuk.test')
    expect((await adminSession(db, owner, NUK)).mustChangePassword).toBe(false)
    expect(() => platformSession(owner)).toThrow()

    const manager = await counterSession(db, await sessionUser('manager@nuk.test'), NUK)
    expect(manager.branches).toEqual([expect.objectContaining({ id: nukBranch, role: 'manager' })])
    const staff = await counterSession(db, await sessionUser('staff@nuk.test'), NUK)
    expect(staff.branches).toEqual([expect.objectContaining({ id: nukBranch, role: 'staff' })])

    const customer = await sessionUser('customer@nuk.test')
    await expect(adminSession(db, customer, NUK)).rejects.toMatchObject({ statusCode: 403 })
    await expect(counterSession(db, customer, NUK)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps the second cafe\'s owner out of the first cafe (two-cafe isolation)', async () => {
    await resetDevAccount(db, { email: 'owner@second.test', name: 'Second', role: 'owner', tenantId: SECOND }, DEV)
    const owner = await sessionUser('owner@second.test')
    expect((await adminSession(db, owner, SECOND)).userId).toBe(owner.id)
    await expect(adminSession(db, owner, NUK)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('puts an existing account back: password, no forced change, no two-step, not banned, signed out', async () => {
    const spec: DevAccountSpec = { email: 'staff@nuk.test', name: 'Staff', role: 'staff', tenantId: NUK, branchId: nukBranch }
    const { userId } = await resetDevAccount(db, spec, DEV)
    await signIn(auth, spec.email, DEV_PASSWORD)
    const before = await accountRow(spec.email)
    await db.update(user).set({ mustChangePassword: true, banned: true, banReason: 'Test', twoFactorEnabled: true, role: 'superadmin' }).where(eq(user.id, userId))
    await db.insert(twoFactor).values({ id: newId(), userId, secret: 'secret', backupCodes: '[]' })

    const again = await resetDevAccount(db, spec, { dev: true, password: 'another dev password' })
    expect(again).toMatchObject({ userId, created: false })
    const row = await accountRow(spec.email)
    expect(row).toMatchObject({ mustChangePassword: false, banned: false, banReason: null, twoFactorEnabled: false, role: 'customer' })
    // A newer version: an admin form open on the old one gets a conflict.
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, userId))).toEqual([])
    expect(await db.select().from(session).where(eq(session.userId, userId))).toEqual([])
    await expect(signIn(auth, spec.email, DEV_PASSWORD)).rejects.toThrow()
    await signIn(auth, spec.email, 'another dev password')
    expect((await db.select().from(auditEvents).where(eq(auditEvents.targetId, userId))).map(e => e.action)).toEqual(['dev.account.reset', 'dev.account.reset'])
  })

  it('refuses outside the dev server and writes nothing', async () => {
    await expect(resetDevAccount(db, { email: 'owner@nuk.test', name: 'Owner', role: 'owner', tenantId: NUK }, { dev: false, password: DEV_PASSWORD })).rejects.toThrow('dev server only')
    expect(await db.select().from(user).where(eq(user.email, 'owner@nuk.test'))).toEqual([])
  })
})

describe('resetDevSignIn', () => {
  it('gives any account the password back, keeping its roles', async () => {
    await resetDevAccount(db, { email: 'owner@nuk.test', name: 'Owner', role: 'owner', tenantId: NUK }, { dev: true, password: 'forgotten password' })
    const { userId } = await resetDevSignIn(db, ' Owner@NUK.test ', DEV)
    expect(await accountRow('owner@nuk.test')).toMatchObject({ id: userId, mustChangePassword: false })
    expect((await adminSession(db, await sessionUser('owner@nuk.test'), NUK)).userId).toBe(userId)
  })

  it('refuses outside the dev server and an unknown email', async () => {
    await resetDevAccount(db, { email: 'owner@nuk.test', name: 'Owner', role: 'owner', tenantId: NUK }, DEV)
    await expect(resetDevSignIn(db, 'owner@nuk.test', { dev: false, password: 'changed password' })).rejects.toThrow('dev server only')
    await signIn(auth, 'owner@nuk.test', DEV_PASSWORD)
    await expect(resetDevSignIn(db, 'nobody@nuk.test', DEV)).rejects.toThrow('No account')
  })
})
