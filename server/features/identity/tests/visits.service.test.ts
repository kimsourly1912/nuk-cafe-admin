import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { workspaceVisits } from '#server/db/tables'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { createStaff, getStaffMember, listStaff, seedFirstOwner, updateStaffAccess } from '#server/features/identity/staff.service'
import { recordWorkspaceVisit, VISIT_INTERVAL_MS } from '#server/features/identity/visits.service'
import type { Actor } from '#server/features/identity/identity.types'

// "Last active here" on the Staff page (account security step 4, D248): when a person last opened
// this cafe's admin or counter, never another cafe's.

let db: Db
let ours: Actor
let theirs: Actor
let ourBranch: string
let theirBranch: string
const OTHER = 'tenant-2'
const PAGE = { page: 1, pageSize: 20 }
const AT = new Date('2026-11-01T03:00:00.000Z')
const later = (ms: number) => new Date(AT.getTime() + ms)

beforeEach(async () => {
  db = await createTestDb()
  ourBranch = newId()
  theirBranch = newId()
  await insertBranch(db, { id: ourBranch, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
  await ensureTenant(db, OTHER)
  await insertBranch(db, { id: theirBranch, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
  const owner = await seedFirstOwner(db, await ensureTenant(db), { name: 'Owner', email: 'owner@example.com' })
  ours = { userId: owner!.staff.id, tenantId: TEST_TENANT, role: 'owner' }
  const theirOwner = await seedFirstOwner(db, OTHER, { name: 'Their owner', email: 'their-owner@example.com' })
  theirs = { userId: theirOwner!.staff.id, tenantId: OTHER, role: 'owner' }
})

/** Sophea works at both cafes, as staff. */
async function staffAtBoth() {
  const { staff } = await createStaff(db, ours, { name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId: ourBranch, role: 'staff' }] })
  await createStaff(db, theirs, { name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId: theirBranch, role: 'staff' }] })
  return staff
}
const lastActiveIn = async (actor: Actor, userId: string) => (await listStaff(db, actor, PAGE)).items.find(s => s.id === userId)?.lastActiveAt

describe('last active here', () => {
  it('is "not yet" until the person opens the cafe\'s workspace, then that time', async () => {
    const sophea = await staffAtBoth()
    expect(await lastActiveIn(ours, sophea.id)).toBeNull()
    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, AT)
    expect(await lastActiveIn(ours, sophea.id)).toBe(AT.toISOString())
    expect((await getStaffMember(db, ours, sophea.id)).lastActiveAt).toBe(AT.toISOString())
  })

  it('is each cafe\'s own: working at another cafe never shows here (two cafes)', async () => {
    const sophea = await staffAtBoth()
    await recordWorkspaceVisit(db, OTHER, sophea.id, AT)
    expect(await lastActiveIn(theirs, sophea.id)).toBe(AT.toISOString())
    expect(await lastActiveIn(ours, sophea.id)).toBeNull()
    expect((await getStaffMember(db, ours, sophea.id)).lastActiveAt).toBeNull()

    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, later(5 * VISIT_INTERVAL_MS))
    expect(await lastActiveIn(theirs, sophea.id)).toBe(AT.toISOString())
  })

  it('is written at most once an hour, however often the workspace opens', async () => {
    const sophea = await staffAtBoth()
    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, AT)
    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, later(VISIT_INTERVAL_MS - 1000))
    expect(await lastActiveIn(ours, sophea.id)).toBe(AT.toISOString())
    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, later(VISIT_INTERVAL_MS + 1000))
    expect(await lastActiveIn(ours, sophea.id)).toBe(later(VISIT_INTERVAL_MS + 1000).toISOString())
  })

  it('two visits at once both succeed: one row', async () => {
    const sophea = await staffAtBoth()
    await Promise.all([recordWorkspaceVisit(db, TEST_TENANT, sophea.id, AT), recordWorkspaceVisit(db, TEST_TENANT, sophea.id, AT)])
    expect(await db.select().from(workspaceVisits).where(eq(workspaceVisits.userId, sophea.id))).toHaveLength(1)
  })

  it('stays when their access changes (the membership row is replaced then)', async () => {
    const sophea = await staffAtBoth()
    await recordWorkspaceVisit(db, TEST_TENANT, sophea.id, AT)
    const before = await getStaffMember(db, ours, sophea.id)
    await updateStaffAccess(db, ours, sophea.id, { version: before.version, admin: false, memberships: [{ branchId: ourBranch, role: 'manager' }] })
    expect(await lastActiveIn(ours, sophea.id)).toBe(AT.toISOString())
  })
})
