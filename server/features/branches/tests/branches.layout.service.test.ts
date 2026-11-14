import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BRANCH_TABLES, updateBranchSettingsSchema } from '#shared/contracts/branches'
import type { Floor, FloorGeometry, Placement, SaveLayoutInput, ShopLayout } from '#shared/contracts/shop-layout'
import { FIGURE_SIZES, floorSchema, LAYOUT_MAX_BODY_BYTES, LAYOUT_MAX_FLOOR_BYTES, NO_SCENE, saveLayoutSchema, upgradeFloor } from '#shared/contracts/shop-layout'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { getLayout, getLayoutSnapshot, getPublicExploreLayout, LAYOUT_SNAPSHOT_EVERY_MS, listLayoutHistory, saveLayout } from '#server/features/branches/branches.layout.service'
import { archiveTable, createTable, deleteTable, listPublicBranches, restoreTable, updateBranchSettings, updateTable } from '#server/features/branches/branches.service'
import { deletePlacementStatement, insertLayoutStatement, insertSnapshotStatement, LAYOUT_HISTORY_KEEP, layoutRows, listSnapshots, pruneSnapshotsStatement, replaceLayoutStatements, requireActiveTables, snapshotAt, touchLayoutStatement } from '#server/features/branches/branches.layout.repository'
import { branchLayoutItemLooks, branchLayoutPlacements, branchLayoutVersions, branches, customFurnitureLooks, customItemLooks, diningTables } from '#server/features/branches/branches.schema'
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
  // Written as before contract v2 (an outline and its edges) and upgraded, as the server reads old rows (D282).
  return { ...upgradeFloor<unknown>({
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
  }) as Floor, ...extra }
}

const placed = (tableId: string, floorId: string, x = 200): Placement =>
  ({ tableId, floorId, x, y: 200, rotation: 90, width: 80, depth: 80, lookId: 'round-cafe' })

/** Another request's write lands after the save's checks (its read batch), before its write. */
const meanwhile = (write: () => Promise<unknown>) => interleaved(db, write, 1)
const save = (input: SaveLayoutInput, on = db, as = actor, at = branch) => saveLayout(on, as, at, input)
const table = (label: string, at = branch, as = actor) => createTable(db, as, at, { label, area: null, seats: 4 }, qr)
const tableRow = async (id: string) => (await db.select().from(diningTables).where(eq(diningTables.id, id)))[0]!
const placementsIn = async (at: string) => db.select().from(branchLayoutPlacements).where(eq(branchLayoutPlacements.branchId, at))

