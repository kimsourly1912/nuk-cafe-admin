import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { createStaffSchema, updateStaffAccessSchema } from '#shared/contracts/staff'
import type { CreateStaffInput, StaffListQuery } from '#shared/contracts/staff'
import { seedDemoBranch } from '#server/features/branches'
import { auditEvents, member, user } from '#server/db/tables'
import { newId } from '#server/utils/ids'
import type { Db } from '#server/utils/batch'
import { createTestAuth, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { addBranchStaff, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError, failure } from '#server/tests/support/failure'
import { createStaff, disableStaff, getStaffMember, listStaff, resetStaffPassword, seedFirstOwner, updateStaffAccess } from '#server/features/identity/staff.service'
import { seedTenant } from '#server/features/tenants'
import type { Actor } from '#server/features/identity/identity.types'

let db: Db
let auth: TestAuth
let branchId: string
let otherBranchId: string
let actor: Actor

async function addBranch(name: string, status = 'active') {
  const id = newId()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', status })
  return id
}

const staffInput = (overrides: Partial<CreateStaffInput> = {}): CreateStaffInput =>
  ({ name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId, role: 'staff' }], ...overrides })

/** A customer who signed up by themselves. */
async function signUpCustomer(email: string, password = 'the customer password') {
  const { user: created } = await auth.api.signUpEmail({ body: { email, password, name: 'Customer' } })
  return created.id
}

const PAGE = { page: 1, pageSize: 20 }

beforeEach(async () => {
  db = await createTestDb()
  auth = createTestAuth(db)
  branchId = await addBranch('Riverside')
  otherBranchId = await addBranch('Airport')
  const seeded = await seedFirstOwner(db, await ensureTenant(db), { name: 'Owner', email: 'owner@example.com' })
  actor = { userId: seeded!.staff.id, tenantId: TEST_TENANT, role: 'owner' }
})

describe('create', () => {
  it('creates an account with a temporary password it can sign in with, then must change', async () => {
    const created = await createStaff(db, actor, staffInput())
    expect(created.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/)
    expect(created.staff).toMatchObject({
      name: 'Sophea',
      email: 'sophea@example.com',
      admin: false,
      memberships: [{ branchId, branchName: 'Riverside', role: 'staff' }],
      mustChangePassword: true,
    })

    // Better Auth accepts the account we wrote: same password hash and credential format.
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)
    const session = await auth.api.getSession({ headers })
    expect(session?.user).toMatchObject({ id: created.staff.id, emailVerified: true, role: 'customer', mustChangePassword: true })
  })

  it('audits the creation with who did it and the access given, never the password', async () => {
    const created = await createStaff(db, actor, staffInput())
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.targetId, created.staff.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: actor.userId, action: 'staff.create', targetType: 'user' })
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain(created.temporaryPassword!)
  })

  it('gives access to an existing customer account without touching its password', async () => {
    const customerId = await signUpCustomer('dara@example.com')
    const created = await createStaff(db, actor, staffInput({ email: 'dara@example.com', name: 'Ignored' }))
    expect(created.temporaryPassword).toBeNull()
    expect(created.staff).toMatchObject({ id: customerId, name: 'Customer', mustChangePassword: false, memberships: [{ branchId, role: 'staff' }] })
    await expect(signIn(auth, 'dara@example.com', 'the customer password')).resolves.toBeDefined()
  })

  it('refuses an email that already has staff access, or belongs to an admin', async () => {
    await createStaff(db, actor, staffInput())
    await expectApiError(() => createStaff(db, actor, staffInput({ memberships: [{ branchId: otherBranchId, role: 'manager' }] })), 409, 'STAFF_ALREADY_EXISTS')
    await expectApiError(() => createStaff(db, actor, staffInput({ email: 'owner@example.com' })), 409, 'STAFF_ALREADY_EXISTS')
  })

  it('refuses unknown and archived branches, naming each one', async () => {
    const archived = await addBranch('Old town', 'archived')
    const error = await createStaff(db, actor, staffInput({ memberships: [{ branchId, role: 'staff' }, { branchId: archived, role: 'staff' }, { branchId: newId(), role: 'manager' }] }))
      .catch((e: { statusCode: number, data: { fieldErrors: Record<string, string[]> } }) => e)
    expect(error).toMatchObject({ statusCode: 400, data: { code: 'VALIDATION_FAILED' } })
    expect(Object.keys((error as { data: { fieldErrors: object } }).data.fieldErrors)).toEqual(['memberships.1.branchId', 'memberships.2.branchId'])
  })

  it('creates an admin with no branch', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    expect(created.staff).toMatchObject({ admin: true, memberships: [] })
  })
})

