import { and, count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateTenantInput } from '#shared/contracts/tenants'
import type { Db } from '#server/utils/batch'
import { auditEvents, branches, member, organization, user } from '#server/db/tables'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { orders } from '#server/features/orders/orders.schema'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import { changeTenantSlug, createTenant, currentSlugFor, getTenant, listTenants, resumeTenant, seedTenant, suspendTenant } from '#server/features/tenants'
import { tenantSlugs } from '#server/features/tenants/tenants.schema'

// The platform console (step T2a, D142): cafes with their first branch and owner, pause and
// resume, change of address with the old one kept. Against SQLite built from the migrations.

let db: Db
const admin = { userId: 'superadmin-1', requestId: 'req-1' }

const input = (overrides: Partial<CreateTenantInput> = {}): CreateTenantInput => ({
  name: 'Brown Bean',
  slug: 'brown-bean',
  branchName: 'Bean Street',
  timezone: 'Asia/Phnom_Penh',
  ownerName: 'Bea Brown',
  ownerEmail: 'bea@example.com',
  ...overrides,
})

const query = (overrides: Record<string, unknown> = {}) => ({ page: 1, pageSize: 20, ...overrides })
const tenantCount = async () => (await db.select({ n: count() }).from(organization))[0]!.n

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
})

describe('creating a cafe', () => {
  it('saves the cafe, its first branch and its first owner with a temporary password', async () => {
    const { tenant, temporaryPassword } = await createTenant(db, admin, input())

    expect(tenant).toMatchObject({
      name: 'Brown Bean',
      slug: 'brown-bean',
      status: 'active',
      suspendedReason: null,
      version: 1,
      usage: { branches: 1, staff: 1, ordersLast30Days: 0, lastOrderAt: null },
      owners: [{ name: 'Bea Brown', email: 'bea@example.com' }],
      formerSlugs: [],
    })
    expect(temporaryPassword).toBeTruthy()
    const [owner] = await db.select().from(user).where(eq(user.email, 'bea@example.com'))
    expect(owner!.mustChangePassword).toBe(true)
    expect(await db.select({ role: member.role }).from(member).where(eq(member.organizationId, tenant.id))).toEqual([{ role: 'owner' }])
    expect(await db.select({ name: branches.name, timezone: branches.timezone }).from(branches).where(eq(branches.tenantId, tenant.id)))
      .toEqual([{ name: 'Bean Street', timezone: 'Asia/Phnom_Penh' }])
    // A customer profile in the new cafe, like every member (D137).
    expect(await db.select({ n: count() }).from(customerProfiles).where(and(eq(customerProfiles.tenantId, tenant.id), eq(customerProfiles.userId, owner!.id)))).toEqual([{ n: 1 }])
    // The address is in the history, and the change in the cafe's own audit trail, by the super admin.
    expect(await db.select({ slug: tenantSlugs.slug }).from(tenantSlugs).where(eq(tenantSlugs.tenantId, tenant.id))).toEqual([{ slug: 'brown-bean' }])
    expect(await db.select({ actorId: auditEvents.actorId, requestId: auditEvents.requestId }).from(auditEvents)
      .where(and(eq(auditEvents.action, 'tenant.create'), eq(auditEvents.tenantId, tenant.id))))
      .toEqual([{ actorId: 'superadmin-1', requestId: 'req-1' }])
  })

  it('makes an existing account the owner; it keeps its own password', async () => {
    const existing = await createUser(db, 'bea@example.com', 'Bea')
    const { tenant, temporaryPassword } = await createTenant(db, admin, input())
    expect(temporaryPassword).toBeNull()
    expect(tenant.owners).toEqual([{ id: existing.id, name: 'Bea', email: 'bea@example.com' }])
  })

  it('refuses an address a cafe has now or had before, and saves nothing', async () => {
    await expectApiError(() => createTenant(db, admin, input({ slug: 'nuk' })), 409, 'SLUG_TAKEN', ['slug'])
    const { tenant } = await createTenant(db, admin, input())
    await changeTenantSlug(db, admin, tenant.id, { version: 1, slug: 'brown-bean-cafe' })
    await expectApiError(() => createTenant(db, admin, input({ ownerEmail: 'other@example.com' })), 409, 'SLUG_TAKEN', ['slug'])
    expect(await tenantCount()).toBe(2)
  })

  it('refuses an unknown time zone before writing anything', async () => {
    await expectApiError(() => createTenant(db, admin, input({ timezone: 'Mars/Olympus' })), 422, 'UNKNOWN_TIMEZONE', ['timezone'])
    expect(await tenantCount()).toBe(1)
    expect(await db.select({ n: count() }).from(user)).toEqual([{ n: 0 }])
  })

  it('two saves racing for one address: one cafe gets it, the other is refused whole', async () => {
    const racing = interleaved(db, () => createTenant(db, admin, input({ name: 'First', ownerEmail: 'first@example.com' })))
    await expectApiError(() => createTenant(racing, admin, input({ name: 'Second', ownerEmail: 'second@example.com' })), 409, 'SLUG_TAKEN', ['slug'])
    expect((await listTenants(db, query({ search: 'brown-bean' }))).items.map(t => t.name)).toEqual(['First'])
    expect(await db.select({ n: count() }).from(user).where(eq(user.email, 'second@example.com'))).toEqual([{ n: 0 }])
  })

  it('an address another cafe took and left again meanwhile stays that cafe\'s', async () => {
    const { tenant } = await createTenant(db, admin, input())
    // The new cafe found "shared" free; meanwhile Brown Bean moved to it and on again, so no cafe
    // has it now, but it's Brown Bean's former address: only the address history refuses it.
    const racing = interleaved(db, async () => {
      await changeTenantSlug(db, admin, tenant.id, { version: 1, slug: 'shared' })
      await changeTenantSlug(db, admin, tenant.id, { version: 2, slug: 'brown-bean-cafe' })
    })
    await expectApiError(() => createTenant(racing, admin, input({ name: 'Hijack', slug: 'shared', ownerEmail: 'h@example.com' })), 409, 'SLUG_TAKEN', ['slug'])
    expect(await currentSlugFor(db, 'shared')).toBe('brown-bean-cafe')
    expect(await tenantCount()).toBe(2)
  })

  it('an owner account created meanwhile: nothing is saved, try again', async () => {
    const racing = interleaved(db, () => createUser(db, 'bea@example.com', 'Bea'))
    await expectApiError(() => createTenant(racing, admin, input()), 409, 'VERSION_CONFLICT')
    expect(await tenantCount()).toBe(1)
  })
})

