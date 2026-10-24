import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WeeklyWindow } from '#shared/contracts/common'
import { MAX_BRANCH_TABLES, MAX_BRANCHES } from '#shared/contracts/branches'
import { branches, organization, user } from '#server/db/tables'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { archiveTable, createBranch, createTable, deleteTable, getBranchPause, getBranchSettings, listBranchOptions, pauseBranch, resumeBranch, getPublicBranch, listPublicBranches, listTables, resolveTableToken, restoreTable, rotateTableQr, scanTableToken, updateBranchSettings, updateTable } from '#server/features/branches/branches.service'
import { diningTables } from '#server/features/branches/branches.schema'
import { deleteTableStatement } from '#server/features/branches/branches.repository'
import type { QrConfig } from '#server/features/branches/branches.qr'
import { qrConfigFrom, tableToken, tokenHash } from '#server/features/branches/branches.qr'
import { createTestDb, createUser, ensureTenant, insertBranch, insertSoldLine, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
let branch: string
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
const qr: QrConfig = { secret: 'test-secret', baseUrl: 'https://cafe.example' }

async function addBranch(timezone = 'Asia/Phnom_Penh') {
  const id = newId()
  await insertBranch(db, { id, name: `Branch ${id}`, timezone, status: 'active' })
  return id
}

beforeEach(async () => {
  db = await createTestDb()
  branch = await addBranch()
})

const w = (weekday: number, startMinute: number, endMinute: number): WeeklyWindow => ({ weekday, startMinute, endMinute })
const weekdays = (start: number, end: number) => [1, 2, 3, 4, 5].map(day => w(day, start, end))
/** Monday 2026-09-28 10:00 in Phnom Penh (UTC+7). */
const MONDAY_10AM = new Date('2026-09-28T03:00:00Z')
const tokenOf = (qrUrl: string | null) => qrUrl!.split('/').pop()!
const auditOf = async (targetId: string) => db.select().from(auditEvents).where(eq(auditEvents.targetId, targetId))

describe('branch settings', () => {
  it('reads the branch at version 1 with no hours: closed', async () => {
    const settings = await getBranchSettings(db, TEST_TENANT, branch, MONDAY_10AM)
    expect(settings).toMatchObject({ id: branch, timezone: 'Asia/Phnom_Penh', address: null, phone: null, status: 'active', hours: [], openNow: false, today: 1, version: 1 })
  })

  it('saves details and hours in one version, sorted, audited; open or closed by its own clock', async () => {
    const saved = await updateBranchSettings(db, actor, branch, {
      version: 1,
      name: 'NUK Cafe Phnom Penh',
      address: '#123 St. 63',
      phone: '+85512345678',
      hours: [w(6, 480, 1140), ...weekdays(480, 1140)],
    })
    expect(saved).toMatchObject({ name: 'NUK Cafe Phnom Penh', address: '#123 St. 63', phone: '+85512345678', version: 2 })
    expect(saved.hours).toEqual([...weekdays(480, 1140), w(6, 480, 1140)])
    expect((await getBranchSettings(db, TEST_TENANT, branch, MONDAY_10AM)).openNow).toBe(true)
    // Sunday 10:00 there: closed.
    expect(await getBranchSettings(db, TEST_TENANT, branch, new Date('2026-09-27T03:00:00Z'))).toMatchObject({ openNow: false, today: 7 })

    const [row] = await auditOf(branch)
    expect(row).toMatchObject({ action: 'branch.update', actorId: 'admin-1', requestId: 'req-1' })
    expect(row!.metadata).toMatchObject({ name: { to: 'NUK Cafe Phnom Penh' }, hours: { from: [] } })
  })

  it('keeps absent fields; null or blank clears address and phone; [] closes the branch', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, address: 'Somewhere', phone: '+85512345678', hours: weekdays(480, 1140) })
    const saved = await updateBranchSettings(db, actor, branch, { version: 2, address: null, phone: null })
    expect(saved).toMatchObject({ address: null, phone: null })
    expect(saved.hours).toHaveLength(5)
    expect((await updateBranchSettings(db, actor, branch, { version: 3, hours: [] })).hours).toEqual([])
  })

  it('opens past midnight on the day a window starts', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, hours: [w(5, 1080, 120)] })
    // Saturday 01:00 in Phnom Penh: Friday's 18:00–02:00.
    expect((await getBranchSettings(db, TEST_TENANT, branch, new Date('2026-10-02T18:00:00Z'))).openNow).toBe(true)
    expect((await getBranchSettings(db, TEST_TENANT, branch, new Date('2026-10-02T19:30:00Z'))).openNow).toBe(false)
  })

  it('follows a new timezone at once', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, hours: weekdays(480, 1140) })
    // 03:00 UTC Monday is 10:00 in Phnom Penh (open), 23:00 Sunday in New York (closed).
    const saved = await updateBranchSettings(db, actor, branch, { version: 2, timezone: 'America/New_York' })
    expect(saved.timezone).toBe('America/New_York')
    expect((await getBranchSettings(db, TEST_TENANT, branch, MONDAY_10AM)).openNow).toBe(false)
  })

  it('refuses an unknown timezone and overlapping windows on their fields', async () => {
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, timezone: 'Mars/Base' }), 422, 'UNKNOWN_TIMEZONE', ['timezone'])
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, hours: [w(1, 1320, 120), w(2, 60, 180)] }), 422, 'BRANCH_HOURS', ['hours.1'])
    expect((await getBranchSettings(db, TEST_TENANT, branch)).version).toBe(1)
  })

  it('refuses a stale version, and one that goes stale between the check and the write', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, name: 'First' })
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, name: 'Second' }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => db.update(branches).set({ version: 3 }).where(eq(branches.id, branch)))
    await expectApiError(() => updateBranchSettings(racing, actor, branch, { version: 2, name: 'Third', hours: weekdays(0, 60) }), 409, 'VERSION_CONFLICT')
    const settings = await getBranchSettings(db, TEST_TENANT, branch)
    expect(settings).toMatchObject({ name: 'First', hours: [] })
  })

  it('stores the most hours a week in one save (D1\'s parameter limit)', async () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].flatMap(day => [w(day, 360, 600), w(day, 660, 900), w(day, 960, 1200)])
    expect((await updateBranchSettings(db, actor, branch, { version: 1, hours })).hours).toHaveLength(21)
  })

  it('404s an unknown branch', async () => {
    await expectApiError(() => getBranchSettings(db, TEST_TENANT, newId()), 404, 'NOT_FOUND')
  })
})

