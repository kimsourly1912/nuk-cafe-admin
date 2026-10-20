import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { branches, branchStaff, member, organization, user } from '#server/db/tables'
import * as branchRepo from '#server/features/branches/branches.repository'
import * as customers from '#server/features/customers/customers.repository'
import * as accounts from '#server/features/identity/accounts.repository'
import * as identity from '#server/features/identity/identity.repository'
import * as staff from '#server/features/identity/staff.repository'
import * as tenants from '#server/features/tenants/tenants.repository'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'

const OTHER = 'tenant-2'
const NOW = new Date('2026-10-20T03:00:00Z')
const notes = { contactName: 'Their contact', contactPhone: null, notes: 'Private', updatedBy: 'person', now: NOW }
let db: Db
const run = (...statements: Statement[]) => db.batch(statements as [Statement, ...Statement[]])

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  await insertBranch(db, { id: 'their-branch', name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
  await db.insert(user).values({ id: 'person', name: 'Person', email: 'person@example.com', banned: null, isAnonymous: null, createdAt: NOW, updatedAt: NOW })
  await db.insert(member).values({ id: 'their-membership', organizationId: OTHER, userId: 'person', role: 'owner', createdAt: NOW })
  await db.insert(branchStaff).values({ tenantId: OTHER, branchId: 'their-branch', userId: 'person', role: 'manager', createdAt: NOW })
  await run(
    ...branchRepo.replaceHoursStatements(db, OTHER, 'their-branch', [{ weekday: 1, startMinute: 480, endMinute: 1020 }]),
    branchRepo.insertTableStatement(db, { id: 'their-table', tenantId: OTHER, branchId: 'their-branch', label: 'Table 1', area: 'Inside', qrTokenHash: 'their-hash', now: NOW }),
    customers.insertProfileStatement(db, OTHER, 'person', 'THEIRCODE'),
    tenants.insertNotesStatement(db, OTHER, notes),
  )
})

