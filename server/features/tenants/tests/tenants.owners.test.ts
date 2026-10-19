import { and, count, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AddOwnerInput } from '#shared/contracts/tenants'
import { addOwnerSchema, tenantListQuerySchema, updateTenantNotesSchema } from '#shared/contracts/tenants'
import type { Db } from '#server/utils/batch'
import { auditEvents, branchStaff, member, organization, session, user } from '#server/db/tables'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { addBranchStaff, createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { createTestAuth, signIn } from '#server/tests/support/auth'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import { banAccount, disableStaff, updateStaffAccess } from '#server/features/identity'
import { addOwner, getTenant, listTenants, removeOwner, transferOwner, updateTenantNotes } from '#server/features/tenants'
import { tenantNotes } from '#server/features/tenants/tenants.schema'

// A cafe's owners and internal notes in the platform console (step P2, D189): add, remove and
// transfer, each one batch with the cafe's version, the accounts' guards, the last-owner guard and
// the audit row. Against SQLite built from the migrations; every query is checked with two cafes.

let db: Db
const SUPER = 'superadmin-1'
const actor = { userId: SUPER, requestId: 'req-1' }
const OTHER = 'tenant-2'
const REASON = 'The owner asked by phone'

const versionOf = async (tenantId = TEST_TENANT) => (await getTenant(db, tenantId)).version
const roleIn = async (userId: string, tenantId = TEST_TENANT) =>
  (await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))))[0]?.role
const existing = (userId: string): AddOwnerInput['owner'] => ({ kind: 'existing', userId })
const addInput = async (owner: AddOwnerInput['owner'], tenantId = TEST_TENANT) => v.parse(addOwnerSchema, { version: await versionOf(tenantId), reason: REASON, owner })
const removeInput = async (tenantId = TEST_TENANT) => ({ version: await versionOf(tenantId), reason: REASON })
const auditsOf = (action: string) => db.select({ tenantId: auditEvents.tenantId, actorId: auditEvents.actorId, metadata: auditEvents.metadata }).from(auditEvents).where(eq(auditEvents.action, action))
const ban = (userId: string) => db.update(user).set({ banned: true }).where(eq(user.id, userId))
/** A ban that keeps the account's version (a ban set by hand): only an in-batch state guard can catch it. */
async function banKeepingVersion(userId: string) {
  const [row] = await db.select({ at: user.updatedAt }).from(user).where(eq(user.id, userId))
  await db.update(user).set({ banned: true, updatedAt: row!.at }).where(eq(user.id, userId))
}
const ownerActor = (userId: string) => ({ userId, tenantId: TEST_TENANT, role: 'owner' as const })

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await ensureTenant(db, OTHER, 'brown-bean')
  await db.insert(user).values({ id: SUPER, email: 'super@example.com', name: 'Super', role: 'superadmin' })
})