describe('adding branches (D197)', () => {
  const OTHER = 'tenant-2'
  /** Active branches of the test cafe up to `total` (the one from `beforeEach` included). */
  async function fillTo(total: number, tenantId = TEST_TENANT) {
    const have = tenantId === TEST_TENANT ? 1 : 0
    for (let i = have; i < total; i++) await insertBranch(db, { id: newId(), name: `Filled ${i}`, timezone: 'Asia/Phnom_Penh', tenantId })
  }

  it('adds an active branch in the cafe: closed until its hours are set, listed, audited', async () => {
    const added = await createBranch(db, actor, { name: 'Riverside', timezone: 'Asia/Bangkok' })
    expect(added).toMatchObject({ name: 'Riverside', timezone: 'Asia/Bangkok', status: 'active', hours: [], openNow: false, address: null, phone: null, version: 1 })
    expect((await listBranchOptions(db, TEST_TENANT)).map(b => b.name)).toContain('Riverside')
    const [row] = await auditOf(added.id)
    expect(row).toMatchObject({ action: 'branch.create', actorId: 'admin-1', tenantId: TEST_TENANT, requestId: 'req-1' })
    expect(row!.metadata).toEqual({ name: 'Riverside', timezone: 'Asia/Bangkok' })
  })

  it('refuses an unknown time zone on its field, writing nothing', async () => {
    await expectApiError(() => createBranch(db, actor, { name: 'Riverside', timezone: 'Mars/Olympus' }), 422, 'UNKNOWN_TIMEZONE', ['timezone'])
    expect(await listBranchOptions(db, TEST_TENANT)).toHaveLength(1)
  })

  it('refuses a name another active branch of the cafe has, in any case, also on a rename', async () => {
    await createBranch(db, actor, { name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    await expectApiError(() => createBranch(db, actor, { name: 'RIVERSIDE', timezone: 'Asia/Phnom_Penh' }), 409, 'BRANCH_NAME_TAKEN', ['name'])
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, name: 'riverside' }), 409, 'BRANCH_NAME_TAKEN', ['name'])
    // An archived branch's name and another cafe's don't count.
    await insertBranch(db, { id: newId(), name: 'Old Town', timezone: 'Asia/Phnom_Penh', status: 'archived' })
    await insertBranch(db, { id: newId(), name: 'Airport', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    await createBranch(db, actor, { name: 'Old Town', timezone: 'Asia/Phnom_Penh' })
    await createBranch(db, actor, { name: 'Airport', timezone: 'Asia/Phnom_Penh' })
  })

  it(`allows at most ${MAX_BRANCHES} active branches per cafe; archived ones and other cafes' don't count`, async () => {
    await fillTo(MAX_BRANCHES - 1)
    await insertBranch(db, { id: newId(), name: 'Closed down', timezone: 'Asia/Phnom_Penh', status: 'archived' })
    await fillTo(MAX_BRANCHES, OTHER)
    const last = await createBranch(db, actor, { name: 'Tenth', timezone: 'Asia/Phnom_Penh' })
    await expectApiError(() => createBranch(db, actor, { name: 'Eleventh', timezone: 'Asia/Phnom_Penh' }), 409, 'BRANCH_LIMIT')
    expect(await listBranchOptions(db, TEST_TENANT)).toHaveLength(MAX_BRANCHES)
    expect((await listBranchOptions(db, TEST_TENANT)).map(b => b.name)).not.toContain('Eleventh')
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.create'))).map(r => r.targetId)).toEqual([last.id])
  })

  it('the limit holds when another branch is added between the check and the write', async () => {
    await fillTo(MAX_BRANCHES - 1)
    const racing = interleaved(db, () => insertBranch(db, { id: newId(), name: 'Meanwhile', timezone: 'Asia/Phnom_Penh' }))
    await expectApiError(() => createBranch(racing, actor, { name: 'Tenth', timezone: 'Asia/Phnom_Penh' }), 409, 'BRANCH_LIMIT')
    expect((await listBranchOptions(db, TEST_TENANT)).map(b => b.name)).not.toContain('Tenth')
  })

  it('adds to the actor\'s cafe only', async () => {
    const theirOwner: Actor = { userId: 'their-owner', tenantId: OTHER, role: 'owner' }
    await ensureTenant(db, OTHER)
    const theirs = await createBranch(db, theirOwner, { name: 'Their branch', timezone: 'Asia/Phnom_Penh' })
    await expectApiError(() => getBranchSettings(db, TEST_TENANT, theirs.id), 404, 'NOT_FOUND')
    expect((await listBranchOptions(db, TEST_TENANT)).map(b => b.id)).toEqual([branch])
    expect((await db.select({ tenantId: branches.tenantId }).from(branches).where(eq(branches.id, theirs.id)))).toEqual([{ tenantId: OTHER }])
  })
})

describe('pausing online orders (D199)', () => {
  let manager: Actor
  /** Open 08:00 to 19:00 every day; Monday 10:00 there is MONDAY_10AM. */
  const allDay = [1, 2, 3, 4, 5, 6, 7].map(day => w(day, 480, 1140))
  const at = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)

  beforeEach(async () => {
    manager = { userId: (await createUser(db, 'mony@example.com', 'Mony Chan')).id, tenantId: TEST_TENANT, role: 'member', requestId: 'req-2' }
    await updateBranchSettings(db, actor, branch, { version: 1, hours: allDay })
  })

  it('pauses for the chosen time, shows it to customers and staff, then ends by itself', async () => {
    const pause = await pauseBranch(db, manager, branch, { for: '30m', reason: 'Machine broken' }, MONDAY_10AM)
    expect(pause).toEqual({ branchId: branch, pausedUntil: '2026-09-28T03:30:00.000Z', reason: 'Machine broken', pausedByName: 'Mony Chan' })
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('10:29'))).pausedUntil).toBe('2026-09-28T03:30:00.000Z')
    // Over: customers see nothing, staff see no pause.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('10:30'))).pausedUntil).toBeNull()
    expect(await getBranchPause(db, TEST_TENANT, branch, at('10:30'))).toEqual({ branchId: branch, pausedUntil: null, reason: null, pausedByName: null })
    const [row] = await auditOf(branch).then(rows => rows.filter(r => r.action === 'branch.pause'))
    expect(row).toMatchObject({ actorId: manager.userId, requestId: 'req-2' })
    expect(row!.metadata).toEqual({ for: '30m', until: '2026-09-28T03:30:00.000Z', reason: 'Machine broken' })
  })

  it('never lasts past closing; "until closing" ends at closing; a closed branch has nothing to pause', async () => {
    expect((await pauseBranch(db, manager, branch, { for: '1h', reason: null }, at('18:40'))).pausedUntil).toBe(at('19:00').toISOString())
    expect((await pauseBranch(db, manager, branch, { for: 'closing', reason: null }, at('12:00'))).pausedUntil).toBe(at('19:00').toISOString())
    await expectApiError(() => pauseBranch(db, manager, branch, { for: '15m', reason: null }, at('19:30')), 409, 'BRANCH_CLOSED')
    // Tomorrow morning it's open as usual.
    expect((await getPublicBranch(db, TEST_TENANT, branch, new Date('2026-09-29T01:00:00Z'))).pausedUntil).toBeNull()
  })

  it('pausing again replaces the pause; resuming ends it at once, audited once', async () => {
    await pauseBranch(db, manager, branch, { for: '15m', reason: 'Rush' }, MONDAY_10AM)
    const owner: Actor = { ...actor, userId: (await createUser(db, 'owner@example.com', 'Owner')).id }
    expect((await pauseBranch(db, owner, branch, { for: '1h', reason: null }, at('10:05'))).pausedUntil).toBe(at('11:05').toISOString())
    expect(await resumeBranch(db, manager, branch, at('10:10'))).toMatchObject({ pausedUntil: null })
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('10:10'))).pausedUntil).toBeNull()
    // Not paused: nothing to do, nothing audited.
    await resumeBranch(db, manager, branch, at('10:11'))
    expect((await auditOf(branch)).filter(r => r.action === 'branch.resume')).toHaveLength(1)
  })

  it('leaves the branch\'s version alone: an owner\'s settings save made before the pause still saves', async () => {
    const before = await getBranchSettings(db, TEST_TENANT, branch)
    await pauseBranch(db, manager, branch, { for: '30m', reason: null }, MONDAY_10AM)
    await updateBranchSettings(db, actor, branch, { version: before.version, name: 'Riverside' })
    expect((await getBranchSettings(db, TEST_TENANT, branch)).version).toBe(before.version + 1)
  })

  it('keeps the pause when the account that set it is deleted, without a name', async () => {
    await pauseBranch(db, manager, branch, { for: '30m', reason: null }, MONDAY_10AM)
    await db.delete(user).where(eq(user.id, manager.userId))
    expect(await getBranchPause(db, TEST_TENANT, branch, at('10:10'))).toMatchObject({ pausedUntil: '2026-09-28T03:30:00.000Z', pausedByName: null })
  })

  it('another cafe\'s branch is not found, and an archived branch can\'t be paused', async () => {
    const theirs = newId()
    await insertBranch(db, { id: theirs, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: 'tenant-2' })
    await expectApiError(() => pauseBranch(db, manager, theirs, { for: '15m', reason: null }, MONDAY_10AM), 404, 'NOT_FOUND')
    await expectApiError(() => getBranchPause(db, TEST_TENANT, theirs), 404, 'NOT_FOUND')
    await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, branch))
    await expectApiError(() => pauseBranch(db, manager, branch, { for: '15m', reason: null }, MONDAY_10AM), 409, 'INVALID_STATE')
  })
})