describe('identity and cafes: the repository isolation layer (D194 step 5)', () => {
  it('reads no other cafe\'s branch, hours or tables, even with their real ids', async () => {
    expect(await branchRepo.findBranch(db, TEST_TENANT, 'their-branch')).toBeUndefined()
    expect(await branchRepo.findBranch(db, OTHER, 'their-branch')).toMatchObject({ name: 'Theirs' })
    expect(await branchRepo.hasAnyBranch(db, TEST_TENANT)).toBe(false)
    expect(await branchRepo.hasAnyBranch(db, OTHER)).toBe(true)
    expect(await branchRepo.listActiveBranches(db, TEST_TENANT)).toEqual([])
    expect(await branchRepo.listActiveBranches(db, OTHER)).toHaveLength(1)
    expect(await branchRepo.hoursOf(db, TEST_TENANT, 'their-branch')).toEqual([])
    expect(await branchRepo.hoursOf(db, OTHER, 'their-branch')).toEqual([{ weekday: 1, startMinute: 480, endMinute: 1020 }])
    expect(await branchRepo.listTables(db, TEST_TENANT, 'their-branch', 'all')).toEqual([])
    expect(await branchRepo.listTables(db, OTHER, 'their-branch', 'all')).toHaveLength(1)
    expect(await branchRepo.findTable(db, TEST_TENANT, 'their-branch', 'their-table')).toBeUndefined()
    expect(await branchRepo.findTable(db, OTHER, 'their-branch', 'their-table')).toMatchObject({ label: 'Table 1' })
    expect(await branchRepo.countTables(db, TEST_TENANT, 'their-branch')).toBe(0)
    expect(await branchRepo.countTables(db, OTHER, 'their-branch')).toBe(1)
    expect(await branchRepo.findTableByTokenHash(db, 'their-hash')).toMatchObject({ tenantId: OTHER, branchId: 'their-branch', tableId: 'their-table' })
  })

  it('changes neither another cafe\'s table nor its hours; stale and archived edits still stop', async () => {
    await run(branchRepo.touchTableStatement(db, TEST_TENANT, 'their-table', 1, { label: 'Wrong' }, NOW))
    expect(await branchRepo.findTable(db, OTHER, 'their-branch', 'their-table')).toMatchObject({ label: 'Table 1', version: 1 })
    await run(...branchRepo.replaceHoursStatements(db, TEST_TENANT, 'their-branch', []))
    expect(await branchRepo.hoursOf(db, OTHER, 'their-branch')).toHaveLength(1)
    await run(branchRepo.touchBranchStatement(db, TEST_TENANT, 'their-branch', 1, { name: 'Wrong' }))
    expect(await branchRepo.findBranch(db, OTHER, 'their-branch')).toMatchObject({ name: 'Theirs', version: 1 })
    await run(branchRepo.touchTableStatement(db, OTHER, 'their-table', 1, { label: 'Changed' }, NOW), requireOneChange(db))
    await expect(run(branchRepo.touchTableStatement(db, OTHER, 'their-table', 1, { label: 'Stale' }, NOW), requireOneChange(db))).rejects.toSatisfy(isStaleWrite)
    await run(branchRepo.touchTableStatement(db, OTHER, 'their-table', 2, { status: 'archived' }, NOW))
    await expect(run(branchRepo.touchTableStatement(db, OTHER, 'their-table', 3, { label: 'Archived' }, NOW), requireOneChange(db))).rejects.toSatisfy(isStaleWrite)
    await run(...branchRepo.replaceHoursStatements(db, OTHER, 'their-branch', []))
    expect(await branchRepo.hoursOf(db, OTHER, 'their-branch')).toEqual([])
  })

  it('scopes access, staff lists, memberships and last-owner checks to the named cafe', async () => {
    expect(await identity.findTenantRole(db, TEST_TENANT, 'person')).toBeUndefined()
    expect(await identity.findTenantRole(db, OTHER, 'person')).toBe('owner')
    expect(await identity.findBranchAccess(db, TEST_TENANT, 'their-branch', 'person')).toBeUndefined()
    expect(await identity.findBranchAccess(db, OTHER, 'their-branch', 'person')).toEqual({ status: 'active', staffRole: 'manager' })
    expect(await identity.listStaffBranches(db, TEST_TENANT, 'person')).toEqual([])
    expect(await identity.listStaffBranches(db, OTHER, 'person')).toHaveLength(1)
    expect(await staff.membershipsOf(db, TEST_TENANT, ['person'])).toEqual([])
    expect(await staff.membershipsOf(db, OTHER, ['person'])).toHaveLength(1)
    expect(await staff.activeBranchIds(db, TEST_TENANT, ['their-branch'])).toEqual(new Set())
    expect(await staff.activeBranchIds(db, OTHER, ['their-branch'])).toEqual(new Set(['their-branch']))
    expect(await staff.ownersAmong(db, TEST_TENANT, ['person'])).toEqual(new Set())
    expect(await staff.ownersAmong(db, OTHER, ['person'])).toEqual(new Set(['person']))
    expect(await staff.ownersOf(db, TEST_TENANT)).toEqual([])
    expect(await staff.ownersOf(db, OTHER)).toEqual([expect.objectContaining({ id: 'person', banned: false, staffAccess: true })])
    expect(await staff.hasBranchRole(db, TEST_TENANT, 'person')).toBe(false)
    expect(await staff.hasBranchRole(db, OTHER, 'person')).toBe(true)
    expect(await staff.countOwners(db, TEST_TENANT)).toBe(0)
    expect(await staff.countOwners(db, OTHER)).toBe(1)
    await expect(run(staff.requireAnOwner(db, TEST_TENANT))).rejects.toSatisfy(isStaleWrite)
    await run(staff.requireAnOwner(db, OTHER))
    for (const query of [{}, { role: 'admin' as const }, { role: 'manager' as const }, { branchId: 'their-branch' }]) {
      expect(await staff.listStaff(db, TEST_TENANT, { page: 1, pageSize: 20, ...query })).toEqual({ rows: [], total: 0 })
      expect(await staff.listStaff(db, OTHER, { page: 1, pageSize: 20, ...query })).toEqual({ rows: [expect.objectContaining({ id: 'person' })], total: 1 })
    }
    expect(await identity.workspaceRoles(db, 'person')).toEqual({ memberships: [{ tenantId: OTHER, role: 'owner' }], staff: [{ tenantId: OTHER, role: 'manager' }] })
    await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, 'their-branch'))
    expect((await identity.workspaceRoles(db, 'person')).staff).toEqual([])
  })

  it('replaces access only in the named cafe, retaining their membership and branch role', async () => {
    await run(...staff.replaceAccessStatements(db, TEST_TENANT, 'person', null, [], NOW))
    expect(await identity.findTenantRole(db, OTHER, 'person')).toBe('owner')
    expect(await staff.membershipsOf(db, OTHER, ['person'])).toHaveLength(1)
    await run(...staff.setTenantRoleStatements(db, TEST_TENANT, 'person', null, NOW))
    expect(await identity.findTenantRole(db, OTHER, 'person')).toBe('owner')
    await run(...staff.replaceAccessStatements(db, OTHER, 'person', 'member', [], NOW))
    expect(await identity.findTenantRole(db, OTHER, 'person')).toBe('member')
    expect(await staff.membershipsOf(db, OTHER, ['person'])).toEqual([])
  })

  it('keeps customer profiles, internal notes and former addresses in their cafe', async () => {
    expect(await customers.findProfile(db, TEST_TENANT, 'person')).toBeUndefined()
    expect(await customers.findProfile(db, OTHER, 'person')).toMatchObject({ memberCode: 'THEIRCODE' })
    expect(await tenants.findNotes(db, TEST_TENANT)).toBeUndefined()
    expect(await tenants.findNotes(db, OTHER)).toMatchObject({ notes: 'Private', version: 1 })
    await run(tenants.updateNotesStatement(db, TEST_TENANT, 1, { ...notes, notes: 'Wrong' }))
    expect(await tenants.findNotes(db, OTHER)).toMatchObject({ notes: 'Private', version: 1 })
    await run(tenants.updateNotesStatement(db, OTHER, 1, { ...notes, notes: 'Changed' }))
    expect(await tenants.findNotes(db, OTHER)).toMatchObject({ notes: 'Changed', version: 2 })
    expect(await tenants.slugsOf(db, TEST_TENANT, TEST_TENANT)).toEqual([])
    expect(await tenants.slugsOf(db, OTHER, 'current')).toEqual([OTHER])
    await run(tenants.forgetOwnSlugStatement(db, TEST_TENANT, OTHER))
    expect(await tenants.findSlugOwner(db, OTHER)).toBe(OTHER)
    await run(tenants.forgetOwnSlugStatement(db, OTHER, OTHER))
    expect(await tenants.findSlugOwner(db, OTHER)).toBeUndefined()
  })

  it('shares legacy-null account and active-owner rules across reads and guards', async () => {
    expect(await staff.findEligibleAccount(db, 'person')).toBeDefined()
    expect(await accounts.findRegisteredAccount(db, 'person')).toBeDefined()
    expect(await accounts.activeOwnerCounts(db, [TEST_TENANT, OTHER])).toEqual(new Map([[OTHER, 1]]))
    expect((await tenants.listTenants(db, { page: 1, pageSize: 20, owner: 'none' })).rows.map(row => row.id)).toEqual([TEST_TENANT])
    await run(staff.requireEligibleAccount(db, 'person'))
    await db.update(user).set({ banned: true }).where(eq(user.id, 'person'))
    expect(await staff.countOwners(db, OTHER)).toBe(0)
    expect(await accounts.activeOwnerCounts(db, [OTHER])).toEqual(new Map())
    expect(await tenants.overviewCounts(db, new Date(0))).toEqual({ created: 2, ownerless: 2 })
    await expect(run(staff.requireAnOwner(db, OTHER))).rejects.toSatisfy(isStaleWrite)
    await expect(run(staff.requireEligibleAccount(db, 'person'))).rejects.toSatisfy(isStaleWrite)
    await db.update(user).set({ banned: false, isAnonymous: true }).where(eq(user.id, 'person'))
    expect(await staff.findEligibleAccount(db, 'person')).toBeUndefined()
    expect(await accounts.findRegisteredAccount(db, 'person')).toBeUndefined()
    await expect(run(staff.requireEligibleAccount(db, 'person'))).rejects.toSatisfy(isStaleWrite)
  })

  it('checks owners by the cafe membership and account key, without scanning all customer accounts', async () => {
    const seen: { sql: string, params: unknown[] }[] = []
    const probe = await createTestDb({ logger: { logQuery: (query, params) => void seen.push({ sql: query, params }) } })
    await staff.countOwners(probe, OTHER)
    const read = seen.find(query => query.sql.includes('from "member"'))!
    const client = (probe as unknown as { $client: { execute: (query: { sql: string, args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> } }).$client
    const details = (await client.execute({ sql: `explain query plan ${read.sql}`, args: read.params })).rows.map(row => String(row.detail))
    expect(details.filter(detail => /^SCAN user\b/.test(detail)), details.join(' | ')).toEqual([])
    expect(details.some(detail => /SEARCH user.*\(id=\?\)/.test(detail)), details.join(' | ')).toBe(true)
  })

  it('filters active cafes in SQL, keeps oldest-cafe fallback and pages by stable id', async () => {
    await db.update(organization).set({ status: null, createdAt: new Date(0) }).where(eq(organization.id, OTHER))
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, TEST_TENANT))
    expect(await tenants.listActiveTenants(db)).toEqual([{ id: OTHER, slug: OTHER, name: `Cafe ${OTHER}` }])
    expect(await tenants.listActiveTenantPage(db, null, 1)).toEqual(await tenants.listActiveTenants(db))
    expect(await tenants.listActiveTenantPage(db, OTHER, 1)).toEqual([])
    expect(await tenants.findOldestTenant(db)).toMatchObject({ id: OTHER })
    expect(await tenants.findTenantBySlug(db, OTHER)).toMatchObject({ id: OTHER })
    expect(await tenants.listActiveTenantIds(db)).toEqual([OTHER])
  })
})
