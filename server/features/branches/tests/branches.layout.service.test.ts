import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_BRANCH_TABLES } from '#shared/contracts/branches'
import type { Floor, Placement, SaveLayoutInput } from '#shared/contracts/shop-layout'
import { floorSchema, LAYOUT_MAX_BODY_BYTES, LAYOUT_MAX_FLOOR_BYTES, saveLayoutSchema } from '#shared/contracts/shop-layout'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { getLayout, saveLayout } from '#server/features/branches/branches.layout.service'
import { archiveTable, createTable, deleteTable, restoreTable, updateTable } from '#server/features/branches/branches.service'
import { deletePlacementStatement, layoutRows, replaceLayoutStatements, requireActiveTables } from '#server/features/branches/branches.layout.repository'
import { branchLayoutPlacements, branches, diningTables } from '#server/features/branches/branches.schema'
import type { QrConfig } from '#server/features/branches/branches.qr'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import { jsonBytes, largestFloor, largestLayout } from '#server/tests/support/layouts'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// The shop layout (D273, step 2a): saved whole at the version read, placing only this branch's
// active tables, never touching the tables themselves.

type Batch = [Statement, ...Statement[]]

let db: Db
let branch: string
let actor: Actor
const qr: QrConfig = { secret: 'test-secret', baseUrl: 'https://cafe.example' }

async function addBranch(tenantId = TEST_TENANT) {
  const id = newId()
  await insertBranch(db, { id, name: `Branch ${id}`, timezone: 'Asia/Phnom_Penh', tenantId })
  return id
}

beforeEach(async () => {
  db = await createTestDb()
  branch = await addBranch()
  actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
})

/** A 6 × 5 m room with a front door, and its table spots. */
function floor(id: string, name = 'Ground', extra: Partial<Floor> = {}): Floor {
  return {
    id,
    name,
    height: 300,
    hasRoof: true,
    outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
    edges: [
      { kind: 'wall', openings: [{ id: `${id}-door`, kind: 'door', offset: 250, width: 100 }] },
      { kind: 'wall', openings: [] },
      { kind: 'wall', openings: [{ id: `${id}-window`, kind: 'window', offset: 100, width: 300 }] },
      { kind: 'railing', openings: [] },
    ],
    walls: [],
    items: [{ id: `${id}-plant`, kind: 'plant', x: 50, y: 50, rotation: 0, width: 40, depth: 40, finishes: {} }],
    ...extra,
  }
}

const placed = (tableId: string, floorId: string, x = 200): Placement =>
  ({ tableId, floorId, x, y: 200, rotation: 90, width: 80, depth: 80, lookId: 'round-cafe' })

/** Another request's write lands after the save's checks (its read batch), before its write. */
const meanwhile = (write: () => Promise<unknown>) => interleaved(db, write, 1)
const save = (input: SaveLayoutInput, on = db, as = actor, at = branch) => saveLayout(on, as, at, input)
const table = (label: string, at = branch, as = actor) => createTable(db, as, at, { label, area: null, seats: 4 }, qr)
const tableRow = async (id: string) => (await db.select().from(diningTables).where(eq(diningTables.id, id)))[0]!
const placementsIn = async (at: string) => db.select().from(branchLayoutPlacements).where(eq(branchLayoutPlacements.branchId, at))

describe('reading a layout', () => {
  it('is empty at version 0 before the first save, with the branch\'s active tables by label', async () => {
    await table('Table 10')
    await table('Table 2')
    const gone = await table('Table 3')
    await archiveTable(db, actor, branch, gone.id, { version: 1 }, qr)
    const layout = await getLayout(db, TEST_TENANT, branch)
    expect(layout).toMatchObject({ version: 0, updatedAt: null, updatedByName: null, floors: [], placements: [] })
    expect(layout.tables.map(t => [t.label, t.seats])).toEqual([['Table 2', 4], ['Table 10', 4]])
  })

  it('404s an unknown branch; an archived branch reads but can\'t be saved', async () => {
    await expectApiError(() => getLayout(db, TEST_TENANT, newId()), 404, 'NOT_FOUND')
    await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, branch))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [] } }), 409, 'INVALID_STATE')
  })
})

