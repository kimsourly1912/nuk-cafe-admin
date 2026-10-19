import { and, count, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateTenantInput } from '#shared/contracts/tenants'
import { createTenantSchema, ownerSearchQuerySchema } from '#shared/contracts/tenants'
import type { Db } from '#server/utils/batch'
import { account, auditEvents, branches, branchStaff, member, organization, session, user } from '#server/db/tables'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { orders } from '#server/features/orders/orders.schema'
import { addBranchStaff, createAdmin, createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import { changeTenantSlug, checkSlug, countTenants, createTenant, currentSlugFor, getCafeProfile, getCafeSettings, getOwnerAccount, getTenant, listAccountCafes, listTenants, resumeTenant, searchOwnerAccounts, seedTenant, suspendTenant, updateCafeSettings } from '#server/features/tenants'
import { mediaAssets } from '#server/features/media/media.schema'
import { tenantSlugs } from '#server/features/tenants/tenants.schema'

// The platform console (step T2a, D142): cafes with their first branch and owner, pause and
// resume, change of address with the old one kept. Against SQLite built from the migrations.

let db: Db
const admin = { userId: 'superadmin-1', requestId: 'req-1' }

type InputOverrides = Partial<Omit<CreateTenantInput, 'owner'>> & { ownerName?: string, ownerEmail?: string, owner?: CreateTenantInput['owner'] }

/** A new cafe; its owner a new person unless `owner` names someone else (D146). */
const input = (overrides: InputOverrides = {}): CreateTenantInput => {
  const { ownerName = 'Bea Brown', ownerEmail = 'bea@example.com', owner, ...cafe } = overrides
  return {
    name: 'Brown Bean',
    slug: 'brown-bean',
    branchName: 'Bean Street',
    timezone: 'Asia/Phnom_Penh',
    owner: owner ?? { kind: 'new', name: ownerName, email: ownerEmail },
    ...cafe,
  }
}

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

  it('a new person whose email has an account is refused on the email; nothing is saved (D185)', async () => {
    await createUser(db, 'bea@example.com', 'Bea')
    await expectApiError(() => createTenant(db, admin, input()), 409, 'ACCOUNT_EXISTS', ['owner.email'])
    expect(await tenantCount()).toBe(1)
    expect(await db.select({ n: count() }).from(member)).toEqual([{ n: 0 }])
  })

  it('a new person with the email of a disabled or guest account is refused too, without sending them elsewhere', async () => {
    const banned = await createUser(db, 'banned@example.com')
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.id))
    const guest = await createUser(db, 'guest@example.com')
    await db.update(user).set({ isAnonymous: true }).where(eq(user.id, guest.id))
    for (const ownerEmail of ['banned@example.com', 'guest@example.com']) {
      await expectApiError(() => createTenant(db, admin, input({ ownerEmail })), 422, 'VALIDATION_FAILED', ['owner.email'])
    }
    expect(await tenantCount()).toBe(1)
  })

  it('answers with every cafe the owner has now', async () => {
    const { owner } = await createTenant(db, admin, input())
    expect(owner).toMatchObject({ name: 'Bea Brown', email: 'bea@example.com', cafes: [{ name: 'Brown Bean', slug: 'brown-bean' }] })
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

  it('an account created with the email meanwhile: refused on the email, nothing is saved (D185)', async () => {
    const racing = interleaved(db, () => createUser(db, 'bea@example.com', 'Bea'))
    await expectApiError(() => createTenant(racing, admin, input()), 409, 'ACCOUNT_EXISTS', ['owner.email'])
    expect(await tenantCount()).toBe(1)
    expect(await db.select({ n: count() }).from(member)).toEqual([{ n: 0 }])
  })
})

describe('creating a cafe: the address check (D185)', () => {
  it('says whether no cafe has or had the address', async () => {
    expect(await checkSlug(db, 'brown-bean')).toEqual({ slug: 'brown-bean', available: true })
    expect(await checkSlug(db, 'nuk')).toEqual({ slug: 'nuk', available: false })
    const { tenant } = await createTenant(db, admin, input())
    await changeTenantSlug(db, admin, tenant.id, { version: 1, slug: 'brown-bean-cafe' })
    // Not the cafe's now, but its former address: still taken.
    expect(await checkSlug(db, 'brown-bean')).toEqual({ slug: 'brown-bean', available: false })
  })
})