describe('adding an owner', () => {
  it('makes an existing account an owner, keeping its password, with the reason in the cafe\'s audit row', async () => {
    await createAdmin(db, 'first@example.com')
    const customer = await createUser(db, 'dara@example.com', 'Dara')
    const before = await versionOf()

    const { tenant, temporaryPassword } = await addOwner(db, actor, TEST_TENANT, await addInput(existing(customer.id)))

    expect(temporaryPassword).toBeNull()
    expect(tenant.version).toBe(before + 1)
    expect(tenant.activeOwners).toBe(2)
    expect(tenant.owners.find(o => o.id === customer.id)).toMatchObject({ name: 'Dara', banned: false, staffAccess: false })
    expect(await roleIn(customer.id)).toBe('owner')
    expect(await db.select({ n: count() }).from(customerProfiles).where(and(eq(customerProfiles.tenantId, TEST_TENANT), eq(customerProfiles.userId, customer.id)))).toEqual([{ n: 1 }])
    expect(await auditsOf('tenant.owner.add')).toEqual([{ tenantId: TEST_TENANT, actorId: SUPER, metadata: { ownerId: customer.id, newAccount: false, reason: REASON } }])
    // The other cafe is untouched.
    expect(await roleIn(customer.id, OTHER)).toBeUndefined()
  })

  it('keeps a staff member\'s branch roles', async () => {
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    const staff = await createUser(db, 'sokha@example.com', 'Sokha')
    await addBranchStaff(db, 'branch-1', staff.id, 'manager')

    const { tenant } = await addOwner(db, actor, TEST_TENANT, await addInput(existing(staff.id)))
    expect(tenant.owners).toEqual([expect.objectContaining({ id: staff.id, staffAccess: true })])
    expect(await db.select({ role: branchStaff.role }).from(branchStaff).where(eq(branchStaff.userId, staff.id))).toEqual([{ role: 'manager' }])
    expect(await db.select({ n: count() }).from(member).where(eq(member.userId, staff.id))).toEqual([{ n: 1 }])
  })

  it('gives a new account a temporary password that signs in', async () => {
    const { tenant, temporaryPassword } = await addOwner(db, actor, TEST_TENANT, await addInput({ kind: 'new', name: 'Bea Brown', email: 'Bea@Example.com' }))
    expect(temporaryPassword).toBeTruthy()
    const [bea] = await db.select().from(user).where(eq(user.email, 'bea@example.com'))
    expect(bea!.mustChangePassword).toBe(true)
    expect(tenant.owners.map(o => o.id)).toEqual([bea!.id])
    await signIn(createTestAuth(db), 'bea@example.com', temporaryPassword!)
    expect((await auditsOf('tenant.owner.add'))[0]!.metadata).toMatchObject({ ownerId: bea!.id, newAccount: true })
  })

  it('a new person whose email has an account is refused on the email; nothing is saved', async () => {
    await createUser(db, 'bea@example.com', 'Bea')
    const before = await versionOf()
    await expectApiError(async () => addOwner(db, actor, TEST_TENANT, await addInput({ kind: 'new', name: 'Bea', email: 'bea@example.com' })), 409, 'ACCOUNT_EXISTS', ['owner.email'])
    expect(await versionOf()).toBe(before)
    expect(await db.select({ n: count() }).from(member)).toEqual([{ n: 0 }])
  })

  it('refuses an owner already, a banned account, a guest, one\'s own account and an unknown cafe', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    const banned = await createUser(db, 'gone@example.com')
    await ban(banned.id)
    await db.insert(user).values({ id: 'guest-1', email: 'guest@anon.example', name: 'Guest', isAnonymous: true })
    await expectApiError(async () => addOwner(db, actor, TEST_TENANT, await addInput(existing(owner.userId))), 409, 'ALREADY_OWNER', ['owner.userId'])
    await expectApiError(async () => addOwner(db, actor, TEST_TENANT, await addInput(existing(banned.id))), 422, 'VALIDATION_FAILED', ['owner.userId'])
    await expectApiError(async () => addOwner(db, actor, TEST_TENANT, await addInput(existing('guest-1'))), 422, 'VALIDATION_FAILED', ['owner.userId'])
    // QT4 lets a super admin own a cafe, but never by adding themselves.
    await expectApiError(async () => addOwner(db, actor, TEST_TENANT, await addInput(existing(SUPER))), 409, 'OWN_ACCOUNT')
    await expectApiError(async () => addOwner(db, actor, 'tenant-404', { ...(await addInput(existing(banned.id))) }), 404, 'NOT_FOUND')
    expect(await auditsOf('tenant.owner.add')).toEqual([])
  })

  it('another super admin may be made an owner (QT4, 2026-10-19)', async () => {
    await db.insert(user).values({ id: 'superadmin-2', email: 'second@example.com', name: 'Second', role: 'superadmin' })
    await addOwner(db, actor, TEST_TENANT, await addInput(existing('superadmin-2')))
    expect(await roleIn('superadmin-2')).toBe('owner')
  })

  it('an owner of another cafe becomes an owner here too, keeping the other', async () => {
    const other = await createAdmin(db, 'other@example.com', OTHER)
    await addOwner(db, actor, TEST_TENANT, await addInput(existing(other.userId)))
    expect([await roleIn(other.userId), await roleIn(other.userId, OTHER)]).toEqual(['owner', 'owner'])
  })

  it('a stale version is 409 and changes nothing', async () => {
    const customer = await createUser(db, 'dara@example.com')
    const input = await addInput(existing(customer.id))
    await db.update(organization).set({ version: input.version + 1 }).where(eq(organization.id, TEST_TENANT))
    await expectApiError(() => addOwner(db, actor, TEST_TENANT, input), 409, 'VERSION_CONFLICT')
    expect(await roleIn(customer.id)).toBeUndefined()
  })

  it('an account banned between the check and the save is refused in the batch', async () => {
    const customer = await createUser(db, 'dara@example.com')
    const input = await addInput(existing(customer.id))
    // The ban keeps the account's version, so only the eligibility guard can catch it.
    const racing = interleaved(db, () => banKeepingVersion(customer.id))
    await expectApiError(() => addOwner(racing, actor, TEST_TENANT, input), 422, 'VALIDATION_FAILED', ['owner.userId'])
    expect(await roleIn(customer.id)).toBeUndefined()
  })

  it('an account made with the new owner\'s email during the save is refused on the email', async () => {
    const input = await addInput({ kind: 'new', name: 'Bea', email: 'bea@example.com' })
    const racing = interleaved(db, () => createUser(db, 'bea@example.com'))
    await expectApiError(() => addOwner(racing, actor, TEST_TENANT, input), 409, 'ACCOUNT_EXISTS', ['owner.email'])
    expect(await db.select({ n: count() }).from(member)).toEqual([{ n: 0 }])
  })
})