describe('Explore publication', () => {
  const scene = { preset: 'none', entrance: 'ground-door', explore: true } as const
  const pin = { latitude: 11.5564, longitude: 104.9282 }
  const layout = () => ({ floors: [floor('ground')], placements: [], scene })
  const read = () => getPublicExploreLayout(db, TEST_TENANT, branch)

  it('publishes only with a pin and explicit opt-in, and stops serving the saved drawing immediately when either is removed', async () => {
    await save({ version: 0, layout: layout() })
    await expectApiError(read, 404, 'NOT_FOUND')
    await updateBranchSettings(db, actor, branch, { version: 1, ...pin })
    expect(await listPublicBranches(db, TEST_TENANT)).toMatchObject([{ id: branch, ...pin, hasExplore: true }])
    expect(await listPublicBranches(db, TEST_TENANT, undefined, false)).toMatchObject([{ hasExplore: false }])
    expect(await read()).toMatchObject({ scene })
    await save({ version: 1, layout: { ...layout(), scene: { ...scene, explore: false } } })
    await expectApiError(read, 404, 'NOT_FOUND')
    expect(await listPublicBranches(db, TEST_TENANT)).toMatchObject([{ hasExplore: false }])
    await save({ version: 2, layout: layout() })
    await updateBranchSettings(db, actor, branch, { version: 2, latitude: null, longitude: null })
    await expectApiError(read, 404, 'NOT_FOUND')
    expect(await listPublicBranches(db, TEST_TENANT)).toMatchObject([{ hasExplore: false, latitude: null, longitude: null }])
    await updateBranchSettings(db, actor, branch, { version: 3, ...pin })
    await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, branch))
    await expectApiError(read, 404, 'NOT_FOUND')
    expect(await listPublicBranches(db, TEST_TENANT)).toEqual([])
  })

  it('publishes drawing-only data and refuses to read that drawing from a second cafe', async () => {
    const other = 'tenant-2'
    await insertBranch(db, { id: newId(), tenantId: other, name: 'Other branch', timezone: 'Asia/Phnom_Penh' })
    const placedTable = await table('Private table label')
    await table('Private unplaced table')
    const furniture = { tenantId: TEST_TENANT, shape: 'round', base: 'pedestal', chair: 'cafe-chair', finishes: { top: 'warm-oak', base: 'walnut' }, defaultWidthCm: 80, defaultDepthCm: 80 } as const
    await db.insert(customFurnitureLooks).values([
      { ...furniture, id: 'public-table-look', name: 'Internal table look', photoAssetId: 'private-table-photo' },
      { ...furniture, id: 'unused-look', name: 'Unused look' },
    ])
    await db.insert(customItemLooks).values({
      id: 'public-item-look', tenantId: TEST_TENANT, name: 'Internal item look', kind: 'plant',
      finishes: {}, defaultWidthCm: 40, defaultDepthCm: 40, photoAssetId: 'private-item-photo',
    })
    // Studio's frame, page and layer flags are design-only (ISS-021, ISS-035, ISS-036): never public.
    const ground = floor('ground', 'Ground', { canvasX: 900, canvasY: 40, pageId: 'studio-page', hidden: true, locked: true })
    ground.items[0]!.lookId = 'public-item-look'
    ground.items[0]!.hidden = true
    await updateBranchSettings(db, actor, branch, { version: 1, ...pin })
    await save({ version: 0, layout: { floors: [ground], scene, pages: [{ id: 'studio-page', name: 'Studio page' }], placements: [{ ...placed(placedTable.id, 'ground'), lookId: 'public-table-look', locked: true }] } })
    const published = await read()
    expect(published.placements).toEqual([{ floorId: 'ground', lookId: 'public-table-look', seats: 4, x: 200, y: 200, rotation: 90, width: 80, depth: 80 }])
    expect(published.looks.map(look => look.id)).toEqual(['public-table-look'])
    expect(published.itemLooks.map(look => look.id)).toEqual(['public-item-look'])
    const body = JSON.stringify(published)
    for (const field of [placedTable.id, 'Private', 'Internal', 'photo', 'version', 'updatedByName', 'tableId', 'canvas', 'page', 'hidden', 'locked']) {
      expect(body).not.toContain(field)
    }
    await expectApiError(() => getPublicExploreLayout(db, other, branch), 404, 'NOT_FOUND')
    expect(await listPublicBranches(db, other)).toMatchObject([{ hasExplore: false, latitude: null, longitude: null }])
  })

  it('validates paired coordinates and refuses nonexistent, upper-floor and window entrances', async () => {
    for (const body of [{ latitude: 0 }, { latitude: null, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }]) {
      expect(v.safeParse(updateBranchSettingsSchema, { version: 1, ...body }).success).toBe(false)
    }
    expect(v.safeParse(updateBranchSettingsSchema, { version: 1, latitude: -90, longitude: 180 }).success).toBe(true)
    for (const entrance of [undefined, 'unknown', 'first-door', 'ground-window']) {
      const data = { version: 0, layout: { ...layout(), floors: [floor('ground'), floor('first')], scene: { ...scene, entrance } } }
      expect(v.safeParse(saveLayoutSchema, data).success).toBe(false)
    }
    await save({ version: 0, layout: layout() })
    await expectApiError(() => save({ version: 1, layout: { floors: [floor('different')], placements: [] } }), 400, 'VALIDATION_FAILED')
    const legacy = await save({ version: 1, layout: { ...layout(), scene: { preset: 'neighborhood-lane' } } })
    expect(legacy.scene).toEqual({ ...scene, preset: 'neighborhood-lane' })
    const cleared = await save({ version: 2, layout: { floors: [floor('different')], placements: [], scene: { preset: 'none', entrance: null, explore: false } } })
    expect(cleared.scene).toEqual({ preset: 'none', entrance: null, explore: false })
  })
})

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