describe('the list', () => {
  beforeEach(async () => {
    await createTenant(db, admin, input())
    await createTenant(db, admin, input({ name: 'apple tea', slug: 'apple-tea', ownerEmail: 'a@example.com' }))
  })

  it('lists cafes by name with their usage, a page at a time', async () => {
    const page = await listTenants(db, query({ pageSize: 2 }))
    expect(page).toMatchObject({ total: 3, totalPages: 2, page: 1 })
    expect(page.items.map(t => t.name)).toEqual(['apple tea', 'Brown Bean'])
    expect((await listTenants(db, query({ pageSize: 2, page: 2 }))).items.map(t => t.slug)).toEqual(['nuk'])
  })

  it('finds a cafe by name or address, and filters by status', async () => {
    expect((await listTenants(db, query({ search: 'bean' }))).items.map(t => t.slug)).toEqual(['brown-bean'])
    expect((await listTenants(db, query({ search: 'nuk' }))).items.map(t => t.slug)).toEqual(['nuk'])
    // `%` and `_` are plain characters, not patterns.
    expect((await listTenants(db, query({ search: '%' }))).items).toEqual([])
    const nuk = await getTenant(db, TEST_TENANT)
    await suspendTenant(db, admin, TEST_TENANT, { version: nuk.version, reason: 'Unpaid invoice' })
    expect((await listTenants(db, query({ status: 'suspended' }))).items.map(t => t.slug)).toEqual(['nuk'])
    expect((await listTenants(db, query({ status: 'active' }))).items.map(t => t.slug)).toEqual(['apple-tea', 'brown-bean'])
  })

  it('counts each cafe\'s own orders of the last 30 days and its last order', async () => {
    await insertBranch(db, { id: 'b-nuk', name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    const customer = await createUser(db)
    const now = new Date()
    const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
    const order = (pickupNumber: number, placedAt: Date) => ({
      tenantId: TEST_TENANT,
      branchId: 'b-nuk',
      customerId: customer.id,
      businessDate: placedAt.toISOString().slice(0, 10),
      pickupNumber,
      orderType: 'pickup' as const,
      subtotalMinor: 100,
      totalMinor: 100,
      placedAt,
      paymentDueAt: placedAt,
    })
    await db.insert(orders).values([order(1, days(40)), order(2, days(3)), order(3, days(1))])

    const usage = Object.fromEntries((await listTenants(db, query())).items.map(t => [t.slug, t.usage]))
    expect(usage.nuk).toEqual({ branches: 1, staff: 0, ordersLast30Days: 2, lastOrderAt: days(1).toISOString() })
    expect(usage['brown-bean']).toEqual({ branches: 1, staff: 1, ordersLast30Days: 0, lastOrderAt: null })
  })
})

describe('pausing and resuming', () => {
  it('pauses with a reason, then resumes; each change audited', async () => {
    const paused = await suspendTenant(db, admin, TEST_TENANT, { version: 1, reason: 'Unpaid invoice' })
    expect(paused).toMatchObject({ status: 'suspended', suspendedReason: 'Unpaid invoice', version: 2 })
    await expectApiError(() => suspendTenant(db, admin, TEST_TENANT, { version: 2, reason: 'Again' }), 409, 'INVALID_STATE')

    const resumed = await resumeTenant(db, admin, TEST_TENANT, { version: 2 })
    expect(resumed).toMatchObject({ status: 'active', suspendedReason: null, version: 3 })
    await expectApiError(() => resumeTenant(db, admin, TEST_TENANT, { version: 3 }), 409, 'INVALID_STATE')
    expect((await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.tenantId, TEST_TENANT))).map(r => r.action))
      .toEqual(['tenant.suspend', 'tenant.resume'])
  })

  it('refuses a stale version, also when the cafe changes between the check and the write', async () => {
    await expectApiError(() => suspendTenant(db, admin, TEST_TENANT, { version: 7, reason: 'x' }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'nuk-cafe' }))
    await expectApiError(() => suspendTenant(racing, admin, TEST_TENANT, { version: 1, reason: 'x' }), 409, 'VERSION_CONFLICT')
    expect((await getTenant(db, TEST_TENANT)).status).toBe('active')
  })

  it('an unknown cafe is not found', async () => {
    await expectApiError(() => getTenant(db, 'missing'), 404, 'NOT_FOUND')
    await expectApiError(() => suspendTenant(db, admin, 'missing', { version: 1, reason: 'x' }), 404, 'NOT_FOUND')
  })
})

