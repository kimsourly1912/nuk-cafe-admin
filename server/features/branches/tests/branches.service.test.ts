import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WeeklyWindow } from '#shared/contracts/common'
import { MAX_BRANCH_TABLES } from '#shared/contracts/branches'
import { organization } from '#server/db/tables'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { archiveTable, createTable, getBranchSettings, getPublicBranch, listPublicBranches, listTables, resolveTableToken, restoreTable, rotateTableQr, updateBranchSettings, updateTable } from '#server/features/branches/branches.service'
import { diningTables } from '#server/features/branches/branches.schema'
import type { QrConfig } from '#server/features/branches/branches.qr'
import { qrConfigFrom, tableToken, tokenHash } from '#server/features/branches/branches.qr'
import { createTestDb } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
let branch: string
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }
const qr: QrConfig = { secret: 'test-secret', baseUrl: 'https://cafe.example' }

async function addBranch(timezone = 'Asia/Phnom_Penh') {
  const id = newId()
  await db.insert(organization).values({ id, name: `Branch ${id}`, slug: id, timezone, status: 'active', createdAt: new Date() })
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
    const settings = await getBranchSettings(db, branch, MONDAY_10AM)
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
    expect((await getBranchSettings(db, branch, MONDAY_10AM)).openNow).toBe(true)
    // Sunday 10:00 there: closed.
    expect(await getBranchSettings(db, branch, new Date('2026-09-27T03:00:00Z'))).toMatchObject({ openNow: false, today: 7 })

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
    expect((await getBranchSettings(db, branch, new Date('2026-10-02T18:00:00Z'))).openNow).toBe(true)
    expect((await getBranchSettings(db, branch, new Date('2026-10-02T19:30:00Z'))).openNow).toBe(false)
  })

  it('follows a new timezone at once', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, hours: weekdays(480, 1140) })
    // 03:00 UTC Monday is 10:00 in Phnom Penh (open), 23:00 Sunday in New York (closed).
    const saved = await updateBranchSettings(db, actor, branch, { version: 2, timezone: 'America/New_York' })
    expect(saved.timezone).toBe('America/New_York')
    expect((await getBranchSettings(db, branch, MONDAY_10AM)).openNow).toBe(false)
  })

  it('refuses an unknown timezone and overlapping windows on their fields', async () => {
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, timezone: 'Mars/Base' }), 422, 'UNKNOWN_TIMEZONE', ['timezone'])
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, hours: [w(1, 1320, 120), w(2, 60, 180)] }), 422, 'BRANCH_HOURS', ['hours.1'])
    expect((await getBranchSettings(db, branch)).version).toBe(1)
  })

  it('refuses a stale version, and one that goes stale between the check and the write', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, name: 'First' })
    await expectApiError(() => updateBranchSettings(db, actor, branch, { version: 1, name: 'Second' }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => db.update(organization).set({ version: 3 }).where(eq(organization.id, branch)))
    await expectApiError(() => updateBranchSettings(racing, actor, branch, { version: 2, name: 'Third', hours: weekdays(0, 60) }), 409, 'VERSION_CONFLICT')
    const settings = await getBranchSettings(db, branch)
    expect(settings).toMatchObject({ name: 'First', hours: [] })
  })

  it('stores the most hours a week in one save (D1\'s parameter limit)', async () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].flatMap(day => [w(day, 360, 600), w(day, 660, 900), w(day, 960, 1200)])
    expect((await updateBranchSettings(db, actor, branch, { version: 1, hours })).hours).toHaveLength(21)
  })

  it('404s an unknown branch', async () => {
    await expectApiError(() => getBranchSettings(db, newId()), 404, 'NOT_FOUND')
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
    const [listed] = await listTables(db, branch, { status: 'active' }, qr)
    expect(listed!.qrUrl).toBe(table.qrUrl)
    expect(await resolveTableToken(db, tokenOf(table.qrUrl))).toEqual({ branch: { id: branch, name: `Branch ${branch}` }, table: { id: table.id, label: 'Table 1' } })
  })

  it('lists by label as people read them, per status', async () => {
    for (const label of ['Table 10', 'Table 2', 'patio 1']) await createTable(db, actor, branch, { label, area: null }, qr)
    const old = await createTable(db, actor, branch, { label: 'Old', area: null }, qr)
    await archiveTable(db, actor, branch, old.id, { version: 1 }, qr)
    expect((await listTables(db, branch, { status: 'active' }, qr)).map(t => t.label)).toEqual(['patio 1', 'Table 2', 'Table 10'])
    expect((await listTables(db, branch, { status: 'archived' }, qr)).map(t => [t.label, t.qrUrl])).toEqual([['Old', null]])
    expect(await listTables(db, branch, { status: 'all' }, qr)).toHaveLength(4)
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
    expect(await resolveTableToken(db, tokenOf(table.qrUrl))).toMatchObject({ table: { id: table.id } })
  })

  it('rotating makes a new QR and the printed one stops working', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    const rotated = await rotateTableQr(db, actor, branch, table.id, { version: 1 }, qr)
    expect(rotated.qrUrl).not.toBe(table.qrUrl)
    await expectApiError(() => resolveTableToken(db, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    expect(await resolveTableToken(db, tokenOf(rotated.qrUrl))).toMatchObject({ table: { id: table.id } })
    const audits = await auditOf(table.id)
    expect(audits.map(a => a.action)).toContain('branch.table.rotate_qr')
    expect(JSON.stringify(audits)).not.toContain(tokenOf(rotated.qrUrl))
  })

  it('an archived table\'s QR stops working; restoring brings the same QR back', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    const archived = await archiveTable(db, actor, branch, table.id, { version: 1 }, qr)
    expect(archived).toMatchObject({ status: 'archived', qrUrl: null })
    await expectApiError(() => resolveTableToken(db, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    await expectApiError(() => updateTable(db, actor, branch, table.id, { version: 2, label: 'X' }, qr), 409, 'INVALID_STATE')
    await expectApiError(() => rotateTableQr(db, actor, branch, table.id, { version: 2 }, qr), 409, 'INVALID_STATE')
    const restored = await restoreTable(db, actor, branch, table.id, { version: 2 }, qr)
    expect(restored.qrUrl).toBe(table.qrUrl)
    await expectApiError(() => restoreTable(db, actor, branch, table.id, { version: 3 }, qr), 409, 'INVALID_STATE')
  })

  it('a table in an archived branch doesn\'t resolve, and the branch\'s tables can\'t be added to', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    await db.update(organization).set({ status: 'archived' }).where(eq(organization.id, branch))
    await expectApiError(() => resolveTableToken(db, tokenOf(table.qrUrl)), 404, 'NOT_FOUND')
    await expectApiError(() => createTable(db, actor, branch, { label: 'T2', area: null }, qr), 409, 'INVALID_STATE')
  })

  it('an unknown or malformed token, another secret\'s token, and another branch\'s table are 404', async () => {
    const table = await createTable(db, actor, branch, { label: 'T1', area: null }, qr)
    await expectApiError(() => resolveTableToken(db, 'x'.repeat(22)), 404, 'NOT_FOUND')
    await expectApiError(() => resolveTableToken(db, '../../etc'), 404, 'NOT_FOUND')
    const otherSecretToken = await tableToken('another-secret', table.id, 1)
    await expectApiError(() => resolveTableToken(db, otherSecretToken), 404, 'NOT_FOUND')
    const otherBranch = await addBranch()
    await expectApiError(() => updateTable(db, actor, otherBranch, table.id, { version: 1, label: 'X' }, qr), 404, 'NOT_FOUND')
  })

  it(`allows at most ${MAX_BRANCH_TABLES} tables per branch, archived ones included`, async () => {
    const rows = await Promise.all(Array.from({ length: MAX_BRANCH_TABLES }, async (_, i) => ({
      id: newId(),
      branchId: branch,
      label: `T${i}`,
      qrTokenHash: await tokenHash(`token-${i}`),
    })))
    // 10 rows a statement: 70 parameters, under D1's 100.
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
    expect(await getPublicBranch(db, branch, MONDAY_10AM)).toEqual({
      id: branch,
      name: expect.any(String),
      address: '#123 St. 63',
      phone: null,
      timezone: 'Asia/Phnom_Penh',
      openNow: true,
      // Until 19:00 (D99: online orders stop 15 minutes before).
      closesInMinutes: 540,
      nextOpening: null,
    })
    // Saturday 23:00 there: open until 02:00, past midnight.
    expect((await getPublicBranch(db, branch, at('2026-10-03T16:00:00Z'))).closesInMinutes).toBe(180)
    // Closed: nothing to count down.
    expect((await getPublicBranch(db, branch, at('2026-09-28T13:00:00Z'))).closesInMinutes).toBeNull()
  })

  it('says when a closed branch opens: later today, tomorrow, or a later weekday', async () => {
    await openHours()
    // Monday 06:00 there: later today at 07:00.
    expect((await getPublicBranch(db, branch, at('2026-09-27T23:00:00Z'))).nextOpening).toEqual({ inDays: 0, weekday: 1, startMinute: 420 })
    // Monday 20:00 there: Tuesday at 07:00.
    expect((await getPublicBranch(db, branch, at('2026-09-28T13:00:00Z'))).nextOpening).toEqual({ inDays: 1, weekday: 2, startMinute: 420 })
    // Sunday 03:00 there (Saturday's window ended at 02:00): Monday, tomorrow.
    expect((await getPublicBranch(db, branch, at('2026-09-26T20:00:00Z'))).nextOpening).toEqual({ inDays: 1, weekday: 1, startMinute: 420 })
    // Sunday 01:00 there: still in Saturday's overnight window.
    expect((await getPublicBranch(db, branch, at('2026-09-26T18:00:00Z'))).openNow).toBe(true)
  })

  it('opens a week later when its only window just ended, and never without hours', async () => {
    await updateBranchSettings(db, actor, branch, { version: 1, hours: [w(1, 420, 600)] })
    // Monday 10:00 exactly: the window ended (end excluded); it opens next Monday.
    expect((await getPublicBranch(db, branch, MONDAY_10AM)).nextOpening).toEqual({ inDays: 7, weekday: 1, startMinute: 420 })
    const other = await addBranch()
    expect(await getPublicBranch(db, other, MONDAY_10AM)).toMatchObject({ openNow: false, nextOpening: null })
  })

  it('lists active branches by name; an archived or unknown one is 404', async () => {
    const archived = await addBranch()
    await db.update(organization).set({ name: 'Archived', status: 'archived' }).where(eq(organization.id, archived))
    const listed = await listPublicBranches(db, MONDAY_10AM)
    expect(listed.map(b => b.id)).toEqual([branch])
    await expectApiError(() => getPublicBranch(db, archived), 404, 'NOT_FOUND')
    await expectApiError(() => getPublicBranch(db, newId()), 404, 'NOT_FOUND')
  })
})