describe('contract v2 (D282): layouts saved before it', () => {
  const v1Ground = () => ({
    id: 'ground',
    outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
    edges: [
      { kind: 'wall', openings: [{ id: 'street', kind: 'door', offset: 250, width: 100 }] },
      { kind: 'open', openings: [] },
      { kind: 'railing', openings: [] },
      { kind: 'wall', openings: [] },
    ],
    walls: [{ id: 'kitchen', from: { x: 400, y: 0 }, to: { x: 400, y: 300 } }],
    items: [],
  })

  it('reads an old floor row as slabs and one wall list, the outer walls outside the outline', async () => {
    const { id: _id, ...geometry } = v1Ground()
    await db.batch([
      insertLayoutStatement(db, TEST_TENANT, branch, actor.userId, new Date(), { preset: 'none', entrance: 'street' }),
      ...replaceLayoutStatements(db, TEST_TENANT, branch, [{ id: 'ground', position: 0, name: 'Ground', heightCm: 300, hasRoof: true, geometry: geometry as unknown as FloorGeometry, canvasXCm: null, canvasYCm: null, pageId: null, hidden: false, locked: false }], []),
    ] as Batch)
    const read = await getLayout(db, TEST_TENANT, branch)
    const ground = read.floors[0]!
    expect(ground.slabs).toEqual([{ id: expect.stringMatching(/^s-/), outline: v1Ground().outline }])
    // The open edge has no wall; the street door keeps its id, so Explore's entrance still finds it.
    expect(ground.walls.map(wall => [wall.kind ?? 'wall', wall.side, wall.thickness])).toEqual([['wall', 'left', 20], ['railing', 'left', 6], ['wall', 'left', 20], ['wall', undefined, undefined]])
    expect(ground.walls[0]).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 600, y: 0 }, openings: [{ id: 'street' }] })
    expect(v.safeParse(floorSchema, ground).success).toBe(true)
    // The same ids every time it is read.
    expect((await getLayout(db, TEST_TENANT, branch)).floors).toEqual(read.floors)
    // Saved back unchanged: stored in v2 from then on.
    const saved = await save({ version: read.version, layout: { floors: read.floors, placements: [], scene: read.scene } })
    expect(saved.floors).toEqual(read.floors)
  })

  it('accepts an old save body at the route and upgrades it before checking', () => {
    const parsed = v.safeParse(saveLayoutSchema, { version: 0, layout: { floors: [{ ...v1Ground(), name: 'Ground', height: 300, hasRoof: true }], placements: [], scene: { preset: 'none', entrance: 'street', explore: false } } })
    expect(parsed.issues?.map(issue => issue.message)).toBeUndefined()
    expect(parsed.output?.layout.floors[0]!.slabs).toHaveLength(1)
  })

  it('upgrades a history snapshot saved before it', async () => {
    const old = { floors: [{ ...v1Ground(), name: 'Ground', height: 300, hasRoof: true }], placements: [] }
    await db.batch([insertLayoutStatement(db, TEST_TENANT, branch, null, new Date()), insertSnapshotStatement(db, TEST_TENANT, branch, 7, null, new Date(), old as unknown as ShopLayout)] as Batch)
    const snapshot = await snapshotAt(db, TEST_TENANT, branch, 7)
    expect(snapshot?.floors[0]!.slabs).toHaveLength(1)
    expect(snapshot?.floors[0]!.walls).toHaveLength(4)
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

  it('saves people and pets as the floor\'s own decoration: no table, no look in use (step 3g)', async () => {
    const figures: Floor['items'] = [
      { id: 'cat', kind: 'cat', x: 120, y: 400, rotation: 45, ...FIGURE_SIZES.cat, finishes: {} },
      { id: 'guest', kind: 'person', x: 300, y: 150, rotation: 180, ...FIGURE_SIZES.person, finishes: {} },
    ]
    const ground = floor('ground', 'Ground', { items: [...floor('ground').items, ...figures] })
    expect(v.safeParse(floorSchema, ground).success).toBe(true)
    const saved = await save({ version: 0, layout: { floors: [ground], placements: [] } })
    expect(saved.floors[0]!.items).toEqual(ground.items)
    expect((await getLayout(db, TEST_TENANT, branch)).floors[0]!.items).toEqual(ground.items)
    expect(await db.select().from(branchLayoutItemLooks)).toEqual([])
    // Another size is the contract's 400 at the route, never saved.
    const resized = floor('ground', 'Ground', { items: [{ ...figures[0]!, width: 60 }] })
    expect(v.safeParse(floorSchema, resized).issues?.map(issue => issue.message)).toContain('People and pets keep their own size')
  })

  it('saves inside walls with their kinds and doors, and named shapes, and reads them back (D278)', async () => {
    const walls: Floor['walls'] = [
      { id: 'kitchen', from: { x: 300, y: 0 }, to: { x: 300, y: 300 }, openings: [{ id: 'kitchen-door', kind: 'door', offset: 100, width: 90 }, { id: 'pass', kind: 'window', offset: 200, width: 80 }] },
      { id: 'screen', from: { x: 300, y: 300 }, to: { x: 600, y: 300 }, kind: 'glass', openings: [{ id: 'gap', kind: 'door', offset: 0, width: 100 }] },
      { id: 'old', from: { x: 100, y: 400 }, to: { x: 200, y: 400 } },
    ]
    const items: Floor['items'] = [{ id: 'stage', kind: 'block', name: 'Stage', x: 150, y: 150, rotation: 0, width: 200, depth: 120, height: 40, finishes: { body: 'walnut' } }]
    const ground = floor('ground', 'Ground', { walls, items })
    expect(v.safeParse(floorSchema, ground).success).toBe(true)
    await save({ version: 0, layout: { floors: [ground], placements: [] } })
    const read = (await getLayout(db, TEST_TENANT, branch)).floors[0]!
    expect(read.walls).toEqual(walls)
    expect(read.items).toEqual(items)
    // A window in glass is the contract's 400 at the route, never saved.
    const glassWindow = floor('ground', 'Ground', { walls: [{ ...walls[1]!, openings: [{ id: 'w', kind: 'window', offset: 0, width: 100 }] }] })
    expect(v.safeParse(floorSchema, glassWindow).issues?.map(issue => issue.message)).toContain('A window needs a full wall')
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

describe('the scene (step 4a)', () => {
  const lane = { preset: 'neighborhood-lane' } as const
  const audits = async () => (await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.layout.update'))).map(row => row.metadata)

  it('is none until chosen; saved with the layout at its version and read back, the audit naming the new preset', async () => {
    expect((await getLayout(db, TEST_TENANT, branch)).scene).toEqual(NO_SCENE)
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    expect((await getLayout(db, TEST_TENANT, branch)).scene).toEqual(NO_SCENE)
    const saved = await save({ version: 1, layout: { floors: [floor('ground')], placements: [], scene: lane } })
    expect(saved).toMatchObject({ version: 2, scene: lane })
    expect((await getLayout(db, TEST_TENANT, branch)).scene).toEqual(lane)
    // The same preset again is no news.
    await save({ version: 2, layout: { floors: [floor('ground')], placements: [], scene: lane } })
    expect(await audits()).toEqual([
      { version: 1, floors: 1, placements: 0 },
      { version: 2, floors: 1, placements: 0, scene: 'neighborhood-lane' },
      { version: 3, floors: 1, placements: 0 },
    ])
  })

  it('a first save may bring one', async () => {
    expect(await save({ version: 0, layout: { floors: [floor('ground')], placements: [], scene: lane } })).toMatchObject({ version: 1, scene: lane })
  })

  it('a save without one keeps the saved scene (an app tab from before step 4a)', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [], scene: lane } })
    const saved = await save({ version: 1, layout: { floors: [floor('ground', 'Downstairs')], placements: [] } })
    expect(saved).toMatchObject({ version: 2, floors: [{ name: 'Downstairs' }], scene: lane })
  })

  it('a stale save changes no scene', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    await save({ version: 1, layout: { floors: [floor('ground')], placements: [], scene: lane } })
    await expectApiError(() => save({ version: 1, layout: { floors: [floor('ground')], placements: [], scene: NO_SCENE } }), 409, 'VERSION_CONFLICT')
    expect((await getLayout(db, TEST_TENANT, branch)).scene).toEqual(lane)
  })

  it('the contract refuses an unknown preset and any other field (400 at the route)', () => {
    const body = (scene: unknown) => ({ version: 1, layout: { floors: [floor('ground')], placements: [], scene } })
    expect(v.safeParse(saveLayoutSchema, body(lane)).success).toBe(true)
    expect(v.safeParse(saveLayoutSchema, body({ preset: 'seaside' })).issues?.map(issue => issue.message)).toContain('Unknown scene')
    expect(v.safeParse(saveLayoutSchema, body({ preset: 'none', sign: 'x'.repeat(3000) })).success).toBe(false)
    expect(v.safeParse(saveLayoutSchema, body(null)).success).toBe(false)
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
    expect(ours).toEqual({ layout: undefined, floors: [], placements: [], tables: [], lookIds: [], itemLooks: [], lastSnapshotAt: null })
    const found = await layoutRows(db, OTHER, theirBranch)
    expect(found.floors).toHaveLength(1)
    expect(found.placements).toHaveLength(1)
    expect(found.tables).toHaveLength(1)

    await db.batch([
      deletePlacementStatement(db, TEST_TENANT, theirBranch, theirTable),
      ...replaceLayoutStatements(db, TEST_TENANT, theirBranch, [], []),
    ])
    expect(await layoutRows(db, OTHER, theirBranch)).toEqual(found)
    // Their scene (step 4a): our cafe's id moves no version and sets no scene.
    await db.batch([touchLayoutStatement(db, TEST_TENANT, theirBranch, 1, actor.userId, new Date(), { preset: 'neighborhood-lane' })])
    expect(await layoutRows(db, OTHER, theirBranch)).toEqual(found)
    expect(found.layout?.scene).toBeNull()
    // Their table isn't an active table of ours: the guard counts none.
    await expect(db.batch(requireActiveTables(db, TEST_TENANT, theirBranch, [theirTable]) as Batch)).rejects.toThrow()
    await db.batch(requireActiveTables(db, OTHER, theirBranch, [theirTable]) as Batch)
    // Their history (ISS-027): our cafe's id lists, reads and prunes none of it.
    expect(await listSnapshots(db, TEST_TENANT, theirBranch)).toEqual([])
    expect(await snapshotAt(db, TEST_TENANT, theirBranch, 1)).toBeUndefined()
    await db.batch([pruneSnapshotsStatement(db, TEST_TENANT, theirBranch)])
    expect(await listSnapshots(db, OTHER, theirBranch)).toHaveLength(1)
    await expectApiError(() => listLayoutHistory(db, TEST_TENANT, theirBranch), 404, 'NOT_FOUND')
    await expectApiError(() => getLayoutSnapshot(db, TEST_TENANT, theirBranch, 1), 404, 'NOT_FOUND')
  })
})

