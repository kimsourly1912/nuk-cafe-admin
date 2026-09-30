import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { createStaffSchema, updateStaffAccessSchema } from '#shared/contracts/staff'
import type { CreateStaffInput } from '#shared/contracts/staff'
import { seedDemoBranch } from '../../branches'
import { auditEvents, organization, user } from '../../../db/tables'
import { newId } from '../../../utils/ids'
import type { Db } from '../../../utils/batch'
import { createTestAuth, signIn } from '../../../tests/support/auth'
import type { TestAuth } from '../../../tests/support/auth'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError, failure } from '../../../tests/support/failure'
import { createStaff, disableStaff, listStaff, resetStaffPassword, seedFirstAdmin, updateStaffAccess } from '../staff.service'
import type { Actor } from '../identity.types'

let db: Db
let auth: TestAuth
let branchId: string
let otherBranchId: string
let actor: Actor

async function addBranch(name: string, status = 'active') {
  const id = newId()
  await db.insert(organization).values({ id, name, slug: id, timezone: 'Asia/Phnom_Penh', status, createdAt: new Date() })
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
  const seeded = await seedFirstAdmin(db, { name: 'Owner', email: 'owner@example.com' })
  actor = { userId: seeded!.staff.id, role: 'admin' }
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
    const [current] = (await listStaff(db, { ...PAGE, search: 'sophea' })).items
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

    const owner = (await listStaff(db, { ...PAGE, search: 'owner' })).items[0]!
    await expectApiError(() => updateStaffAccess(db, actor, actor.userId, { version: owner.version, admin: false, memberships: [{ branchId, role: 'manager' }] }), 409, 'OWN_ACCESS')
  })

  it('keeps the admin\'s own session when they change their own branches', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)
    const self: Actor = { userId: created.staff.id, role: 'admin' }
    await updateStaffAccess(db, self, created.staff.id, { version: created.staff.version, admin: true, memberships: [{ branchId, role: 'manager' }] })
    expect(await auth.api.getSession({ headers })).not.toBeNull()
  })

  it('never leaves the cafe without an admin, even when two admins demote each other at once', async () => {
    const second = await createStaff(db, actor, staffInput({ admin: true, memberships: [] }))
    const owner = (await listStaff(db, { ...PAGE, search: 'owner' })).items[0]!
    // Both read each other's version, then both save: the owner demotes the second admin first…
    await updateStaffAccess(db, actor, second.staff.id, { version: second.staff.version, admin: false, memberships: [{ branchId, role: 'staff' }] })
    // …and the second admin's request, already past its permission check, demotes the owner.
    const secondActor: Actor = { userId: second.staff.id, role: 'admin' }
    await expectApiError(() => updateStaffAccess(db, secondActor, actor.userId, { version: owner.version, admin: false, memberships: [{ branchId, role: 'staff' }] }), 409, 'LAST_ADMIN')
    expect((await listStaff(db, { ...PAGE, role: 'admin' })).total).toBe(1)
  })
})

describe('disable', () => {
  it('takes all access away and signs the person out; the account stays a customer', async () => {
    const created = await createStaff(db, actor, staffInput({ admin: true, memberships: [{ branchId, role: 'manager' }] }))
    const headers = await signIn(auth, 'sophea@example.com', created.temporaryPassword!)

    await disableStaff(db, actor, created.staff.id, { version: created.staff.version })

    expect(await auth.api.getSession({ headers })).toBeNull()
    expect((await listStaff(db, PAGE)).items.map(s => s.email)).toEqual(['owner@example.com'])
    const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, created.staff.id))
    expect(row!.role).toBe('customer')
    // They can still sign in, as a customer.
    await expect(signIn(auth, 'sophea@example.com', created.temporaryPassword!)).resolves.toBeDefined()
  })

  it('refuses disabling oneself, and a stale version', async () => {
    const owner = (await listStaff(db, { ...PAGE, search: 'owner' })).items[0]!
    await expectApiError(() => disableStaff(db, actor, actor.userId, { version: owner.version }), 409, 'OWN_ACCESS')

    const created = await createStaff(db, actor, staffInput())
    await expectApiError(() => disableStaff(db, actor, created.staff.id, { version: created.staff.version - 1 }), 409, 'VERSION_CONFLICT')
  })

  it('answers 404 for an unknown account', async () => {
    expect(await failure(disableStaff(db, actor, newId(), { version: 1 }))).toEqual({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('reset password (step 10.1, D115)', () => {
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
    const [current] = (await listStaff(db, { ...PAGE, search: 'sophea' })).items
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
    const owner = (await listStaff(db, { ...PAGE, search: 'owner' })).items[0]!
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
    const secondActor: Actor = { userId: second.staff.id, role: 'admin' }
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
    const page = await listStaff(db, PAGE)
    expect(page.items.map(s => s.name)).toEqual(['Owner', 'Sophea', 'Vanna'])
    expect(page.items[2]!.memberships.map(m => m.branchName)).toEqual(['Airport', 'Riverside'])
    expect(page).toMatchObject({ total: 3, totalPages: 1 })
  })

  it('filters by role, branch and search, and paginates', async () => {
    expect((await listStaff(db, { ...PAGE, role: 'admin' })).items.map(s => s.name)).toEqual(['Owner'])
    expect((await listStaff(db, { ...PAGE, role: 'manager' })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, { ...PAGE, branchId: otherBranchId })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, { ...PAGE, branchId, role: 'manager' })).items).toEqual([])
    expect((await listStaff(db, { ...PAGE, search: 'VANNA@' })).items.map(s => s.name)).toEqual(['Vanna'])
    expect((await listStaff(db, { ...PAGE, search: '%' })).items).toEqual([])
    expect(await listStaff(db, { page: 2, pageSize: 2 })).toMatchObject({ items: [{ name: 'Vanna' }], total: 3, totalPages: 2 })
  })
})

describe('seed', () => {
  it('creates the first admin once, then does nothing', async () => {
    const fresh = await createTestDb()
    const first = await seedFirstAdmin(fresh, { name: 'Owner', email: ' Owner@Example.com ' })
    expect(first).toMatchObject({ staff: { email: 'owner@example.com', admin: true, mustChangePassword: true } })
    expect(first!.temporaryPassword).toBeTruthy()
    expect(await seedFirstAdmin(fresh, { name: 'Other', email: 'other@example.com' })).toBeNull()
  })

  it('creates a demo branch only while there is none', async () => {
    const fresh = await createTestDb()
    expect(await seedDemoBranch(fresh, { timezone: 'Asia/Phnom_Penh' })).toMatchObject({ name: 'Main branch' })
    expect(await seedDemoBranch(fresh, { timezone: 'Asia/Phnom_Penh' })).toBeNull()
  })
})