describe('table QR tokens', () => {
  it('are rebuilt the same from the same secret, table and version, and differ otherwise', async () => {
    const token = await tableToken('s', 'table-1', 1)
    expect(token).toMatch(/^[\w-]{22}$/)
    expect(await tableToken('s', 'table-1', 1)).toBe(token)
    expect(await tableToken('s', 'table-1', 2)).not.toBe(token)
    expect(await tableToken('s', 'table-2', 1)).not.toBe(token)
    expect(await tableToken('other', 'table-1', 1)).not.toBe(token)
  })

  it('need a secret on a deployed server; the dev server uses a local one', () => {
    expect(() => qrConfigFrom({ secret: '', siteUrl: 'https://cafe.example', requestOrigin: 'https://x', dev: false })).toThrow()
    expect(qrConfigFrom({ secret: '', siteUrl: undefined, requestOrigin: 'http://localhost:3000', dev: true }).baseUrl).toBe('http://localhost:3000')
    expect(qrConfigFrom({ secret: 'k', siteUrl: 'https://cafe.example/', requestOrigin: 'https://x', dev: false })).toEqual({ secret: 'k', baseUrl: 'https://cafe.example' })
  })
})

describe('dining tables', () => {
  it('creates a table with a QR link on the site, stores only its hash, audits without the token', async () => {
    const table = await createTable(db, actor, branch, { label: 'Table 1', area: 'Main floor' }, qr)
    expect(table).toMatchObject({ branchId: branch, label: 'Table 1', area: 'Main floor', status: 'active', version: 1 })
    expect(table.qrUrl).toMatch(/^https:\/\/cafe\.example\/table\/[\w-]{22}$/)

    const [row] = await db.select().from(diningTables).where(eq(diningTables.id, table.id))
    expect(row!.qrTokenHash).toBe(await tokenHash(tokenOf(table.qrUrl)))
    expect(JSON.stringify(row)).not.toContain(tokenOf(table.qrUrl))
    const [audit] = await auditOf(table.id)
    expect(audit).toMatchObject({ action: 'branch.table.create', targetType: 'dining_table' })
    expect(JSON.stringify(audit)).not.toContain(tokenOf(table.qrUrl))
  })

  it('shows the same QR again, and resolves it to the branch and table', async () => {
    const table = await createTable(db, actor, branch, { label: 'Table 1', area: null }, qr)
    const [listed] = await listTables(db, TEST_TENANT, branch, { status: 'active' }, qr)
    expect(listed!.qrUrl).toBe(table.qrUrl)
    expect(await resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl))).toEqual({ branch: { id: branch, name: `Branch ${branch}` }, table: { id: table.id, label: 'Table 1' } })
  })

  it('a scanned QR anywhere names its cafe; archived tables and paused cafes are 404 (D140)', async () => {
    const table = await createTable(db, actor, branch, { label: 'Table 1', area: null }, qr)
    const token = tokenOf(table.qrUrl)
    expect(await scanTableToken(db, token)).toEqual({ cafe: { slug: TEST_TENANT, name: `Cafe ${TEST_TENANT}` }, branch: { id: branch, name: `Branch ${branch}` }, table: { id: table.id, label: 'Table 1' } })
    await expectApiError(() => scanTableToken(db, 'not-a-token'), 404, 'NOT_FOUND')
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, TEST_TENANT))
    await expectApiError(() => scanTableToken(db, token), 404, 'NOT_FOUND')
    await db.update(organization).set({ status: 'active' }).where(eq(organization.id, TEST_TENANT))
    await archiveTable(db, actor, branch, table.id, { version: 1 }, qr)
    await expectApiError(() => scanTableToken(db, token), 404, 'NOT_FOUND')
  })

  it('lists by label as people read them, per status', async () => {
    for (const label of ['Table 10', 'Table 2', 'patio 1']) await createTable(db, actor, branch, { label, area: null }, qr)
    const old = await createTable(db, actor, branch, { label: 'Old', area: null }, qr)
    await archiveTable(db, actor, branch, old.id, { version: 1 }, qr)
    expect((await listTables(db, TEST_TENANT, branch, { status: 'active' }, qr)).map(t => t.label)).toEqual(['patio 1', 'Table 2', 'Table 10'])
    expect((await listTables(db, TEST_TENANT, branch, { status: 'archived' }, qr)).map(t => [t.label, t.qrUrl])).toEqual([['Old', null]])
    expect(await listTables(db, TEST_TENANT, branch, { status: 'all' }, qr)).toHaveLength(4)
  })

  it('refuses a label an active table in the branch has (any case); other branches and archived tables don\'t count', async () => {
    const first = await createTable(db, actor, branch, { label: 'Table 1', area: null }, qr)
    await expectApiError(() => createTable(db, actor, branch, { label: 'table 1', area: null }, qr), 409, 'TABLE_LABEL_TAKEN', ['label'])
    await createTable(db, actor, await addBranch(), { label: 'Table 1', area: null }, qr)
    await archiveTable(db, actor, branch, first.id, { version: 1 }, qr)
    await createTable(db, actor, branch, { label: 'Table 1', area: null }, qr)
    // Restoring into a taken label is refused.
    await expectApiError(() => restoreTable(db, actor, branch, first.id, { version: 2 }, qr), 409, 'TABLE_LABEL_TAKEN')
  })

  it('renames and clears the area from the version read; the QR stays', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: 'Patio' }, qr)
    const renamed = await updateTable(db, actor, branch, table.id, { version: 1, label: 'Patio 01', area: null }, qr)
    expect(renamed).toMatchObject({ label: 'Patio 01', area: null, version: 2, qrUrl: table.qrUrl })
    await expectApiError(() => updateTable(db, actor, branch, table.id, { version: 1, label: 'X' }, qr), 409, 'VERSION_CONFLICT')
  })

  it('refuses a stale table write that goes stale between the check and the write', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    const racing = interleaved(db, () => db.update(diningTables).set({ version: 2 }).where(eq(diningTables.id, table.id)))
    await expectApiError(() => rotateTableQr(racing, actor, branch, table.id, { version: 1 }, qr), 409, 'VERSION_CONFLICT')
    expect(await resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl))).toMatchObject({ table: { id: table.id } })
  })

  it('rotating makes a new QR and the printed one stops working', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    const rotated = await rotateTableQr(db, actor, branch, table.id, { version: 1 }, qr)
    expect(rotated.qrUrl).not.toBe(table.qrUrl)
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    expect(await resolveTableToken(db, TEST_TENANT, tokenOf(rotated.qrUrl))).toMatchObject({ table: { id: table.id } })
    const audits = await auditOf(table.id)
    expect(audits.map(a => a.action)).toContain('branch.table.rotate_qr')
    expect(JSON.stringify(audits)).not.toContain(tokenOf(rotated.qrUrl))
  })

  it('an archived table\'s QR stops working; restoring brings the same QR back', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    const archived = await archiveTable(db, actor, branch, table.id, { version: 1 }, qr)
    expect(archived).toMatchObject({ status: 'archived', qrUrl: null })
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    await expectApiError(() => updateTable(db, actor, branch, table.id, { version: 2, label: 'X' }, qr), 409, 'INVALID_STATE')
    await expectApiError(() => rotateTableQr(db, actor, branch, table.id, { version: 2 }, qr), 409, 'INVALID_STATE')
    const restored = await restoreTable(db, actor, branch, table.id, { version: 2 }, qr)
    expect(restored.qrUrl).toBe(table.qrUrl)
    await expectApiError(() => restoreTable(db, actor, branch, table.id, { version: 3 }, qr), 409, 'INVALID_STATE')
  })

  it('a table in an archived branch doesn\'t resolve, and the branch\'s tables can\'t be added to', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, branch))
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    await expectApiError(() => createTable(db, actor, branch, { label: 'T2', area: null }, qr), 409, 'INVALID_STATE')
  })

  it('an unknown or malformed token, another secret\'s token, and another branch\'s table are 404', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, 'x'.repeat(22)), 404, 'NOT_FOUND')
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, '../../etc'), 404, 'NOT_FOUND')
    const otherSecretToken = await tableToken('another-secret', table.id, 1)
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, otherSecretToken), 404, 'NOT_FOUND')
    const otherBranch = await addBranch()
    await expectApiError(() => updateTable(db, actor, otherBranch, table.id, { version: 1, label: 'X' }, qr), 404, 'NOT_FOUND')
  })

  it(`allows at most ${MAX_BRANCH_TABLES} tables per branch, archived ones included`, async () => {
    const rows = await Promise.all(Array.from({ length: MAX_BRANCH_TABLES }, async (_, i) => ({
      id: newId(),
      tenantId: TEST_TENANT,
      branchId: branch,
      label: `T${i}`,
      qrTokenHash: await tokenHash(`token-${i}`),
    })))
    // 10 rows a statement: 80 parameters, under D1's 100.
    for (let i = 0; i < rows.length; i += 10) await db.insert(diningTables).values(rows.slice(i, i + 10))
    await expectApiError(() => createTable(db, actor, branch, { label: 'One more', area: null }, qr), 409, 'TABLE_LIMIT')
  })
})