describe('removing an owner', () => {
  it('takes the ownership away, signs them out, and keeps their branch role', async () => {
    const auth = createTestAuth(db)
    await createAdmin(db, 'first@example.com')
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    const { user: second } = await auth.api.signUpEmail({ body: { email: 'second@example.com', password: 'the password 1', name: 'Second' } })
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: TEST_TENANT, userId: second.id, role: 'owner', createdAt: new Date() })
    await db.insert(branchStaff).values({ tenantId: TEST_TENANT, branchId: 'branch-1', userId: second.id, role: 'staff', createdAt: new Date() })
    await signIn(auth, 'second@example.com', 'the password 1')

    const { tenant } = await removeOwner(db, actor, TEST_TENANT, second.id, await removeInput())
    expect(tenant.owners.map(o => o.email)).toEqual(['first@example.com'])
    expect(await roleIn(second.id)).toBe('member')
    expect(await db.select({ role: branchStaff.role }).from(branchStaff).where(eq(branchStaff.userId, second.id))).toEqual([{ role: 'staff' }])
    expect(await db.select().from(session).where(eq(session.userId, second.id))).toEqual([])
    expect(await auditsOf('tenant.owner.remove')).toEqual([{ tenantId: TEST_TENANT, actorId: SUPER, metadata: { ownerId: second.id, staysStaff: true, reason: REASON } }])
  })

  it('without a branch role, no access is left here; their other cafe stays theirs', async () => {
    await createAdmin(db, 'first@example.com')
    const both = await createAdmin(db, 'both@example.com')
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: OTHER, userId: both.userId, role: 'owner', createdAt: new Date() })
    await removeOwner(db, actor, TEST_TENANT, both.userId, await removeInput())
    expect([await roleIn(both.userId), await roleIn(both.userId, OTHER)]).toEqual([undefined, 'owner'])
  })

  it('a banned owner can be removed while another owner can sign in', async () => {
    await createAdmin(db, 'first@example.com')
    const banned = await createAdmin(db, 'gone@example.com')
    await ban(banned.userId)
    await removeOwner(db, actor, TEST_TENANT, banned.userId, await removeInput())
    expect(await roleIn(banned.userId)).toBeUndefined()
  })

  it('never leaves the cafe without an owner who can sign in', async () => {
    const only = await createAdmin(db, 'only@example.com')
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, only.userId, await removeInput()), 409, 'LAST_OWNER')
    // The other owner is banned: they don't count.
    const banned = await createAdmin(db, 'gone@example.com')
    await ban(banned.userId)
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, only.userId, await removeInput()), 409, 'LAST_OWNER')
    // Nobody can sign in: removing the banned one would still leave none, so transfer instead.
    await ban(only.userId)
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, banned.userId, await removeInput()), 409, 'LAST_OWNER')
    expect(await auditsOf('tenant.owner.remove')).toEqual([])
  })

  it('refuses one\'s own ownership, someone who isn\'t an owner here and another cafe\'s owner', async () => {
    await createAdmin(db, 'first@example.com')
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: TEST_TENANT, userId: SUPER, role: 'owner', createdAt: new Date() })
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, SUPER, await removeInput()), 409, 'OWN_ACCOUNT')
    const customer = await createUser(db, 'dara@example.com')
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, customer.id, await removeInput()), 404, 'NOT_FOUND')
    const elsewhere = await createAdmin(db, 'other@example.com', OTHER)
    await createAdmin(db, 'other2@example.com', OTHER)
    await expectApiError(async () => removeOwner(db, actor, TEST_TENANT, elsewhere.userId, await removeInput()), 404, 'NOT_FOUND')
    expect(await roleIn(elsewhere.userId, OTHER)).toBe('owner')
  })

  it('two super admins removing the two owners at once: the second is stale, one owner stays', async () => {
    const a = await createAdmin(db, 'a@example.com')
    const b = await createAdmin(db, 'b@example.com')
    await createAdmin(db, 'c@example.com')
    const input = await removeInput()
    await removeOwner(db, actor, TEST_TENANT, a.userId, input)
    await expectApiError(() => removeOwner(db, { userId: 'superadmin-2' }, TEST_TENANT, b.userId, input), 409, 'VERSION_CONFLICT')
    expect(await roleIn(b.userId)).toBe('owner')
  })

  it('removed here while the other owner is disabled in the cafe\'s admin: the batch keeps one owner', async () => {
    const a = await createAdmin(db, 'a@example.com')
    const b = await createAdmin(db, 'b@example.com')
    const input = await removeInput()
    // B, in the admin, disables A between the console's checks and its save: the cafe's version doesn't move.
    const aVersion = (await db.select({ at: user.updatedAt }).from(user).where(eq(user.id, a.userId)))[0]!.at.getTime()
    const racing = interleaved(db, () => disableStaff(db, ownerActor(b.userId), a.userId, { version: aVersion }))
    await expectApiError(() => removeOwner(racing, actor, TEST_TENANT, b.userId, input), 409, 'LAST_OWNER')
    expect([await roleIn(a.userId), await roleIn(b.userId)]).toEqual([undefined, 'owner'])
  })

  it('removed while the other owner is banned meanwhile: refused in the batch', async () => {
    const a = await createAdmin(db, 'a@example.com')
    const b = await createAdmin(db, 'b@example.com')
    const input = await removeInput()
    const aVersion = (await db.select({ at: user.updatedAt }).from(user).where(eq(user.id, a.userId)))[0]!.at.getTime()
    const racing = interleaved(db, () => banAccount(db, { userId: 'superadmin-2' }, a.userId, { version: aVersion, reason: 'Fraud' }))
    await expectApiError(() => removeOwner(racing, actor, TEST_TENANT, b.userId, input), 409, 'LAST_OWNER')
    expect(await roleIn(b.userId)).toBe('owner')
  })

  it('their access changed in the admin meanwhile: refused on the account\'s version, the branch role kept', async () => {
    const a = await createAdmin(db, 'a@example.com')
    const b = await createAdmin(db, 'b@example.com')
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    const input = await removeInput()
    const bVersion = (await db.select({ at: user.updatedAt }).from(user).where(eq(user.id, b.userId)))[0]!.at.getTime()
    // A gives B a branch role after the console read B as an owner without one.
    const racing = interleaved(db, () => updateStaffAccess(db, ownerActor(a.userId), b.userId, { version: bVersion, admin: true, memberships: [{ branchId: 'branch-1', role: 'manager' }] }))
    await expectApiError(() => removeOwner(racing, actor, TEST_TENANT, b.userId, input), 409, 'VERSION_CONFLICT')
    expect(await roleIn(b.userId)).toBe('owner')
    expect(await db.select({ role: branchStaff.role }).from(branchStaff).where(eq(branchStaff.userId, b.userId))).toEqual([{ role: 'manager' }])
  })
})

