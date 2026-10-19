import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import { activityQuerySchema } from '#shared/contracts/platform-activity'
import type { Db } from '#server/utils/batch'
import { auditEvents, organization, user } from '#server/db/tables'
import { orders } from '#server/features/orders/orders.schema'
import { createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { banAccount } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { addOwner, getPlatformOverview, getTenant, listPlatformActivity, suspendTenant, updateCafeSettings, updateTenantNotes } from '#server/features/tenants'

// The platform console's Overview and Activity (step P3, D191), against SQLite built from the
// migrations: counts only, and only the platform team's own audit rows, two cafes apart.

let db: Db
const SUPER = '0a1b2c3d-0000-4000-8000-0000000000a1'
const SECOND = '0a1b2c3d-0000-4000-8000-0000000000a2'
const actor = { userId: SUPER, requestId: 'req-1' }
const OTHER = 'tenant-2'
const ZONE = 'Asia/Phnom_Penh'

const query = (overrides: Record<string, string> = {}) => v.parse(activityQuerySchema, overrides)
const actions = async (overrides: Record<string, string> = {}) => (await listPlatformActivity(db, query(overrides), ZONE)).items.map(entry => entry.action)
/** An audit row at a chosen time, as the console writes it. */
async function auditAt(at: Date, action: string, tenantId: string | null, metadata: Record<string, unknown> = {}, actorId: string | null = SUPER) {
  await db.batch([auditStatement(db, { userId: actorId, tenantId }, { action, targetType: 'tenant', targetId: tenantId, metadata })])
  const [row] = await db.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.at).limit(1)
  await db.update(auditEvents).set({ at }).where(eq(auditEvents.id, row!.id))
}

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await ensureTenant(db, OTHER, 'brown-bean')
  await db.insert(user).values([
    { id: SUPER, email: 'ops@example.com', name: 'Ops', role: 'superadmin' },
    { id: SECOND, email: 'second@example.com', name: 'Second', role: 'superadmin' },
  ])
})

describe('activity', () => {
  it('lists the platform team\'s actions newest first, with the people and cafes named, never a cafe\'s own rows', async () => {
    const owner = await createAdmin(db, 'owner@example.com')
    const customer = await createUser(db, 'dara@example.com', 'Dara')
    await addOwner(db, actor, TEST_TENANT, { version: 1, reason: 'Owner asked', owner: { kind: 'existing', userId: customer.id } })
    await banAccount(db, { userId: SECOND }, customer.id, { version: (await db.select({ at: user.updatedAt }).from(user).where(eq(user.id, customer.id)))[0]!.at.getTime(), reason: 'Chargebacks' })
    // The cafe's own owner acts in its admin: a `tenant.*` row and a staff row, neither the platform's.
    const ownerActor = { userId: owner.userId, tenantId: TEST_TENANT, role: 'owner' as const }
    const cafe = await getTenant(db, TEST_TENANT)
    await updateCafeSettings(db, ownerActor, { version: cafe.version, name: 'NUK Coffee', logoAssetId: null })
    await db.batch([auditStatement(db, { userId: owner.userId, tenantId: TEST_TENANT }, { action: 'staff.create', targetType: 'user', targetId: customer.id, metadata: {} })])

    const page = await listPlatformActivity(db, query(), ZONE)
    expect(page.items.map(entry => entry.action)).toEqual(['platform.account.ban', 'tenant.owner.add'])
    expect(page.total).toBe(2)
    const [ban, add] = page.items
    expect(ban).toMatchObject({ actor: { id: SECOND, name: 'Second' }, cafe: null, account: { id: customer.id, name: 'Dara', email: 'dara@example.com' }, details: { reason: 'Chargebacks', until: null } })
    expect(add).toMatchObject({ actor: { id: SUPER, name: 'Ops', email: 'ops@example.com' }, cafe: { id: TEST_TENANT, name: 'NUK Coffee', slug: 'nuk' }, account: { id: customer.id }, details: { reason: 'Owner asked', newAccount: false } })
    expect(await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.action, 'tenant.profile.update'))).toHaveLength(1)
  })

  it('a cafe\'s actions are its own: another cafe\'s never show', async () => {
    await suspendTenant(db, actor, TEST_TENANT, { version: 1, reason: 'Unpaid invoice' })
    await updateTenantNotes(db, actor, OTHER, { version: 0, contactName: 'Bea', contactPhone: null, notes: null })
    expect(await actions({ tenantId: TEST_TENANT })).toEqual(['tenant.suspend'])
    expect(await actions({ tenantId: OTHER })).toEqual(['tenant.notes.update'])
    const [notes] = (await listPlatformActivity(db, query({ tenantId: OTHER }), ZONE)).items
    // Notes are named by field, never their values.
    expect(notes!.details).toEqual({ fields: ['contactName'] })
  })

  it('filters by actor, action and dates in the platform\'s zone; pages', async () => {
    // 2026-10-18 23:30 in Phnom Penh is 16:30 UTC, still the 18th there.
    await auditAt(new Date('2026-10-18T16:30:00Z'), 'tenant.suspend', TEST_TENANT, { reason: 'A' })
    await auditAt(new Date('2026-10-18T17:30:00Z'), 'tenant.resume', TEST_TENANT)
    await auditAt(new Date('2026-10-17T03:00:00Z'), 'tenant.slug.change', OTHER, { from: 'old', to: 'brown-bean' }, SECOND)
    await auditAt(new Date('2026-10-16T03:00:00Z'), 'platform.superadmin.grant', null, { by: 'seed' }, null)

    expect(await actions({ from: '2026-10-18', to: '2026-10-18' })).toEqual(['tenant.suspend'])
    expect(await actions({ from: '2026-10-19' })).toEqual(['tenant.resume'])
    expect(await actions({ to: '2026-10-17' })).toEqual(['tenant.slug.change', 'platform.superadmin.grant'])
    expect(await actions({ actorId: SECOND })).toEqual(['tenant.slug.change'])
    expect(await actions({ action: 'tenant.resume' })).toEqual(['tenant.resume'])
    const slug = (await listPlatformActivity(db, query({ actorId: SECOND }), ZONE)).items[0]!
    expect(slug.details).toEqual({ from: 'old', to: 'brown-bean' })
    const grant = (await listPlatformActivity(db, query({ action: 'platform.superadmin.grant' }), ZONE)).items[0]!
    // The system: no actor. Unknown metadata keys never leave the server.
    expect(grant.actor).toBeNull()
    expect(grant.details).toEqual({})

    const second = await listPlatformActivity(db, query({ page: '2', pageSize: '3' }), ZONE)
    expect(second).toMatchObject({ page: 2, total: 4, totalPages: 2 })
    expect(second.items.map(entry => entry.action)).toEqual(['platform.superadmin.grant'])
  })

  it('refuses a start after the end, and an action that isn\'t the platform\'s', () => {
    expect(v.safeParse(activityQuerySchema, { from: '2026-10-19', to: '2026-10-18' }).success).toBe(false)
    expect(v.safeParse(activityQuerySchema, { action: 'tenant.profile.update' }).success).toBe(false)
  })
})