describe('branches for customers (D93)', () => {
  const at = (iso: string) => new Date(iso)
  const openHours = async () => updateBranchSettings(db, actor, branch, {
    version: 1,
    address: '#123 St. 63',
    // Weekdays 07:00–19:00, Saturday 08:00–02:00 (overnight), no Sunday.
    hours: [...weekdays(420, 1140), w(6, 480, 120)],
  })

  it('is open inside its hours, on its own clock, with no next opening', async () => {
    await openHours()
    expect(await getPublicBranch(db, TEST_TENANT, branch, MONDAY_10AM)).toEqual({
      id: branch,
      name: expect.any(String),
      address: '#123 St. 63',
      phone: null,
      timezone: 'Asia/Phnom_Penh',
      openNow: true,
      // Until 19:00 (D99: online orders stop 15 minutes before).
      closesInMinutes: 540,
      nextOpening: null,
      pausedUntil: null,
    })
    // Saturday 23:00 there: open until 02:00, past midnight.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-10-03T16:00:00Z'))).closesInMinutes).toBe(180)
    // Closed: nothing to count down.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-09-28T13:00:00Z'))).closesInMinutes).toBeNull()
  })

  it('says when a closed branch opens: later today, tomorrow, or a later weekday', async () => {
    await openHours()
    // Monday 06:00 there: later today at 07:00.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-09-27T23:00:00Z'))).nextOpening).toEqual({ inDays: 0, weekday: 1, startMinute: 420 })
    // Monday 20:00 there: Tuesday at 07:00.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-09-28T13:00:00Z'))).nextOpening).toEqual({ inDays: 1, weekday: 2, startMinute: 420 })
    // Sunday 03:00 there (Saturday's window ended at 02:00): Monday, tomorrow.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-09-26T20:00:00Z'))).nextOpening).toEqual({ inDays: 1, weekday: 1, startMinute: 420 })
    // Sunday 01:00 there: still in Saturday's overnight window.
    expect((await getPublicBranch(db, TEST_TENANT, branch, at('2026-09-26T18:00:00Z'))).openNow).toBe(true)
  })

  it('opens a week later when its only window just ended, and never without hours', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, hours: [w(1, 420, 600)] })
    // Monday 10:00 exactly: the window ended (end excluded); it opens next Monday.
    expect((await getPublicBranch(db, TEST_TENANT, branch, MONDAY_10AM)).nextOpening).toEqual({ inDays: 7, weekday: 1, startMinute: 420 })
    const other = await addBranch()
    expect(await getPublicBranch(db, TEST_TENANT, other, MONDAY_10AM)).toMatchObject({ openNow: false, nextOpening: null })
  })

  it('lists active branches by name; an archived or unknown one is 404', async () => {
    const archived = await addBranch()
    await db.update(branches).set({ name: 'Archived', status: 'archived' }).where(eq(branches.id, archived))
    const listed = await listPublicBranches(db, TEST_TENANT, MONDAY_10AM)
    expect(listed.map(b => b.id)).toEqual([branch])
    await expectApiError(() => getPublicBranch(db, TEST_TENANT, archived), 404, 'NOT_FOUND')
    await expectApiError(() => getPublicBranch(db, TEST_TENANT, newId()), 404, 'NOT_FOUND')
  })
})