describe('input', () => {
  it('lowercases the email and needs some access', () => {
    expect(v.parse(createStaffSchema, { ...staffInput(), email: '  Sophea@Example.COM ' }).email).toBe('sophea@example.com')
    const none = v.safeParse(createStaffSchema, { ...staffInput(), memberships: [] })
    expect(none.success).toBe(false)
    expect(v.flatten(none.issues!).nested).toHaveProperty('memberships')
  })

  it('lists each branch once', () => {
    const twice = v.safeParse(updateStaffAccessSchema, { version: 1, admin: false, memberships: [{ branchId, role: 'staff' }, { branchId, role: 'manager' }] })
    expect(twice.success).toBe(false)
  })
})

describe('update access', () => {
  it('replaces the roles, ends the person\'s sessions and moves the version on', async () => {
    const created = await createStaff(db, actor, staffInput())
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)

    const updated = await updateStaffAccess(db, actor, created.staff.id, {
      version: created.staff.version,
      admin: false,
      memberships: [{ branchId: otherBranchId, role: 'manager' }],
    })
    expect(updated.memberships).toEqual([{ branchId: otherBranchId, branchName: 'Airport', role: 'manager' }])
    expect(updated.version).toBeGreaterThan(created.staff.version)
    expect(await auth.api.getSession({ headers })).toBeNull()
  })

  it('refuses a stale version and changes nothing', async () => {
    const created = await createStaff(db, actor, staffInput())
    const input = { version: created.staff.version, admin: false, memberships: [{ branchId, role: 'manager' as const }] }
    await updateStaffAccess(db, actor, created.staff.id, input)
    await expectApiError(() => updateStaffAccess(db, actor, created.staff.id, { ...input, memberships: [], admin: true }), 409, 'VERSION_CONFLICT')
    const [current] = (await listStaff(db, actor, { ...PAGE, search: 'sophea' })).items
    expect(current).toMatchObject({ admin: false, memberships: [{ role: 'manager' }] })
  })

  it('lets exactly one of two simultaneous saves of the same version through', async () => {
    const created = await createStaff(db, actor, staffInput())
    const save = (role: 'staff' | 'manager') => updateStaffAccess(db, actor, created.staff.id, { version: created.staff.version, admin: false, memberships: [{ branchId, role }] })
    const results = await Promise.allSettled([save('manager'), save('staff')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
  })

  it('lets admins grant admin, but never remove their own', async () => {
    const created = await createStaff(db, actor, staffInput())
    const promoted = await updateStaffAccess(db, actor, created.staff.id, { version: created.staff.version, admin: true, memberships: [] })
    expect(promoted.admin).toBe(true)

    const owner = (await listStaff(db, actor, { ...PAGE, search: 'owner' })).items[0]!
    await expectApiError(() => updateStaffAccess(db, actor, actor.userId, { version: owner.version, admin: false, memberships: [{ branchId, role: 'manager' }] }), 409, 'OWN_ACCESS')
  })

  it('keeps the admin\'s own session when they change their own branches', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)
    const self: Actor = { userId: created.staff.id, tenantId: TEST_TENANT, role: 'owner' }
    await updateStaffAccess(db, self, created.staff.id, { version: created.staff.version, admin: true, memberships: [{ branchId, role: 'manager' }] })
    expect(await auth.api.getSession({ headers })).not.toBeNull()
  })

  it('never leaves the cafe without an admin, even when two admins demote each other at once', async () => {
    const second = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    const owner = (await listStaff(db, actor, { ...PAGE, search: 'owner' })).items[0]!
    // Both read each other's version, then both save: the owner demotes the second admin first…
    await updateStaffAccess(db, actor, second.staff.id, { version: second.staff.version, admin: false, memberships: [{ branchId, role: 'staff' }] })
    // …and the second admin's request, already past its permission check, demotes the owner.
    const secondActor: Actor = { userId: second.staff.id, tenantId: TEST_TENANT, role: 'owner' }
    await expectApiError(() => updateStaffAccess(db, secondActor, actor.userId, { version: owner.version, admin: false, memberships: [{ branchId, role: 'staff' }] }), 409, 'LAST_ADMIN')
    expect((await listStaff(db, actor, { ...PAGE, role: 'admin' })).total).toBe(1)
  })
})