describe('saving a layout', () => {
  it('saves floors bottom first and placements, reads back the same, audited', async () => {
    const t1 = await table('T1')
    const t2 = await table('T2')
    const floors = [floor('ground'), floor('first', 'First', { hasRoof: false, height: 280 })]
    const placements = [placed(t1.id, 'ground'), placed(t2.id, 'first', 300)]
    const saved = await save({ version: 0, layout: { floors, placements } })
    expect(saved.version).toBe(1)
    expect(saved.updatedAt).toEqual(expect.any(String))
    // Who saved it, for "Saved by …" when another device's save is refused (6A).
    expect(saved.updatedByName).toBe('Test User')
    expect(saved.floors).toEqual(floors)
    expect(saved.placements).toEqual([...placements].sort((a, b) => a.tableId.localeCompare(b.tableId)))
    expect(await getLayout(db, TEST_TENANT, branch)).toEqual(saved)
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.layout.update'))
    expect(audit).toMatchObject({ targetType: 'branch', targetId: branch, actorId: actor.userId, metadata: { version: 1, floors: 2, placements: 2 } })
  })

  it('replaces the whole layout from the version read: a floor taken out goes with its tables', async () => {
    const t1 = await table('T1')
    const t2 = await table('T2')
    await save({ version: 0, layout: { floors: [floor('ground'), floor('first', 'First')], placements: [placed(t1.id, 'ground'), placed(t2.id, 'first')] } })
    const saved = await save({ version: 1, layout: { floors: [floor('ground', 'Downstairs')], placements: [placed(t1.id, 'ground', 400)] } })
    expect(saved).toMatchObject({ version: 2, floors: [{ id: 'ground', name: 'Downstairs' }], placements: [{ tableId: t1.id, x: 400 }] })
    expect(saved.tables.map(t => t.label)).toEqual(['T1', 'T2'])
  })

  it('never changes the tables: their versions and QR codes stay', async () => {
    const t1 = await table('T1')
    const before = await tableRow(t1.id)
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground')] } })
    await save({ version: 1, layout: { floors: [floor('ground')], placements: [{ ...placed(t1.id, 'ground', 500), rotation: 0, lookId: 'green-booth' }] } })
    await save({ version: 2, layout: { floors: [floor('ground')], placements: [] } })
    expect(await tableRow(t1.id)).toEqual(before)
  })

  it('refuses a stale version, writing nothing', async () => {
    const t1 = await table('T1')
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground')] } })
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('other')], placements: [] } }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => save({ version: 2, layout: { floors: [floor('other')], placements: [] } }), 409, 'VERSION_CONFLICT')
    expect(await getLayout(db, TEST_TENANT, branch)).toMatchObject({ version: 1, floors: [{ id: 'ground' }], placements: [{ tableId: t1.id }] })
  })

  it('refuses a first save when another first save lands meanwhile (the layout\'s key)', async () => {
    const theirs = { version: 0, layout: { floors: [floor('theirs')], placements: [] } }
    const racing = meanwhile(() => save(theirs))
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('mine')], placements: [] } }, racing), 409, 'VERSION_CONFLICT')
    expect(await getLayout(db, TEST_TENANT, branch)).toMatchObject({ version: 1, floors: [{ id: 'theirs' }] })
  })

  it('refuses a save when another save lands meanwhile (the version guard)', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    const racing = meanwhile(() => save({ version: 1, layout: { floors: [floor('theirs')], placements: [] } }))
    await expectApiError(() => save({ version: 1, layout: { floors: [floor('mine')], placements: [] } }, racing), 409, 'VERSION_CONFLICT')
    expect(await getLayout(db, TEST_TENANT, branch)).toMatchObject({ version: 2, floors: [{ id: 'theirs' }] })
  })
})