describe('Studio frames, pages and layers (ISS-021, ISS-035, ISS-036)', () => {
  it('saves a floor\'s frame, page, flags and names, and a table\'s flags, and reads them back; left out when off', async () => {
    const t1 = (await table('T1')).id
    const ground = floor('ground', 'Ground', { canvasX: 900, canvasY: -50, pageId: 'plans', locked: true })
    ground.items[0] = { ...ground.items[0]!, name: 'Corner plant', hidden: true }
    ground.walls = [{ id: 'kitchen', from: { x: 100, y: 100 }, to: { x: 100, y: 300 }, name: 'Kitchen', locked: true }]
    const pages = [{ id: 'floors', name: 'Floors' }, { id: 'plans', name: 'Plans' }]
    const layout = await save({ version: 0, layout: { floors: [ground, floor('up', 'Up', { hidden: true })], pages, placements: [{ ...placed(t1, 'ground'), hidden: true, locked: true }] } })
    expect(layout.pages).toEqual(pages)
    expect(layout.floors[0]).toEqual(ground)
    expect(layout.floors[1]).toMatchObject({ id: 'up', hidden: true })
    expect(layout.floors[1]).not.toHaveProperty('canvasX')
    expect(layout.floors[1]).not.toHaveProperty('pageId')
    expect(layout.placements[0]).toMatchObject({ hidden: true, locked: true })
    expect(await getLayout(db, TEST_TENANT, branch)).toEqual(layout)
    // Moving a frame changes only its offset: the drawing inside keeps its own coordinates.
    const moved = await save({ version: 1, layout: { floors: [{ ...ground, canvasX: 1200 }, layout.floors[1]!], pages, placements: layout.placements } })
    expect(moved.floors[0]).toEqual({ ...ground, canvasX: 1200 })
    // A save without pages (an app tab from before) keeps the saved ones.
    const kept = await save({ version: 2, layout: { floors: moved.floors, placements: moved.placements } })
    expect(kept.pages).toEqual(pages)
  })

  it('keeps a frame placed at 0 as placed, and a floor never placed as left out (laid out by Studio)', async () => {
    const layout = await save({ version: 0, layout: { floors: [floor('ground', 'Ground', { canvasX: 0, canvasY: 0 }), floor('up')], placements: [] } })
    expect(layout.floors[0]).toMatchObject({ canvasX: 0, canvasY: 0 })
    expect(layout.floors[1]).not.toHaveProperty('canvasX')
  })

  it('a stale save moves no frame (409)', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    await save({ version: 1, layout: { floors: [floor('ground', 'Ground', { canvasX: 100 })], placements: [] } })
    await expectApiError(() => save({ version: 1, layout: { floors: [floor('ground', 'Ground', { canvasX: 999 })], placements: [] } }), 409, 'VERSION_CONFLICT')
    expect((await getLayout(db, TEST_TENANT, branch)).floors[0]!.canvasX).toBe(100)
  })

  it('the contract refuses a floor on a page that does not exist, and repeated pages', () => {
    const on = (pageId: string, pages?: { id: string, name: string }[]) => v.safeParse(saveLayoutSchema, { version: 0, layout: { floors: [floor('ground', 'Ground', { pageId })], placements: [], ...(pages && { pages }) } })
    expect(on('floors').success).toBe(true)
    expect(on('nowhere').success).toBe(false)
    expect(on('a', [{ id: 'a', name: 'A' }]).success).toBe(true)
    expect(on('a', [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]).success).toBe(false)
    expect(v.safeParse(saveLayoutSchema, { version: 0, layout: { floors: [floor('ground', 'Ground', { hidden: false as unknown as true })], placements: [] } }).success).toBe(false)
  })
})