describe('disable', () => {
  it('takes all access away and signs the person out; the account stays a customer', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [{ branchId, role: 'manager' }] }))
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)

    await disableStaff(db, actor, created.staff.id, { version: created.staff.version })

    expect(await auth.api.getSession({ headers })).toBeNull()
    expect((await listStaff(db, actor, PAGE)).items.map(s => s.email)).toEqual(['owner@example.com'])
    const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, created.staff.id))
    expect(row!.role).toBe('customer')
    // They can still sign in, as a customer.
    await expect(signIn(auth, 'sophea@example.com', created.temporaryPassword!)).resolves.toBeDefined()
  })

  it('refuses disabling oneself, and a stale version', async () => {
    const owner = (await listStaff(db, actor, { ...PAGE, search: 'owner' })).items[0]!
    await expectApiError(() => disableStaff(db, actor, actor.userId, { version: owner.version }), 409, 'OWN_ACCESS')

    const created = await createStaff(db, actor, staffInput())
    await expectApiError(() => disableStaff(db, actor, created.staff.id, { version: created.staff.version - 1 }), 409, 'VERSION_CONFLICT')
  })

  it('answers 404 for an unknown account', async () => {
    expect(await failure(disableStaff(db, actor, newId(), { version: 1 }))).toEqual({ status: 404, code: 'NOT_FOUND' })
  })
})

// Slow: each test hashes and checks several passwords (scrypt, CPU-bound; vitest.config.ts).
describe('reset password (step 10.1, D115)', { tags: ['slow'] }, () => {
  it('gives a new temporary password: the old one stops working, every session ends, and they must change it', async () => {
    const created = await createStaff(db, actor, staffInput())
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)

    const reset = await resetStaffPassword(db, actor, created.staff.id, { version: created.staff.version })

    expect(reset.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/)
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword)
    expect(reset.staff).toMatchObject({ id: created.staff.id, mustChangePassword: true })
    expect(reset.staff.version).toBeGreaterThan(created.staff.version)
    expect(await auth.api.getSession({ headers })).toBeNull()
    await expect(signIn(auth, 'sophea@example.com', created.temporaryPassword!)).rejects.toThrow()
    const fresh = await signIn(auth, 'sophea@example.com', reset.temporaryPassword)
    expect((await auth.api.getSession({ headers: fresh }))?.user).toMatchObject({ mustChangePassword: true })
  })

  it('works for a person who had changed their password (must change again), and for another admin', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    await db.update(user).set({ mustChangePassword: false }).where(eq(user.id, created.staff.id))
    const [current] = (await listStaff(db, actor, { ...PAGE, search: 'sophea' })).items
    const reset = await resetStaffPassword(db, actor, created.staff.id, { version: current!.version })
    expect(reset.staff).toMatchObject({ admin: true, mustChangePassword: true })
  })

  it('audits who reset whose password, never the password', async () => {
    const created = await createStaff(db, actor, staffInput())
    const reset = await resetStaffPassword(db, actor, created.staff.id, { version: created.staff.version })
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'staff.password.reset'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: actor.userId, targetType: 'user', targetId: created.staff.id })
    expect(JSON.stringify(rows[0])).not.toContain(reset.temporaryPassword)
  })

  it('refuses one\'s own password, a stale version, a customer and an unknown account', async () => {
    const owner = (await listStaff(db, actor, { ...PAGE, search: 'owner' })).items[0]!
    await expectApiError(() => resetStaffPassword(db, actor, actor.userId, { version: owner.version }), 409, 'OWN_ACCESS')

    const created = await createStaff(db, actor, staffInput())
    await expectApiError(() => resetStaffPassword(db, actor, created.staff.id, { version: created.staff.version - 1 }), 409, 'VERSION_CONFLICT')
    // Still the first password: nothing changed.
    await expect(signIn(auth, 'sophea@example.com', created.temporaryPassword!)).resolves.toBeDefined()

    // A customer resets by email; a disabled staff member is a customer again.
    const customerId = await signUpCustomer('guest@example.com')
    expect(await failure(resetStaffPassword(db, actor, customerId, { version: 1 }))).toEqual({ status: 404, code: 'NOT_FOUND' })
    await disableStaff(db, actor, created.staff.id, { version: created.staff.version })
    expect(await failure(resetStaffPassword(db, actor, created.staff.id, { version: created.staff.version }))).toEqual({ status: 404, code: 'NOT_FOUND' })
    expect(await failure(resetStaffPassword(db, actor, newId(), { version: 1 }))).toEqual({ status: 404, code: 'NOT_FOUND' })
  })

  it('two admins resetting the same person at once: one wins, and only its password works', async () => {
    const created = await createStaff(db, actor, staffInput())
    const second = await createStaff(db, actor, staffInput({ name: 'Dara', email: 'dara@example.com', admin: true, memberships: [] }))
    const secondActor: Actor = { userId: second.staff.id, tenantId: TEST_TENANT, role: 'owner' }
    const input = { version: created.staff.version }
    const results = await Promise.allSettled([resetStaffPassword(db, actor, created.staff.id, input), resetStaffPassword(db, secondActor, created.staff.id, input)])

    const won = results.filter(r => r.status === 'fulfilled')
    expect(won).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
    // The admin who saw a password can hand over one that works.
    await expect(signIn(auth, 'sophea@example.com', won[0]!.value.temporaryPassword)).resolves.toBeDefined()
  })
})