describe('a new cafe for an existing account (D146, D185)', () => {
  const nameTenant = (id: string, name: string) => db.update(organization).set({ name }).where(eq(organization.id, id))
  const existing = (userId: string): CreateTenantInput['owner'] => ({ kind: 'existing', userId })
  // The account's version (`updated_at`) stays as it was: only the eligibility guard can see the change.
  const change = async (userId: string, values: { banned?: boolean, isAnonymous?: boolean }) => {
    const [row] = await db.select({ updatedAt: user.updatedAt }).from(user).where(eq(user.id, userId))
    await db.update(user).set({ ...values, updatedAt: row!.updatedAt }).where(eq(user.id, userId))
  }
  const ban = (userId: string) => change(userId, { banned: true })
  const makeGuest = (userId: string) => change(userId, { isAnonymous: true })

  it('searches registered accounts by name or email, with the cafes they own: owners, customers and staff', async () => {
    const zoe = await createAdmin(db, 'zoe@example.com')
    await db.update(user).set({ name: 'Zoe' }).where(eq(user.id, zoe.userId))
    await nameTenant(TEST_TENANT, 'NUK Cafe')
    const { owner: bea } = await createTenant(db, admin, input())
    await createTenant(db, admin, input({ name: 'Apple Tea', slug: 'apple-tea', owner: existing(bea.id) }))
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    const staff = await createUser(db, 'sam@example.com', 'Sam')
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    await addBranchStaff(db, 'branch-1', staff.id, 'manager')

    expect(await searchOwnerAccounts(db, { search: 'bea' })).toEqual([
      { id: bea.id, name: 'Bea Brown', email: 'bea@example.com', cafes: [
        { id: expect.any(String), name: 'Apple Tea', slug: 'apple-tea' },
        { id: expect.any(String), name: 'Brown Bean', slug: 'brown-bean' },
      ] },
    ])
    expect(await searchOwnerAccounts(db, { search: 'ZOE@' })).toEqual([{ id: zoe.userId, name: 'Zoe', email: 'zoe@example.com', cafes: [{ id: TEST_TENANT, name: 'NUK Cafe', slug: 'nuk' }] }])
    expect(await searchOwnerAccounts(db, { search: 'carl' })).toEqual([{ id: customer.id, name: 'Carl', email: 'carl@example.com', cafes: [] }])
    expect(await searchOwnerAccounts(db, { search: 'sam' })).toEqual([{ id: staff.id, name: 'Sam', email: 'sam@example.com', cafes: [] }])
    expect(await searchOwnerAccounts(db, { search: 'nobody-like-this' })).toEqual([])
  })

  it('never lists a disabled account or a guest, and a lookup is bounded', async () => {
    const banned = await createUser(db, 'person-banned@example.com', 'Person')
    await ban(banned.id)
    const guest = await createUser(db, 'person-guest@example.com', 'Person')
    await makeGuest(guest.id)
    for (let i = 0; i < 12; i++) await createUser(db, `person${i}@example.com`, 'Person')

    const found = await searchOwnerAccounts(db, { search: 'person' })
    expect(found).toHaveLength(8)
    expect(found.map(account => account.email)).not.toContain('person-banned@example.com')
    expect(found.map(account => account.email)).not.toContain('person-guest@example.com')
    expect(await searchOwnerAccounts(db, { search: 'person-banned' })).toEqual([])
    expect(await searchOwnerAccounts(db, { search: 'person-guest' })).toEqual([])
    // Short searches are refused by the contract, so the route never scans for a letter.
    expect(v.safeParse(ownerSearchQuerySchema, { search: ' p ' }).success).toBe(false)
  })

  it('reads one account by id; a disabled account, a guest and an unknown id are not found', async () => {
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    expect(await getOwnerAccount(db, customer.id)).toEqual({ id: customer.id, name: 'Carl', email: 'carl@example.com', cafes: [] })
    const banned = await createUser(db, 'banned@example.com')
    await ban(banned.id)
    const guest = await createUser(db, 'guest@example.com')
    await makeGuest(guest.id)
    for (const id of [banned.id, guest.id, 'nobody']) await expectApiError(() => getOwnerAccount(db, id), 404, 'NOT_FOUND')
  })

  it('makes an existing owner the new cafe\'s owner: their own account and password, both cafes in the answer', async () => {
    const { userId } = await createAdmin(db, 'zoe@example.com')
    await nameTenant(TEST_TENANT, 'NUK Cafe')
    const [before] = await db.select({ mustChangePassword: user.mustChangePassword }).from(user).where(eq(user.id, userId))
    const { tenant, temporaryPassword, owner } = await createTenant(db, admin, input({ owner: existing(userId) }))

    expect(temporaryPassword).toBeNull()
    expect(tenant.owners).toEqual([{ id: userId, name: 'Admin', email: 'zoe@example.com', banned: false, staffAccess: false }])
    expect(owner.cafes.map(cafe => cafe.name)).toEqual(['Brown Bean', 'NUK Cafe'])
    expect(await db.select({ mustChangePassword: user.mustChangePassword }).from(user).where(eq(user.id, userId))).toEqual([before])
    expect(await db.select({ n: count() }).from(user)).toEqual([{ n: 1 }])
    const [row] = await db.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.action, 'tenant.create'), eq(auditEvents.tenantId, tenant.id)))
    expect(row!.metadata).toMatchObject({ ownerId: userId, ownerKind: 'existing', existingAccount: true })
  })

  it('promotes a customer and branch staff to owner: password, profile, sessions and other cafes stay', async () => {
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    const staff = await createUser(db, 'sam@example.com', 'Sam')
    await insertBranch(db, { id: 'branch-1', name: 'Main', timezone: 'Asia/Phnom_Penh' })
    await addBranchStaff(db, 'branch-1', staff.id, 'manager')
    for (const person of [customer, staff]) {
      await db.insert(account).values({ id: `acc-${person.id}`, accountId: person.id, providerId: 'credential', userId: person.id, password: `hash-${person.id}` })
      await db.insert(session).values({ id: `s-${person.id}`, userId: person.id, token: `t-${person.id}`, expiresAt: new Date(Date.now() + 3_600_000) })
    }
    const staffMemberBefore = await db.select().from(member).where(eq(member.userId, staff.id))
    const staffBranchBefore = await db.select().from(branchStaff).where(eq(branchStaff.userId, staff.id))

    for (const [person, slug] of [[customer, 'carl-cafe'], [staff, 'sam-cafe']] as const) {
      const created = await createTenant(db, admin, input({ name: slug, slug, owner: existing(person.id) }))
      expect(created.temporaryPassword).toBeNull()
      expect(created.tenant.owners).toEqual([{ id: person.id, name: person.email.startsWith('carl') ? 'Carl' : 'Sam', email: person.email, banned: false, staffAccess: false }])
      expect(await db.select({ role: member.role }).from(member).where(and(eq(member.userId, person.id), eq(member.organizationId, created.tenant.id)))).toEqual([{ role: 'owner' }])
      // Their own password, still asking nothing new of them; their sessions go on.
      expect(await db.select({ password: account.password }).from(account).where(eq(account.userId, person.id))).toEqual([{ password: `hash-${person.id}` }])
      expect(await db.select({ n: count() }).from(session).where(eq(session.userId, person.id))).toEqual([{ n: 1 }])
      const [row] = await db.select({ mustChangePassword: user.mustChangePassword }).from(user).where(eq(user.id, person.id))
      expect(row!.mustChangePassword).toBeFalsy()
      expect(await db.select({ n: count() }).from(customerProfiles).where(and(eq(customerProfiles.tenantId, created.tenant.id), eq(customerProfiles.userId, person.id)))).toEqual([{ n: 1 }])
    }
    // The other cafe's access of the staff member is untouched.
    expect(await db.select().from(member).where(and(eq(member.userId, staff.id), eq(member.organizationId, TEST_TENANT)))).toEqual(staffMemberBefore)
    expect(await db.select().from(branchStaff).where(eq(branchStaff.userId, staff.id))).toEqual(staffBranchBefore)
    expect(await db.select({ n: count() }).from(user)).toEqual([{ n: 2 }])
  })

  it('takes the account\'s own name and email: what the form sends is ignored', async () => {
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    const body = v.parse(createTenantSchema, { ...input(), owner: { kind: 'existing', userId: customer.id, name: 'Mallory', email: 'mallory@example.com' } })
    expect(body.owner).toEqual({ kind: 'existing', userId: customer.id })
    const { tenant } = await createTenant(db, admin, body)
    expect(tenant.owners).toEqual([{ id: customer.id, name: 'Carl', email: 'carl@example.com', banned: false, staffAccess: false }])
    expect(await db.select({ n: count() }).from(user).where(eq(user.email, 'mallory@example.com'))).toEqual([{ n: 0 }])
  })

  it('refuses a disabled account, a guest and an unknown id; nothing is saved', async () => {
    const banned = await createAdmin(db, 'banned@example.com')
    await ban(banned.userId)
    const guest = await createUser(db, 'guest@example.com')
    await makeGuest(guest.id)

    for (const userId of [banned.userId, guest.id, 'nobody']) {
      await expectApiError(() => createTenant(db, admin, input({ owner: existing(userId) })), 422, 'VALIDATION_FAILED', ['owner.userId'])
    }
    expect(await tenantCount()).toBe(1)
  })

  it('a new person with an existing owner\'s email is refused: they\'re chosen as an existing account instead', async () => {
    await createAdmin(db, 'zoe@example.com')
    await expectApiError(() => createTenant(db, admin, input({ ownerEmail: 'zoe@example.com' })), 409, 'ACCOUNT_EXISTS', ['owner.email'])
    expect(await tenantCount()).toBe(1)
  })

  it('the chosen account\'s version changed meanwhile: nothing is saved, try again', async () => {
    const { userId } = await createAdmin(db, 'zoe@example.com')
    const racing = interleaved(db, () => db.update(user).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(user.id, userId)))
    await expectApiError(() => createTenant(racing, admin, input({ owner: existing(userId) })), 409, 'VERSION_CONFLICT')
    expect(await tenantCount()).toBe(1)
    expect(await db.select({ n: count() }).from(member).where(eq(member.userId, userId))).toEqual([{ n: 1 }])
  })

  it('the chosen account disabled meanwhile (its version untouched): refused whole, nothing is saved', async () => {
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    const racing = interleaved(db, () => ban(customer.id))
    await expectApiError(() => createTenant(racing, admin, input({ owner: existing(customer.id) })), 422, 'VALIDATION_FAILED', ['owner.userId'])
    expect(await tenantCount()).toBe(1)
    expect(await db.select({ n: count() }).from(member)).toEqual([{ n: 0 }])
  })

  it('the chosen account turned into a guest meanwhile: refused whole, nothing is saved', async () => {
    const customer = await createUser(db, 'carl@example.com', 'Carl')
    const racing = interleaved(db, () => makeGuest(customer.id))
    await expectApiError(() => createTenant(racing, admin, input({ owner: existing(customer.id) })), 422, 'VALIDATION_FAILED', ['owner.userId'])
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

  // D1 refuses a LIKE pattern over 50 bytes, so a search is matched with instr(), not like.
  it('finds cafes by searches past 50 bytes, and by literal %, _ and backslash', async () => {
    const slash = String.fromCharCode(92)
    const khmer = 'ក'.repeat(17)
    const ascii = 'The Very Long Named Brown Bean Roastery Phnom Penh'.slice(0, 49)
    await createTenant(db, admin, input({ name: khmer, slug: 'khmer-cafe', ownerEmail: 'k@example.com' }))
    await createTenant(db, admin, input({ name: ascii, slug: 'long-named', ownerEmail: 'l@example.com' }))
    await createTenant(db, admin, input({ name: `Half% _off_ ${slash} cafe`, slug: 'half-off', ownerEmail: 'h@example.com' }))
    await createTenant(db, admin, input({ name: 'M'.repeat(80), slug: 'm'.repeat(40), ownerEmail: 'm@example.com' }))
    const slugs = async (search: string, extra = {}) => (await listTenants(db, query({ search, ...extra }))).items.map(t => t.slug).sort()

    expect(await slugs(khmer)).toEqual(['khmer-cafe'])
    expect(await slugs(ascii.toUpperCase())).toEqual(['long-named'])
    expect(await slugs('m'.repeat(80))).toEqual(['m'.repeat(40)])
    expect(await slugs('m'.repeat(100))).toEqual([])
    expect(await slugs('ក'.repeat(100))).toEqual([])
    expect(await slugs('m'.repeat(40))).toEqual(['m'.repeat(40)]) // the address matches too
    for (const search of ['%', '_', slash, '% _off_ ', `${slash} cafe`]) expect(await slugs(search)).toEqual(['half-off'])
    expect(await slugs('%'.repeat(25))).toEqual([])
    expect(await slugs(slash.repeat(60))).toEqual([])
    // The page and the total agree, with the status filter.
    expect(await listTenants(db, query({ search: khmer, pageSize: 1 }))).toMatchObject({ total: 1, totalPages: 1 })
    expect((await listTenants(db, query({ search: khmer, status: 'suspended' }))).total).toBe(0)
  })

  it('counts the cafes of each status in one read, zeros included', async () => {
    expect(await countTenants(db)).toEqual({ active: 3, suspended: 0 })
    const nuk = await getTenant(db, TEST_TENANT)
    await suspendTenant(db, admin, TEST_TENANT, { version: nuk.version, reason: 'Unpaid invoice' })
    expect(await countTenants(db)).toEqual({ active: 2, suspended: 1 })
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

// The cafe's own profile (step T2b, D143): its name and logo, set by its owners.
describe('the cafe\'s profile', () => {
  const owner = { userId: 'owner-1', tenantId: TEST_TENANT, role: 'owner' as const, requestId: 'req-2' }

  async function upload(id: string, tenantId = TEST_TENANT) {
    await db.insert(mediaAssets).values({ id, tenantId, objectKey: `t/${tenantId}/menu/${id}.png`, mimeType: 'image/png', byteSize: 10, sha256: 'x' })
    return id
  }
  const stateOf = async (id: string) => (await db.select({ state: mediaAssets.state }).from(mediaAssets).where(eq(mediaAssets.id, id)))[0]?.state

  it('reads by its address, paused too; an unknown or former address is not found', async () => {
    expect(await getCafeProfile(db, 'nuk')).toEqual({ slug: 'nuk', name: `Cafe ${TEST_TENANT}`, logoUrl: null, status: 'active' })
    await suspendTenant(db, admin, TEST_TENANT, { version: 1, reason: 'x' })
    expect((await getCafeProfile(db, 'nuk')).status).toBe('suspended')
    await expectApiError(() => getCafeProfile(db, 'nowhere'), 404, 'NOT_FOUND')
    await changeTenantSlug(db, admin, TEST_TENANT, { version: 2, slug: 'nuk-coffee' })
    await expectApiError(() => getCafeProfile(db, 'nuk'), 404, 'NOT_FOUND')
  })

  it('changes the name and logo; a new logo is attached, the old one released, the change audited', async () => {
    const first = await upload('logo-1')
    const saved = await updateCafeSettings(db, owner, { version: 1, name: 'NUK Coffee', logoAssetId: first })
    expect(saved).toMatchObject({ name: 'NUK Coffee', logoAssetId: first, logoUrl: `/media/t/${TEST_TENANT}/menu/logo-1.png`, version: 2 })
    expect(await stateOf(first)).toBe('attached')
    expect((await getCafeProfile(db, 'nuk')).logoUrl).toBe(saved.logoUrl)

    const second = await upload('logo-2')
    await updateCafeSettings(db, owner, { version: 2, name: 'NUK Coffee', logoAssetId: second })
    expect([await stateOf(first), await stateOf(second)]).toEqual(['temporary', 'attached'])
    const removed = await updateCafeSettings(db, owner, { version: 3, name: 'NUK Coffee', logoAssetId: null })
    expect([removed.logoUrl, await stateOf(second)]).toEqual([null, 'temporary'])
    expect((await db.select({ action: auditEvents.action, actorId: auditEvents.actorId }).from(auditEvents).where(eq(auditEvents.tenantId, TEST_TENANT))))
      .toEqual(Array.from({ length: 3 }, () => ({ action: 'tenant.profile.update', actorId: 'owner-1' })))
  })

  it('refuses another cafe\'s upload as its logo', async () => {
    await ensureTenant(db, 'tenant-2', 'other')
    const theirs = await upload('logo-9', 'tenant-2')
    await expectApiError(() => updateCafeSettings(db, owner, { version: 1, name: 'NUK', logoAssetId: theirs }), 422, 'MEDIA_NOT_AVAILABLE', ['logoAssetId'])
    expect(await stateOf(theirs)).toBe('temporary')
  })

  it('a stale version, or a change between the check and the write, is refused and saves nothing', async () => {
    await expectApiError(() => updateCafeSettings(db, owner, { version: 9, name: 'X', logoAssetId: null }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => suspendTenant(db, admin, TEST_TENANT, { version: 1, reason: 'x' }))
    await expectApiError(() => updateCafeSettings(racing, owner, { version: 1, name: 'X', logoAssetId: null }), 409, 'VERSION_CONFLICT')
    expect((await getCafeSettings(db, TEST_TENANT)).name).toBe(`Cafe ${TEST_TENANT}`)
  })

  it('an upload cleaned up between the check and the write: the name isn\'t saved either', async () => {
    const logo = await upload('logo-3')
    const racing = interleaved(db, () => db.delete(mediaAssets).where(eq(mediaAssets.id, logo)))
    await expectApiError(() => updateCafeSettings(racing, owner, { version: 1, name: 'NUK Coffee', logoAssetId: logo }), 422, 'MEDIA_NOT_AVAILABLE', ['logoAssetId'])
    expect((await getCafeSettings(db, TEST_TENANT))).toMatchObject({ name: `Cafe ${TEST_TENANT}`, version: 1 })
  })
})

// The account's own cafes (step T2c, D144): Your cafes and the cafe switcher.
describe('the cafes an account works in', () => {
  const sessionOf = (id: string, extra: Record<string, unknown> = {}) => ({ id, email: 'x@example.com', name: 'X', emailVerified: true, ...extra }) as Parameters<typeof listAccountCafes>[1]

  it('lists owned cafes with the admin and the counter, branch staff with the counter, by name', async () => {
    const { userId } = await createAdmin(db, 'owner@example.com')
    await ensureTenant(db, 'tenant-2', 'brown-bean')
    await db.update(organization).set({ name: 'Brown Bean' }).where(eq(organization.id, 'tenant-2'))
    await insertBranch(db, { id: 'branch-b', name: 'Bean Street', timezone: 'Asia/Phnom_Penh', tenantId: 'tenant-2' })
    await addBranchStaff(db, 'branch-b', userId, 'staff', 'tenant-2')
    // A cafe the account has nothing to do with, and one where it's only a customer.
    await ensureTenant(db, 'tenant-3', 'quiet-corner')

    expect(await listAccountCafes(db, sessionOf(userId))).toEqual([
      { slug: 'brown-bean', name: 'Brown Bean', logoUrl: null, status: 'active', workspaces: ['counter'] },
      { slug: 'nuk', name: `Cafe ${TEST_TENANT}`, logoUrl: null, status: 'active', workspaces: ['admin', 'counter'] },
    ])
  })

  it('leaves out archived branches and plain members; lists a paused cafe with its status', async () => {
    const person = await createUser(db)
    await insertBranch(db, { id: 'branch-old', name: 'Old', timezone: 'Asia/Phnom_Penh', status: 'archived' })
    await addBranchStaff(db, 'branch-old', person.id, 'manager')
    expect(await listAccountCafes(db, sessionOf(person.id))).toEqual([])

    const { userId } = await createAdmin(db, 'paused@example.com')
    await suspendTenant(db, admin, TEST_TENANT, { version: 1, reason: 'Unpaid' })
    expect(await listAccountCafes(db, sessionOf(userId))).toMatchObject([{ slug: 'nuk', status: 'suspended', workspaces: ['admin', 'counter'] }])
  })

  it('answers a temporary password (only links); refuses no session or a banned account', async () => {
    const { userId } = await createAdmin(db, 'new@example.com')
    expect(await listAccountCafes(db, sessionOf(userId, { mustChangePassword: true }))).toHaveLength(1)
    await expectApiError(() => listAccountCafes(db, null), 401, 'UNAUTHENTICATED')
    await expectApiError(() => listAccountCafes(db, sessionOf(userId, { banned: true })), 401, 'UNAUTHENTICATED')
  })
})
