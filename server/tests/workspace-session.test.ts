import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { session, user } from '#server/db/tables'
import { newId } from '#server/utils/ids'
import { addBranchStaff, createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'

// Session length by role (D243): the workspaces' route helpers (server/utils/access.ts) refuse a
// session older than a day from sign-in, 401 SESSION_EXPIRED, and delete it; customer routes don't.
// Nitro's globals stood in for, as in support-access.test.ts.

let db: Db
vi.mock('#server/utils/db', () => ({ useDb: () => db }))
const HOUR = 60 * 60 * 1000
let current: { user: Record<string, unknown>, session: { id: string, createdAt: Date } } | null
let branchId: string

const eventOf = (path = '/api/c/nuk/admin/menu/items') =>
  ({ method: 'GET', context: {}, path, node: { req: { url: path, headers: {} } } }) as unknown as H3Event

/** A session row for `userId`, signed in `age` ago, as Better Auth stores it. */
async function signedIn(userId: string, age: number, role = 'customer') {
  const id = newId()
  const createdAt = new Date(Date.now() - age)
  await db.insert(session).values({ id, userId, token: `token-${id}`, expiresAt: new Date(Date.now() + 7 * 24 * HOUR), createdAt, updatedAt: createdAt })
  current = { user: { id: userId, email: 'x@example.com', name: 'X', role, twoFactorEnabled: true }, session: { id, createdAt } }
  return id
}
const sessionExists = async (id: string) => (await db.select().from(session).where(eq(session.id, id))).length === 1

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
  vi.stubGlobal('getUserSession', async () => current)
  vi.stubGlobal('getRouterParam', (_event: H3Event, name: string) => (name === 'slug' ? 'nuk' : undefined))
  vi.stubGlobal('getRequestURL', (event: H3Event) => new URL(`https://cafe.example${(event as unknown as { path: string }).path}`))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace sessions last a day from sign-in', () => {
  it('the admin: an owner\'s session works for 23 hours, then is refused and deleted', async () => {
    const { requirePermission } = await import('#server/utils/access')
    const owner = await createAdmin(db, 'owner@example.com')
    await signedIn(owner.userId, 23 * HOUR)
    expect(await requirePermission(eventOf(), { menu: ['read'] })).toMatchObject({ userId: owner.userId, role: 'owner' })

    const old = await signedIn(owner.userId, 24 * HOUR)
    await expectApiError(() => requirePermission(eventOf(), { menu: ['read'] }), 401, 'SESSION_EXPIRED')
    expect(await sessionExists(old)).toBe(false)
  })

  it('the counter: a cashier\'s day-old session is refused', async () => {
    const { requireBranchPermission } = await import('#server/utils/access')
    const cashier = await createUser(db, 'cashier@example.com')
    await addBranchStaff(db, branchId, cashier.id, 'staff')
    await signedIn(cashier.id, HOUR)
    expect(await requireBranchPermission(eventOf(), branchId, { order: ['read'] })).toMatchObject({ userId: cashier.id })
    await signedIn(cashier.id, 25 * HOUR)
    await expectApiError(() => requireBranchPermission(eventOf(), branchId, { order: ['read'] }), 401, 'SESSION_EXPIRED')
  })

  it('the console: a super admin\'s day-old session is refused', async () => {
    const { requirePlatformPermission } = await import('#server/utils/access')
    const superAdmin = await createUser(db, 'ops@example.com')
    await db.update(user).set({ role: 'superadmin', twoFactorEnabled: true }).where(eq(user.id, superAdmin.id))
    await signedIn(superAdmin.id, HOUR, 'superadmin')
    expect(await requirePlatformPermission(eventOf('/api/platform/tenants'), { tenant: ['read'] })).toMatchObject({ userId: superAdmin.id })
    await signedIn(superAdmin.id, 30 * HOUR, 'superadmin')
    await expectApiError(() => requirePlatformPermission(eventOf('/api/platform/tenants'), { tenant: ['read'] }), 401, 'SESSION_EXPIRED')
  })

  it('a customer\'s session older than a day still orders: the limit is the workspaces\'', async () => {
    const { requireCustomer } = await import('#server/utils/access')
    const customer = await createUser(db, 'customer@example.com')
    const id = await signedIn(customer.id, 3 * 24 * HOUR)
    expect(await requireCustomer(eventOf('/api/c/nuk/shop/orders'))).toMatchObject({ userId: customer.id })
    expect(await sessionExists(id)).toBe(true)
  })

  it('access given after sign-in doesn\'t extend an old session: the person signs in again', async () => {
    const { requireBranchPermission } = await import('#server/utils/access')
    const customer = await createUser(db, 'new-hire@example.com')
    await signedIn(customer.id, 2 * 24 * HOUR)
    await addBranchStaff(db, branchId, customer.id, 'staff')
    await expectApiError(() => requireBranchPermission(eventOf(), branchId, { order: ['read'] }), 401, 'SESSION_EXPIRED')
  })

  it('deletes only that session: the account\'s newer one keeps working', async () => {
    const { requirePermission } = await import('#server/utils/access')
    const owner = await createAdmin(db, 'owner@example.com')
    const fresh = await signedIn(owner.userId, HOUR)
    const old = await signedIn(owner.userId, 2 * 24 * HOUR)
    await expectApiError(() => requirePermission(eventOf(), { menu: ['read'] }), 401, 'SESSION_EXPIRED')
    expect([await sessionExists(old), await sessionExists(fresh)]).toEqual([false, true])
  })
})