describe('transferring ownership', () => {
  it('adds the new owner and removes the old one in one batch, from a banned owner too', async () => {
    const old = await createAdmin(db, 'old@example.com')
    await ban(old.userId)
    expect((await getTenant(db, TEST_TENANT)).activeOwners).toBe(0)
    const next = await createUser(db, 'next@example.com', 'Next')

    const { tenant, temporaryPassword } = await transferOwner(db, actor, TEST_TENANT, old.userId, await addInput(existing(next.id)))
    expect(temporaryPassword).toBeNull()
    expect(tenant.owners.map(o => o.id)).toEqual([next.id])
    expect(tenant.activeOwners).toBe(1)
    expect(await roleIn(old.userId)).toBeUndefined()
    expect(await auditsOf('tenant.owner.transfer')).toEqual([{ tenantId: TEST_TENANT, actorId: SUPER, metadata: { fromId: old.userId, toId: next.id, newAccount: false, staysStaff: false, reason: REASON } }])
  })

  it('to a new account, with its temporary password', async () => {
    const old = await createAdmin(db, 'old@example.com')
    const { tenant, temporaryPassword } = await transferOwner(db, actor, TEST_TENANT, old.userId, await addInput({ kind: 'new', name: 'Bea', email: 'bea@example.com' }))
    expect(temporaryPassword).toBeTruthy()
    expect(tenant.owners.map(o => o.email)).toEqual(['bea@example.com'])
  })

  it('refuses an owner already, one\'s own account either way, and someone who isn\'t an owner here', async () => {
    const old = await createAdmin(db, 'old@example.com')
    const other = await createAdmin(db, 'other@example.com')
    const customer = await createUser(db, 'dara@example.com')
    await expectApiError(async () => transferOwner(db, actor, TEST_TENANT, old.userId, await addInput(existing(other.userId))), 409, 'ALREADY_OWNER', ['owner.userId'])
    await expectApiError(async () => transferOwner(db, actor, TEST_TENANT, old.userId, await addInput(existing(old.userId))), 409, 'ALREADY_OWNER', ['owner.userId'])
    await expectApiError(async () => transferOwner(db, actor, TEST_TENANT, old.userId, await addInput(existing(SUPER))), 409, 'OWN_ACCOUNT')
    await expectApiError(async () => transferOwner(db, actor, TEST_TENANT, customer.id, await addInput(existing(other.userId))), 404, 'NOT_FOUND')
    const elsewhere = await createAdmin(db, 'elsewhere@example.com', OTHER)
    await expectApiError(async () => transferOwner(db, actor, TEST_TENANT, elsewhere.userId, await addInput(existing(customer.id))), 404, 'NOT_FOUND')
    expect([await roleIn(old.userId), await roleIn(customer.id), await roleIn(elsewhere.userId, OTHER)]).toEqual(['owner', undefined, 'owner'])
  })

  it('the new owner banned during the save: nothing changes, the old owner stays', async () => {
    const old = await createAdmin(db, 'old@example.com')
    const next = await createUser(db, 'next@example.com')
    const input = await addInput(existing(next.id))
    const racing = interleaved(db, () => banKeepingVersion(next.id))
    await expectApiError(() => transferOwner(racing, actor, TEST_TENANT, old.userId, input), 422, 'VALIDATION_FAILED', ['owner.userId'])
    expect([await roleIn(old.userId), await roleIn(next.id)]).toEqual(['owner', undefined])
  })
})