// Another cafe's branches don't exist from here (D134): every read and write names the tenant.
describe('tenants', () => {
  const OTHER = 'tenant-2'
  const theirOwner: Actor = { userId: 'their-owner', tenantId: OTHER, role: 'owner' }
  let theirs: string

  beforeEach(async () => {
    theirs = newId()
    await insertBranch(db, { id: theirs, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
  })

  it('lists and reads only the tenant\'s own branches', async () => {
    expect((await listPublicBranches(db, TEST_TENANT)).map(b => b.id)).toEqual([branch])
    expect((await listPublicBranches(db, OTHER)).map(b => b.id)).toEqual([theirs])
    await expectApiError(() => getBranchSettings(db, TEST_TENANT, theirs), 404, 'NOT_FOUND')
    await expectApiError(() => getPublicBranch(db, TEST_TENANT, theirs), 404, 'NOT_FOUND')
    await expectApiError(() => listTables(db, TEST_TENANT, theirs, { status: 'active' }, qr), 404, 'NOT_FOUND')
  })

  it('refuses every write to another tenant\'s branch and its tables, changing nothing', async () => {
    const table = await createTable(db, theirOwner, theirs, { label: 'T1', area: null }, qr)
    await expectApiError(() => updateBranchSettings(db, actor, theirs, { version: 1, name: 'Mine now' }), 404, 'NOT_FOUND')
    await expectApiError(() => createTable(db, actor, theirs, { label: 'T2', area: null }, qr), 404, 'NOT_FOUND')
    await expectApiError(() => updateTable(db, actor, theirs, table.id, { version: table.version, label: 'X' }, qr), 404, 'NOT_FOUND')
    await expectApiError(() => archiveTable(db, actor, theirs, table.id, { version: table.version }, qr), 404, 'NOT_FOUND')
    await expectApiError(() => rotateTableQr(db, actor, theirs, table.id, { version: table.version }, qr), 404, 'NOT_FOUND')
    expect((await getBranchSettings(db, OTHER, theirs)).name).toBe('Their branch')
    expect((await listTables(db, OTHER, theirs, { status: 'all' }, qr)).map(t => [t.label, t.version, t.status])).toEqual([['T1', 1, 'active']])
  })

  it('doesn\'t resolve another tenant\'s table QR', async () => {
    const table = await createTable(db, theirOwner, theirs, { label: 'T1', area: null }, qr)
    await expectApiError(() => resolveTableToken(db, TEST_TENANT, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    expect((await resolveTableToken(db, OTHER, tokenOf(table.qrUrl))).table.id).toBe(table.id)
  })
})

describe('deleting a table permanently (D200)', () => {
  const exists = async (id: string) => (await db.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.id, id))).length === 1
  const archived = async (label: string) => {
    const table = await createTable(db, actor, branch, { label, area: null }, qr)
    return archiveTable(db, actor, branch, table.id, { version: table.version }, qr)
  }

  it('deletes an archived table no order was placed at, and keeps its label in the audit', async () => {
    const table = await archived('Table 9')
    expect(table.deleteBlocker).toBeNull()
    await deleteTable(db, actor, branch, table.id, { version: table.version })
    expect(await exists(table.id)).toBe(false)
    expect(await auditOf(table.id)).toContainEqual(expect.objectContaining({ action: 'branch.table.delete', metadata: { branchId: branch, label: 'Table 9' } }))
  })

  it('refuses an active table, a stale version, another branch and an unknown one', async () => {
    const active = await createTable(db, actor, branch, { label: 'Table 1', area: null }, qr)
    await expectApiError(() => deleteTable(db, actor, branch, active.id, { version: active.version }), 409, 'INVALID_STATE')
    const table = await archiveTable(db, actor, branch, active.id, { version: active.version }, qr)
    await expectApiError(() => deleteTable(db, actor, branch, table.id, { version: active.version }), 409, 'VERSION_CONFLICT')
    const other = await addBranch()
    await expectApiError(() => deleteTable(db, actor, other, table.id, { version: table.version }), 404, 'NOT_FOUND')
    await expectApiError(() => deleteTable(db, actor, branch, newId(), { version: 1 }), 404, 'NOT_FOUND')
    expect(await exists(table.id)).toBe(true)
  })

  it('refuses a table an order was placed at: it stays archived', async () => {
    const table = await archived('Table 2')
    await insertSoldLine(db, { itemId: 'item', tableId: table.id })
    const read = (await listTables(db, TEST_TENANT, branch, { status: 'archived' }, qr)).find(t => t.id === table.id)
    expect(read?.deleteBlocker).toBe('ordered')
    await expectApiError(() => deleteTable(db, actor, branch, table.id, { version: table.version }), 409, 'TABLE_HAS_ORDERS')
    expect(await exists(table.id)).toBe(true)
  })

  it('refuses when an order arrives meanwhile (the guard in the batch)', async () => {
    const table = await archived('Table 3')
    const racing = interleaved(db, () => insertSoldLine(db, { itemId: 'item', tableId: table.id }))
    await expectApiError(() => deleteTable(racing, actor, branch, table.id, { version: table.version }), 409, 'TABLE_HAS_ORDERS')
    expect(await exists(table.id)).toBe(true)
  })

  it('the delete statement itself refuses an active table, and another branch\'s', async () => {
    const active = await createTable(db, actor, branch, { label: 'Table 4', area: null }, qr)
    const gone = await archived('Table 5')
    const other = await addBranch()
    await db.batch([deleteTableStatement(db, TEST_TENANT, branch, active.id, active.version), deleteTableStatement(db, TEST_TENANT, other, gone.id, gone.version)])
    expect(await exists(active.id)).toBe(true)
    expect(await exists(gone.id)).toBe(true)
  })

  it('reads and deletes none of another cafe\'s tables, and counts none of our orders against theirs', async () => {
    const theirBranch = 'their-branch'
    await insertBranch(db, { id: theirBranch, name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: 'tenant-2' })
    const owner: Actor = { ...actor, tenantId: 'tenant-2', userId: 'their-owner' }
    const created = await createTable(db, owner, theirBranch, { label: 'Table 1', area: null }, qr)
    const table = await archiveTable(db, owner, theirBranch, created.id, { version: created.version }, qr)
    await insertSoldLine(db, { itemId: 'ours', tableId: table.id })
    expect((await listTables(db, 'tenant-2', theirBranch, { status: 'archived' }, qr))[0]?.deleteBlocker).toBeNull()
    await db.batch([deleteTableStatement(db, TEST_TENANT, theirBranch, table.id, table.version)])
    expect(await exists(table.id)).toBe(true)
    await deleteTable(db, owner, theirBranch, table.id, { version: table.version })
    expect(await exists(table.id)).toBe(false)
  })
})