describe('the overview', () => {
  it('counts cafes by status, new this month, quiet, without an active owner, and banned accounts', async () => {
    const now = new Date('2026-10-19T05:00:00Z')
    await ensureTenant(db, 'tenant-3', 'quiet-cafe')
    // Created on 1 October at 00:30 in Phnom Penh (still September in UTC) and in September.
    await db.update(organization).set({ createdAt: new Date('2026-09-30T17:30:00Z') }).where(eq(organization.id, TEST_TENANT))
    await db.update(organization).set({ createdAt: new Date('2026-09-30T16:30:00Z') }).where(eq(organization.id, OTHER))
    await db.update(organization).set({ createdAt: new Date('2026-08-01T00:00:00Z') }).where(eq(organization.id, 'tenant-3'))
    await createAdmin(db, 'owner@example.com')
    const banned = await createAdmin(db, 'gone@example.com', OTHER)
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.userId))
    await db.insert(user).values({ id: 'guest-1', email: 'g@anon.example', name: 'Guest', isAnonymous: true, banned: true })
    // An order three days ago in NUK; Brown Bean's last one was ten days ago; tenant-3 is paused.
    await insertBranch(db, { id: 'b-1', name: 'Main', timezone: ZONE })
    await insertBranch(db, { id: 'b-2', name: 'Main', timezone: ZONE, tenantId: OTHER })
    const customer = await createUser(db)
    const order = (tenantId: string, branchId: string, placedAt: Date) => ({
      tenantId, branchId, customerId: customer.id, businessDate: placedAt.toISOString().slice(0, 10), pickupNumber: 1,
      orderType: 'pickup' as const, subtotalMinor: 100, totalMinor: 100, placedAt, paymentDueAt: placedAt,
    })
    await db.insert(orders).values([order(TEST_TENANT, 'b-1', new Date('2026-10-16T05:00:00Z')), order(OTHER, 'b-2', new Date('2026-10-09T05:00:00Z'))])
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, 'tenant-3'))

    expect(await getPlatformOverview(db, ZONE, now)).toEqual({
      cafes: { active: 2, suspended: 1 },
      newCafesThisMonth: 1,
      // Brown Bean only: NUK ordered, and a paused cafe isn't counted.
      quietCafes: 1,
      // Brown Bean's only owner is banned; tenant-3 has none.
      noActiveOwner: 2,
      // The guest isn't a registered account.
      bannedAccounts: 1,
      timeZone: ZONE,
    })
  })
})