describe('version history (ISS-027)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a snapshot at the first save, then at most one per LAYOUT_SNAPSHOT_EVERY_MS, and reads it back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    await save({ version: 1, layout: { floors: [floor('ground', 'Renamed')], placements: [] } })
    expect((await listLayoutHistory(db, TEST_TENANT, branch)).map(entry => entry.version)).toEqual([1])
    vi.setSystemTime(start + LAYOUT_SNAPSHOT_EVERY_MS + 1)
    await save({ version: 2, layout: { floors: [floor('ground', 'Later')], placements: [] } })
    const history = await listLayoutHistory(db, TEST_TENANT, branch)
    expect(history.map(entry => entry.version)).toEqual([3, 1])
    expect(history[0]!.savedByName).not.toBeUndefined()
    expect((await getLayoutSnapshot(db, TEST_TENANT, branch, 3)).floors[0]!.name).toBe('Later')
    expect((await getLayoutSnapshot(db, TEST_TENANT, branch, 1)).floors[0]!.name).toBe('Ground')
    await expectApiError(() => getLayoutSnapshot(db, TEST_TENANT, branch, 2), 404, 'NOT_FOUND')
  })

  it('keeps the newest LAYOUT_HISTORY_KEEP snapshots', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    const old = new Date(Date.now() - 2 * LAYOUT_SNAPSHOT_EVERY_MS)
    await db.delete(branchLayoutVersions)
    await db.batch(Array.from({ length: LAYOUT_HISTORY_KEEP + 5 }, (_, at) => insertSnapshotStatement(db, TEST_TENANT, branch, at - 100, null, old, { floors: [floor('ground')], placements: [] })) as Batch)
    await save({ version: 1, layout: { floors: [floor('ground', 'Newest')], placements: [] } })
    const versions = (await listLayoutHistory(db, TEST_TENANT, branch)).map(entry => entry.version)
    expect(versions).toHaveLength(LAYOUT_HISTORY_KEEP)
    expect(versions[0]).toBe(2)
    expect(versions.at(-1)).toBe(LAYOUT_HISTORY_KEEP + 5 - 100 - (LAYOUT_HISTORY_KEEP - 1))
  })

  it('a refused save keeps no snapshot', async () => {
    await save({ version: 0, layout: { floors: [floor('ground')], placements: [] } })
    await expectApiError(() => save({ version: 0, layout: { floors: [floor('ground')], placements: [] } }), 409, 'VERSION_CONFLICT')
    expect(await listLayoutHistory(db, TEST_TENANT, branch)).toHaveLength(1)
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
    const outline = fine.slabs[0]!.outline
    for (const [broken, message] of [[outline.slice(0, 2), 'An outline needs 3 corners'], [[outline[0]!, outline[1]!, outline[3]!, outline[2]!], 'The outline crosses itself']] as const) {
      const result = v.safeParse(floorSchema, { ...fine, slabs: [{ id: 'slab', outline: broken }] })
      expect(result.success).toBe(false)
      expect(result.issues?.map(issue => issue.message)).toContain(message)
    }
    // A v1 floor sent to the floor schema itself is refused, not thrown on.
    expect(v.safeParse(floorSchema, { ...fine, slabs: undefined, outline, edges: [] }).success).toBe(false)
  })

  it('the largest save (every floor full, every table placed) fits the route\'s body limit and passes the contract', () => {
    const body = largestLayout(Array.from({ length: MAX_BRANCH_TABLES }, () => newId()), 123_456)
    expect(jsonBytes(body)).toBeLessThanOrEqual(LAYOUT_MAX_BODY_BYTES)
    expect(v.safeParse(saveLayoutSchema, body).success).toBe(true)
    expect(v.safeParse(saveLayoutSchema, { ...body, layout: { ...body.layout, placements: [...body.layout.placements, body.layout.placements[0]!] } }).success).toBe(false)
  })
})