describe('list', () => {
  beforeEach(async () => {
    await createStaff(db, actor, staffInput({ name: 'Sophea', email: 'sophea@example.com', memberships: [{ branchId, role: 'staff' }] }))
    await createStaff(db, actor, staffInput({ name: 'Vanna', email: 'vanna@example.com', memberships: [{ branchId: otherBranchId, role: 'manager' }, { branchId, role: 'staff' }] }))
    await signUpCustomer('customer@example.com')
  })

  it('lists people with access only, by name, with their branches', async () => {
    const page = await listStaff(db, actor, PAGE)
    expect(page.items.map(s => s.name)).toEqual(['Owner', 'Sophea', 'Vanna'])
    expect(page.items[2]!.memberships.map(m => m.branchName)).toEqual(['Airport', 'Riverside'])
    expect(page).toMatchObject({ total: 3, totalPages: 1 })
  })

  it('filters by role, branch and search, and paginates', async () => {
    expect((await listStaff(db, actor, { ...PAGE, role: 'admin' })).items.map(s => s.name)).toEqual(['Owner'])
    expect((await listStaff(db, actor, { ...PAGE, role: 'manager' })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, actor, { ...PAGE, branchId: otherBranchId })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, actor, { ...PAGE, branchId, role: 'manager' })).items).toEqual([])
    expect((await listStaff(db, actor, { ...PAGE, search: 'VANNA@' })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, actor, { ...PAGE, search: '%' })).items).toEqual([])
    expect(await listStaff(db, actor, { page: 2, pageSize: 2 })).toMatchObject({ items: [{ name: 'Vanna' }], total: 3, totalPages: 2 })
  })

  // D1 refuses a LIKE pattern over 50 bytes, so a search is matched with instr(), not like.
  describe('long and literal searches', () => {
    const SLASH = String.fromCharCode(92)
    const ASCII_49 = 'a'.repeat(30) + 'Name' + 'b'.repeat(15)
    const KHMER_17 = 'ស'.repeat(17)
    const SYMBOLS = `Fifty% _off_ ${SLASH} Sam`
    const NAME_MAX = 100
    const names = async (search: string, query: object = {}) => (await listStaff(db, actor, { ...PAGE, search, ...query })).items.map(s => s.name).sort()

    beforeEach(async () => {
      await createStaff(db, actor, staffInput({ name: ASCII_49, email: 'ascii@example.com', memberships: [] }))
      await createStaff(db, actor, staffInput({ name: KHMER_17, email: 'khmer@example.com', memberships: [] }))
      await createStaff(db, actor, staffInput({ name: `${KHMER_17} Mixed`, email: 'mixed@example.com', memberships: [] }))
      await createStaff(db, actor, staffInput({ name: SYMBOLS, email: 'symbols@example.com', memberships: [] }))
      await createStaff(db, actor, staffInput({ name: 'z'.repeat(NAME_MAX), email: 'max@example.com', memberships: [] }))
    })

    it('finds what a 50-byte LIKE pattern could not hold, ignoring ASCII case', async () => {
      expect(ASCII_49).toHaveLength(49)
      expect(await names(ASCII_49)).toEqual([ASCII_49])
      expect(await names(ASCII_49.toUpperCase())).toEqual([ASCII_49])
      expect(await names(KHMER_17)).toEqual([KHMER_17, `${KHMER_17} Mixed`].sort())
      expect(await names(`${KHMER_17} mixed`)).toEqual([`${KHMER_17} Mixed`])
      expect(await names('z'.repeat(NAME_MAX))).toEqual(['z'.repeat(NAME_MAX)])
      expect(await names('z'.repeat(NAME_MAX).replace(/z$/, 'y'))).toEqual([])
      expect(await names('ស'.repeat(NAME_MAX))).toEqual([])
      expect(await names('MAX@EXAMPLE.COM')).toEqual(['z'.repeat(NAME_MAX)])
      expect(await names('x'.repeat(NAME_MAX) + '@example.com')).toEqual([])
    })

    it('treats %, _ and backslash as plain characters', async () => {
      for (const search of ['%', '_', SLASH, '% _off_ ', `${SLASH} Sam`]) expect(await names(search)).toEqual([SYMBOLS])
      expect(await names('_ff_')).toEqual([])
      expect(await names('%'.repeat(25))).toEqual([])
      expect(await names(SLASH.repeat(60))).toEqual([])
    })

    it('keeps the page and the total in step, with the other filters', async () => {
      const page = await listStaff(db, actor, { page: 2, pageSize: 1, search: KHMER_17 })
      expect(page).toMatchObject({ items: [{}], total: 2, totalPages: 2 })
      expect((await listStaff(db, actor, { ...PAGE, search: KHMER_17, role: 'admin' })).total).toBe(0)
      expect((await listStaff(db, actor, { ...PAGE, search: ASCII_49, branchId })).total).toBe(0)
    })
  })
})