describe('placed tables', () => {
  const field = (index: number) => [`layout.placements.${index}.tableId`]

  it('refuses an archived table, by its place in the save, writing nothing', async () => {
    const t1 = await table('T1')
    const t2 = await table('T2')
    await archiveTable(db, actor, branch, t2.id, { version: 1 }, qr)
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground'), placed(t2.id, 'ground')] } }), 409, 'LAYOUT_TABLE_UNAVAILABLE', field(1))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
  })

  it('refuses another branch\'s table and an unknown one', async () => {
    const theirs = await table('T1', await addBranch())
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(theirs.id, 'ground')] } }), 409, 'LAYOUT_TABLE_UNAVAILABLE', field(0))
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(newId(), 'ground')] } }), 409, 'LAYOUT_TABLE_UNAVAILABLE', field(0))
    expect(await placementsIn(branch)).toEqual([])
  })

  it('refuses a table archived meanwhile (the guard in the batch)', async () => {
    const t1 = await table('T1')
    const racing = meanwhile(() => archiveTable(db, actor, branch, t1.id, { version: 1 }, qr))
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground')] } }, racing), 409, 'LAYOUT_TABLE_UNAVAILABLE', field(0))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
  })

  it('refuses a table deleted meanwhile (the foreign key)', async () => {
    const t1 = await table('T1')
    const racing = meanwhile(() => db.delete(diningTables).where(eq(diningTables.id, t1.id)))
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground')] } }, racing), 409, 'LAYOUT_TABLE_UNAVAILABLE', field(0))
  })

  it('the database refuses a placement in another branch than its table\'s', async () => {
    const t1 = await table('T1')
    const other = await addBranch()
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } }, db, actor, other)
    await expect(db.batch(replaceLayoutStatements(db, TEST_TENANT, other, [], [{ tableId: t1.id, floorId: 'ground', xCm: 0, yCm: 0, rotation: 0, widthCm: 80, depthCm: 80, look: 'round-cafe', customLookId: null }]) as Batch)).rejects.toThrow(/foreign key/i)
  })

  it('archiving a placed table takes it off the plan; restoring doesn\'t put it back; the layout keeps its version', async () => {
    const t1 = await table('T1')
    const t2 = await table('T2')
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground'), placed(t2.id, 'ground')] } })
    const archived = await archiveTable(db, actor, branch, t1.id, { version: 1 }, qr)
    expect(await getLayout(db, TEST_TENANT, branch)).toMatchObject({ version: 1, placements: [{ tableId: t2.id }], tables: [{ id: t2.id }] })
    await restoreTable(db, actor, branch, t1.id, { version: archived.version }, qr)
    const layout = await getLayout(db, TEST_TENANT, branch)
    expect(layout.placements.map(p => p.tableId)).toEqual([t2.id])
    expect(layout.tables.map(t => t.id)).toEqual([t1.id, t2.id])
  })

  it('deleting a table for good takes it off the plan (cascade)', async () => {
    const t1 = await table('T1')
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(t1.id, 'ground')] } })
    // Archiving already unplaces it; put the placement back to see the cascade on delete.
    const archived = await archiveTable(db, actor, branch, t1.id, { version: 1 }, qr)
    await db.insert(branchLayoutPlacements).values({ tableId: t1.id, tenantId: TEST_TENANT, branchId: branch, floorId: 'ground', xCm: 0, yCm: 0, rotation: 0, widthCm: 80, depthCm: 80, look: 'round-cafe' })
    await deleteTable(db, actor, branch, t1.id, { version: archived.version })
    expect(await placementsIn(branch)).toEqual([])
  })

  it('a table\'s seats are its own: changed on the table, read by the layout', async () => {
    const t1 = await createTable(db, actor, branch, { label: 'T1', area: null, seats: 2 }, qr)
    expect(t1.seats).toBe(2)
    const updated = await updateTable(db, actor, branch, t1.id, { version: 1, seats: 6 }, qr)
    expect(updated.seats).toBe(6)
    expect((await getLayout(db, TEST_TENANT, branch)).tables).toEqual([{ id: t1.id, label: 'T1', seats: 6 }])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.table.update'))
    expect(audit?.metadata).toEqual({ seats: { from: 2, to: 6 } })
  })

  it('the database refuses seats outside 1 to 20', async () => {
    const t1 = await table('T1')
    const refused = (seats: number) => expect(db.update(diningTables).set({ seats }).where(eq(diningTables.id, t1.id)))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/CHECK constraint failed: dining_tables_seats_check/) } })
    await refused(21)
    await refused(0)
    expect((await tableRow(t1.id)).seats).toBe(4)
  })
})