describe('no active owner', () => {
  it('is counted per cafe and filters the Cafes list, two cafes apart', async () => {
    const banned = await createAdmin(db, 'gone@example.com')
    await ban(banned.userId)
    await createAdmin(db, 'fine@example.com', OTHER)
    await ensureTenant(db, 'tenant-3', 'empty-cafe')

    const all = await listTenants(db, v.parse(tenantListQuerySchema, {}))
    expect(Object.fromEntries(all.items.map(t => [t.id, t.activeOwners]))).toEqual({ [TEST_TENANT]: 0, [OTHER]: 1, 'tenant-3': 0 })
    const ownerless = await listTenants(db, v.parse(tenantListQuerySchema, { owner: 'none' }))
    expect(ownerless.items.map(t => t.id).sort()).toEqual([TEST_TENANT, 'tenant-3'])
    expect(ownerless.total).toBe(2)
    expect((await listTenants(db, v.parse(tenantListQuerySchema, { owner: 'none', search: 'empty' }))).items.map(t => t.id)).toEqual(['tenant-3'])
  })
})

describe('internal notes', () => {
  const notes = (version: number, values: Record<string, unknown> = {}) =>
    v.parse(updateTenantNotesSchema, { version, contactName: 'Bea Brown', contactPhone: '+855 12 345 678', notes: 'Prefers Telegram.', ...values })

  it('are saved, versioned and audited by field name only, per cafe', async () => {
    expect((await getTenant(db, TEST_TENANT)).notes).toEqual({ contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null })
    const first = await updateTenantNotes(db, actor, TEST_TENANT, notes(0))
    expect(first.notes).toMatchObject({ contactName: 'Bea Brown', contactPhone: '+85512345678', notes: 'Prefers Telegram.', version: 1 })
    const second = await updateTenantNotes(db, actor, TEST_TENANT, notes(1, { contactPhone: '', notes: '  ' }))
    expect(second.notes).toMatchObject({ contactName: 'Bea Brown', contactPhone: null, notes: null, version: 2 })
    // The cafe's own version doesn't move: a note never conflicts with a pause.
    expect(second.version).toBe(first.version)
    // Another cafe's notes are its own.
    expect((await getTenant(db, OTHER)).notes.version).toBe(0)
    expect(await db.select({ tenantId: tenantNotes.tenantId, updatedBy: tenantNotes.updatedBy }).from(tenantNotes)).toEqual([{ tenantId: TEST_TENANT, updatedBy: SUPER }])
    expect((await auditsOf('tenant.notes.update')).map(row => row.metadata)).toEqual([
      { fields: ['contactName', 'contactPhone', 'notes'] },
      { fields: ['contactPhone', 'notes'] },
    ])
  })

  it('a stale version is 409; two first saves at once: the second is 409', async () => {
    await updateTenantNotes(db, actor, TEST_TENANT, notes(0))
    await expectApiError(() => updateTenantNotes(db, actor, TEST_TENANT, notes(0)), 409, 'VERSION_CONFLICT')
    await expectApiError(() => updateTenantNotes(db, actor, TEST_TENANT, notes(2)), 409, 'VERSION_CONFLICT')

    const racing = interleaved(db, () => updateTenantNotes(db, actor, OTHER, notes(0, { notes: 'First' })))
    await expectApiError(() => updateTenantNotes(racing, actor, OTHER, notes(0, { notes: 'Second' })), 409, 'VERSION_CONFLICT')
    expect((await getTenant(db, OTHER)).notes.notes).toBe('First')
  })

  it('a save at the version read loses to one made meanwhile', async () => {
    await updateTenantNotes(db, actor, TEST_TENANT, notes(0))
    const racing = interleaved(db, () => updateTenantNotes(db, actor, TEST_TENANT, notes(1, { notes: 'Theirs' })))
    await expectApiError(() => updateTenantNotes(racing, actor, TEST_TENANT, notes(1, { notes: 'Mine' })), 409, 'VERSION_CONFLICT')
    expect((await getTenant(db, TEST_TENANT)).notes.notes).toBe('Theirs')
  })

  it('refuses a phone that isn\'t one, and an unknown cafe', async () => {
    expect(v.safeParse(updateTenantNotesSchema, { version: 0, contactName: '', contactPhone: '12', notes: '' }).success).toBe(false)
    await expectApiError(() => updateTenantNotes(db, actor, 'tenant-404', notes(0)), 404, 'NOT_FOUND')
  })
})