// The list starts from the cafe's own memberships and looks users up by primary key; `user` holds
// every customer and guest of every cafe, so a check per user would grow with them.
describe('list from the cafe\'s memberships', () => {
  const OTHER = 'tenant-2'
  const everyone = async (query: object = {}) => (await listStaff(db, actor, { ...PAGE, ...query })).items.map(s => s.name)
  let archivedBranchId: string
  let theirBranchId: string

  beforeEach(async () => {
    archivedBranchId = await addBranch('Closed', 'archived')
    await ensureTenant(db, OTHER)
    theirBranchId = newId()
    await insertBranch(db, { id: theirBranchId, name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    // Customers and guests of every cafe, far more than this cafe's staff.
    for (let start = 0; start < 120; start += 12) {
      await db.insert(user).values(Array.from({ length: 12 }, (_, i) => ({ id: `crowd-${start + i}`, name: `Crowd ${start + i}`, email: `crowd${start + i}@example.com` })))
    }
    // Vanna works at three branches (one archived since) and has a repeated membership row (nothing makes the pair unique).
    const vanna = (await createStaff(db, actor, staffInput({ name: 'Vanna', email: 'vanna@example.com', memberships: [{ branchId, role: 'staff' }, { branchId: otherBranchId, role: 'manager' }] }))).staff
    await addBranchStaff(db, archivedBranchId, vanna.id, 'staff')
    await db.insert(member).values({ id: newId(), organizationId: TEST_TENANT, userId: vanna.id, role: 'member', createdAt: new Date() })
    await createStaff(db, actor, staffInput({ name: 'Sophea', email: 'sophea@example.com', memberships: [{ branchId, role: 'staff' }] }))
    const closed = (await createStaff(db, actor, staffInput({ name: 'Closed hand', email: 'closed@example.com', memberships: [] }))).staff
    await addBranchStaff(db, archivedBranchId, closed.id, 'manager')
    // The other cafe: its own owner, and Vanna and a customer working there too.
    await addBranchStaff(db, theirBranchId, vanna.id, 'manager', OTHER)
    await addBranchStaff(db, theirBranchId, 'crowd-1', 'manager', OTHER)
    await db.insert(member).values({ id: newId(), organizationId: OTHER, userId: 'crowd-2', role: 'owner', createdAt: new Date() })
  })

  it('returns each person once, however many branches or membership rows they have', async () => {
    expect(await everyone()).toEqual(['Closed hand', 'Owner', 'Sophea', 'Vanna'])
    expect(await listStaff(db, actor, PAGE)).toMatchObject({ total: 4 })
    expect(await everyone({ role: 'staff' })).toEqual(['Sophea', 'Vanna'])
    expect(await listStaff(db, actor, { ...PAGE, role: 'staff' })).toMatchObject({ total: 2 })
    expect(await everyone({ role: 'manager' })).toEqual(['Closed hand', 'Vanna'])
    expect(await everyone({ branchId })).toEqual(['Sophea', 'Vanna'])
    expect(await everyone({ branchId, search: 'VAN' })).toEqual(['Vanna'])
    expect(await everyone({ branchId, role: 'staff', search: 'a' })).toEqual(['Sophea', 'Vanna'])
    expect((await listStaff(db, actor, { ...PAGE, search: 'a' })).total).toBe(await everyone({ search: 'a' }).then(names => names.length))
  })

  it('keeps people at an archived branch', async () => {
    expect(await everyone({ branchId: archivedBranchId })).toEqual(['Closed hand', 'Vanna'])
    expect(await everyone({ branchId: archivedBranchId, role: 'manager' })).toEqual(['Closed hand'])
  })

  it('answers the admin filter from owners alone, with or without a branch', async () => {
    expect(await everyone({ role: 'admin' })).toEqual(['Owner'])
    expect(await everyone({ role: 'admin', branchId })).toEqual([])
    const [sophea] = (await listStaff(db, actor, { ...PAGE, search: 'sophea' })).items
    await updateStaffAccess(db, actor, sophea!.id, { version: sophea!.version, admin: true, memberships: [{ branchId, role: 'staff' }] })
    expect(await everyone({ role: 'admin', branchId })).toEqual(['Sophea'])
  })

  it('never shows the other cafe\'s people or branches', async () => {
    expect(await everyone({ branchId: theirBranchId })).toEqual([])
    expect(await everyone({ search: 'crowd' })).toEqual([])
    const theirs: Actor = { userId: actor.userId, tenantId: OTHER, role: 'owner' }
    expect((await listStaff(db, theirs, PAGE)).items.map(s => s.name).sort()).toEqual(['Crowd 1', 'Crowd 2', 'Vanna'])
    expect((await listStaff(db, theirs, { ...PAGE, role: 'admin' })).items.map(s => s.name)).toEqual(['Crowd 2'])
    expect((await listStaff(db, theirs, { ...PAGE, role: 'manager' })).items.map(s => s.name)).toEqual(['Crowd 1', 'Vanna'])
    expect((await listStaff(db, theirs, { ...PAGE, branchId })).items).toEqual([])
  })

  it('pages stably: every person once across pages, totals matching', async () => {
    const seen: string[] = []
    for (const page of [1, 2, 3]) {
      const result = await listStaff(db, actor, { page, pageSize: 2 })
      expect(result).toMatchObject({ total: 4, totalPages: 2 })
      seen.push(...result.items.map(s => s.name))
    }
    expect(seen).toEqual(['Closed hand', 'Owner', 'Sophea', 'Vanna'])
  })

  it('looks users up by key from the memberships, never scanning every account', async () => {
    const seen: { sql: string, params: unknown[] }[] = []
    const probe = await createTestDb({ logger: { logQuery: (statement, params) => void seen.push({ sql: statement, params }) } })
    // libsql's logger omits batches: inspect both page statements before they execute (D194).
    const batch = probe.batch.bind(probe)
    probe.batch = ((items) => {
      for (const item of items) {
        seen.push((item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL())
      }
      return batch(items)
    }) as typeof probe.batch
    const plan = (probe as unknown as { $client: { execute: (statement: { sql: string, args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> } }).$client
    const probeBranch = newId()
    await insertBranch(probe, { id: probeBranch, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    const owner = await seedFirstOwner(probe, TEST_TENANT, { name: 'Owner', email: 'owner@example.com' })
    for (let i = 0; i < 30; i++) await createUser(probe, `crowd${i}@example.com`)
    const asOwner: Actor = { userId: owner!.staff.id, tenantId: TEST_TENANT, role: 'owner' }
    const queries: Partial<StaffListQuery>[] = [{}, { search: 'own' }, { role: 'admin' }, { role: 'manager' }, { branchId: probeBranch }, { branchId: probeBranch, role: 'staff', search: 'a' }, { role: 'admin', branchId: probeBranch }]
    for (const query of queries) {
      seen.length = 0
      await listStaff(probe, asOwner, { ...PAGE, ...query })
      const reads = seen.filter(s => /from "user"/.test(s.sql))
      expect(reads, JSON.stringify(query)).toHaveLength(2) // the page and the count
      for (const read of reads) {
        const details = (await plan.execute({ sql: `explain query plan ${read.sql}`, args: read.params })).rows.map(r => String(r.detail))
        expect(details.filter(d => /^SCAN user\b/.test(d)), `${JSON.stringify(query)}: ${details.join(' | ')}`).toEqual([])
      }
    }
  })
})

describe('seed', () => {
  it('creates the cafe (a tenant) once, then finds it', async () => {
    const fresh = await createTestDb()
    const tenant = await seedTenant(fresh, { name: 'NUK Cafe', slug: 'nuk' })
    expect(tenant).toMatchObject({ name: 'NUK Cafe', slug: 'nuk', created: true })
    expect(await seedTenant(fresh, { name: 'Other', slug: 'other' })).toEqual({ ...tenant, created: false })
  })

  it('creates the cafe\'s first owner once, then does nothing', async () => {
    const fresh = await createTestDb()
    const { id } = await seedTenant(fresh, { name: 'NUK Cafe', slug: 'nuk' })
    const first = await seedFirstOwner(fresh, id, { name: 'Owner', email: ' Owner@Example.com ' })
    expect(first).toMatchObject({ staff: { email: 'owner@example.com', admin: true, mustChangePassword: true } })
    expect(first!.temporaryPassword).toBeTruthy()
    expect(await seedFirstOwner(fresh, id, { name: 'Other', email: 'other@example.com' })).toBeNull()
  })

  it('creates a demo branch only while the cafe has none', async () => {
    const fresh = await createTestDb()
    const { id } = await seedTenant(fresh, { name: 'NUK Cafe', slug: 'nuk' })
    expect(await seedDemoBranch(fresh, id, { timezone: 'Asia/Phnom_Penh' })).toMatchObject({ name: 'Main branch' })
    expect(await seedDemoBranch(fresh, id, { timezone: 'Asia/Phnom_Penh' })).toBeNull()
  })
})

// One account can belong to several cafes (D134): each cafe manages its own memberships, sees only
// its own people, and can't change what the account means elsewhere.
describe('tenants', () => {
  const OTHER = 'tenant-2'
  let theirs: Actor
  let theirBranch: string

  beforeEach(async () => {
    await ensureTenant(db, OTHER)
    theirBranch = newId()
    await insertBranch(db, { id: theirBranch, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    const owner = await seedFirstOwner(db, OTHER, { name: 'Their owner', email: 'their-owner@example.com' })
    theirs = { userId: owner!.staff.id, tenantId: OTHER, role: 'owner' }
  })

  it('lists only the cafe\'s own people, and another cafe\'s person is 404 to every action', async () => {
    const ours = await createStaff(db, actor, staffInput())
    expect((await listStaff(db, theirs, PAGE)).items.map(s => s.email)).toEqual(['their-owner@example.com'])
    expect(await failure(getStaffMember(db, theirs, ours.staff.id))).toEqual({ status: 404, code: 'NOT_FOUND' })
    const version = { version: ours.staff.version }
    expect(await failure(updateStaffAccess(db, theirs, ours.staff.id, { ...version, admin: false, memberships: [{ branchId: theirBranch, role: 'staff' }] }))).toEqual({ status: 404, code: 'NOT_FOUND' })
    expect(await failure(disableStaff(db, theirs, ours.staff.id, version))).toEqual({ status: 404, code: 'NOT_FOUND' })
    expect(await failure(resetStaffPassword(db, theirs, ours.staff.id, version))).toEqual({ status: 404, code: 'NOT_FOUND' })
    // Nothing changed here.
    expect(await getStaffMember(db, actor, ours.staff.id)).toEqual(ours.staff)
  })

  it('searches only the cafe\'s own people, also with a search past 50 bytes', async () => {
    const long = 'Long name '.repeat(8).trim()
    await createStaff(db, actor, staffInput({ name: long, email: 'mine@example.com' }))
    await createStaff(db, theirs, staffInput({ name: long, email: 'their-long@example.com', memberships: [{ branchId: theirBranch, role: 'staff' }] }))
    expect((await listStaff(db, actor, { ...PAGE, search: long })).items.map(s => s.email)).toEqual(['mine@example.com'])
    expect((await listStaff(db, theirs, { ...PAGE, search: long })).items.map(s => s.email)).toEqual(['their-long@example.com'])
    expect((await listStaff(db, theirs, { ...PAGE, search: 'mine@' })).total).toBe(0)
  })

  it('refuses another cafe\'s branch as an unknown one', async () => {
    const error = await createStaff(db, actor, staffInput({ memberships: [{ branchId: theirBranch, role: 'staff' }] })).catch((e: { data: { fieldErrors: object } }) => e)
    expect(Object.keys((error as { data: { fieldErrors: object } }).data.fieldErrors)).toEqual(['memberships.0.branchId'])
  })

  it('adds someone who works at another cafe, keeping their password and their other access', async () => {
    const elsewhere = await createStaff(db, theirs, staffInput({ memberships: [{ branchId: theirBranch, role: 'manager' }] }))
    const here = await createStaff(db, actor, staffInput())
    expect(here.temporaryPassword).toBeNull()
    expect(here.staff).toMatchObject({ id: elsewhere.staff.id, memberships: [{ branchId, role: 'staff' }] })
    expect((await getStaffMember(db, theirs, elsewhere.staff.id)).memberships).toEqual([{ branchId: theirBranch, branchName: 'Their branch', role: 'manager' }])

    // Disabling them here leaves the other cafe's access.
    await disableStaff(db, actor, here.staff.id, { version: here.staff.version })
    expect(await failure(getStaffMember(db, actor, here.staff.id))).toEqual({ status: 404, code: 'NOT_FOUND' })
    expect((await getStaffMember(db, theirs, elsewhere.staff.id)).memberships).toHaveLength(1)
  })

  it('won\'t reset the password of someone with access to another cafe, or of a super admin: it opens every cafe', async () => {
    const elsewhere = await createStaff(db, theirs, staffInput({ memberships: [{ branchId: theirBranch, role: 'staff' }] }))
    const here = await createStaff(db, actor, staffInput())
    await expectApiError(() => resetStaffPassword(db, actor, here.staff.id, { version: here.staff.version }), 409, 'STAFF_ELSEWHERE')
    await expectApiError(() => resetStaffPassword(db, theirs, elsewhere.staff.id, { version: here.staff.version }), 409, 'STAFF_ELSEWHERE')

    const platform = await createStaff(db, actor, staffInput({ name: 'Kim', email: 'kim@example.com' }))
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, platform.staff.id))
    const [current] = (await listStaff(db, actor, { ...PAGE, search: 'kim' })).items
    await expectApiError(() => resetStaffPassword(db, actor, platform.staff.id, { version: current!.version }), 409, 'STAFF_ELSEWHERE')
  })

  it('counts owners per cafe: another cafe\'s owner doesn\'t keep this one from losing its last', async () => {
    const owner = (await listStaff(db, actor, { ...PAGE, search: 'owner@' })).items[0]!
    // The other cafe's owner also works here, as an owner…
    const second = await createStaff(db, actor, staffInput({ email: 'their-owner@example.com', admin: true, memberships: [] }))
    // …demotes our first owner, then is demoted: refused, this cafe would have no owner left.
    const secondActor: Actor = { userId: second.staff.id, tenantId: TEST_TENANT, role: 'owner' }
    await updateStaffAccess(db, secondActor, actor.userId, { version: owner.version, admin: false, memberships: [{ branchId, role: 'staff' }] })
    const [demoted] = (await listStaff(db, actor, { ...PAGE, search: 'their-owner' })).items
    await expectApiError(() => updateStaffAccess(db, actor, second.staff.id, { version: demoted!.version, admin: false, memberships: [{ branchId, role: 'staff' }] }), 409, 'LAST_ADMIN')
    expect((await db.select().from(member).where(eq(member.role, 'owner'))).length).toBe(2)
  })

  it('a branch staff row is the tenant\'s: the database refuses one for another cafe\'s branch', async () => {
    const someone = await createStaff(db, actor, staffInput())
    await expect(addBranchStaff(db, theirBranch, someone.staff.id, 'staff', TEST_TENANT)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/FOREIGN KEY/) } })
  })
})