describe('tenants', () => {
  const OTHER = 'tenant-2'
  let theirBranch: string
  let theirOwner: Actor
  let theirTable: string

  beforeEach(async () => {
    theirBranch = await addBranch(OTHER)
    theirOwner = { userId: (await createUser(db)).id, tenantId: OTHER, role: 'owner', requestId: 'req-2' }
    theirTable = (await table('T1', theirBranch, theirOwner)).id
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(theirTable, 'ground')] } }, db, theirOwner, theirBranch)
  })

  it('another cafe\'s branch is not found, for reading and saving; theirs stays', async () => {
    await expectApiError(() => getLayout(db, TEST_TENANT, theirBranch), 404, 'NOT_FOUND')
    await expectApiError(() => save({ version: 1, layout: { floors: [floor('mine')], placements: [] } }, db, actor, theirBranch), 404, 'NOT_FOUND')
    expect(await getLayout(db, OTHER, theirBranch)).toMatchObject({ version: 1, floors: [{ id: 'ground' }], placements: [{ tableId: theirTable }] })
  })

  it('another cafe\'s table can\'t be placed in ours', async () => {
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [placed(theirTable, 'ground')] } }), 409, 'LAYOUT_TABLE_UNAVAILABLE')
  })

  it('the repository reads and writes none of their rows with our cafe\'s id', async () => {
    const ours = await layoutRows(db, TEST_TENANT, theirBranch)
    expect(ours).toEqual({ layout: undefined, floors: [], placements: [], tables: [], lookIds: [], itemLooks: [] })
    const found = await layoutRows(db, OTHER, theirBranch)
    expect(found.floors).toHaveLength(1)
    expect(found.placements).toHaveLength(1)
    expect(found.tables).toHaveLength(1)

    await db.batch([
      deletePlacementStatement(db, TEST_TENANT, theirBranch, theirTable),
      ...replaceLayoutStatements(db, TEST_TENANT, theirBranch, [], []),
    ])
    expect(await layoutRows(db, OTHER, theirBranch)).toEqual(found)
    // Their table isn't an active table of ours: the guard counts none.
    await expect(db.batch(requireActiveTables(db, TEST_TENANT, theirBranch, [theirTable]) as Batch)).rejects.toThrow()
    await db.batch(requireActiveTables(db, OTHER, theirBranch, [theirTable]) as Batch)
  })
})

describe('size limits', () => {
  it('the largest floor the per-floor limits allow fits LAYOUT_MAX_FLOOR_BYTES; one more item is refused', () => {
    const largest = largestFloor('big')
    expect(jsonBytes(largest)).toBeLessThanOrEqual(LAYOUT_MAX_FLOOR_BYTES)
    expect(jsonBytes(largest)).toBeGreaterThan(LAYOUT_MAX_FLOOR_BYTES - 400)
    expect(v.safeParse(floorSchema, largest).success).toBe(true)
    const over = { ...largest, items: [...largest.items, { ...largest.items[0]!, id: 'one-more-item'.padEnd(40, 'x') }] }
    const result = v.safeParse(floorSchema, over)
    expect(result.success).toBe(false)
    expect(result.issues?.map(issue => issue.message)).toContain('This floor holds too much: move some furniture to another floor')
  })

  it('a malformed floor is refused with its issues, never a thrown error (found on the built server)', () => {
    const fine = floor('ground')
    for (const outline of [fine.outline.slice(0, 2), fine.outline.slice(0, 3), [...fine.outline, { x: 0, y: 250 }]]) {
      const result = v.safeParse(floorSchema, { ...fine, outline })
      expect(result.success).toBe(false)
      expect(result.issues?.map(issue => issue.message)).toContain(outline.length >= 3 ? 'Every outline edge needs its kind' : 'An outline needs 3 corners')
    }
  })

  it('the largest save (every floor full, every table placed) fits the route\'s body limit and passes the contract', () => {
    const body = largestLayout(Array.from({ length: MAX_BRANCH_TABLES }, () => newId()), 123_456)
    expect(jsonBytes(body)).toBeLessThanOrEqual(LAYOUT_MAX_BODY_BYTES)
    expect(v.safeParse(saveLayoutSchema, body).success).toBe(true)
    expect(v.safeParse(saveLayoutSchema, { ...body, layout: { ...body.layout, placements: [...body.layout.placements, body.layout.placements[0]!] } }).success).toBe(false)
  })
})