describe('changing the address', () => {
  it('moves the cafe; the old address redirects to it and no other cafe can take it', async () => {
    const moved = await changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'nuk-coffee' })
    expect(moved).toMatchObject({ slug: 'nuk-coffee', version: 2, formerSlugs: ['nuk'] })
    expect(await currentSlugFor(db, 'nuk')).toBe('nuk-coffee')
    expect(await currentSlugFor(db, 'nuk-coffee')).toBeUndefined()
    expect(await currentSlugFor(db, 'never-used')).toBeUndefined()
    await expectApiError(() => createTenant(db, admin, input({ slug: 'nuk' })), 409, 'SLUG_TAKEN')
    expect((await db.select({ action: auditEvents.action, metadata: auditEvents.metadata }).from(auditEvents)))
      .toEqual([{ action: 'tenant.slug.change', metadata: { from: 'nuk', to: 'nuk-coffee' } }])
  })

  it('takes back an address the cafe had before', async () => {
    await changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'nuk-coffee' })
    const back = await changeTenantSlug(db, admin, TEST_TENANT, { version: 2, slug: 'nuk' })
    expect(back).toMatchObject({ slug: 'nuk', formerSlugs: ['nuk-coffee'] })
    expect(await currentSlugFor(db, 'nuk-coffee')).toBe('nuk')
  })

  it('refuses another cafe\'s address (current or former) and its own current one', async () => {
    const { tenant } = await createTenant(db, admin, input())
    await expectApiError(() => changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'brown-bean' }), 409, 'SLUG_TAKEN', ['slug'])
    await changeTenantSlug(db, admin, tenant.id, { version: 1, slug: 'brown' })
    await expectApiError(() => changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'brown-bean' }), 409, 'SLUG_TAKEN', ['slug'])
    await expectApiError(() => changeTenantSlug(db, admin, TEST_TENANT, { version: 1, slug: 'nuk' }), 409, 'INVALID_STATE', ['slug'])
  })

  it('two cafes racing for one new address: one gets it, the other is refused', async () => {
    const { tenant } = await createTenant(db, admin, input())
    const racing = interleaved(db, () => changeTenantSlug(db, admin, tenant.id, { version: 1, slug: 'shared' }))
    await expectApiError(() => changeTenantSlug(racing, admin, TEST_TENANT, { version: 1, slug: 'shared' }), 409, 'SLUG_TAKEN')
    expect((await getTenant(db, TEST_TENANT)).slug).toBe('nuk')
    expect((await getTenant(db, tenant.id)).slug).toBe('shared')
  })
})

describe('seed', () => {
  it('creates the cafe once with its address in the history, then finds it', async () => {
    const fresh = await createTestDb()
    const tenant = await seedTenant(fresh, { name: 'NUK Cafe', slug: 'nuk' })
    expect(tenant).toMatchObject({ name: 'NUK Cafe', slug: 'nuk', created: true })
    expect(await fresh.select({ slug: tenantSlugs.slug }).from(tenantSlugs)).toEqual([{ slug: 'nuk' }])
    expect(await seedTenant(fresh, { name: 'Other', slug: 'other' })).toEqual({ ...tenant, created: false })
  })
})
