import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import { createItemLookSchema, floorSchema, ITEM_HEIGHTS, MAX_CUSTOM_ITEM_LOOKS, updateItemLookSchema } from '#shared/contracts/shop-layout'
import type { CreateItemLookInput, Floor, LayoutItem } from '#shared/contracts/shop-layout'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { mediaAssets } from '#server/features/media/media.schema'
import { getLayout, saveLayout } from '#server/features/branches/branches.layout.service'
import { replaceLayoutStatements } from '#server/features/branches/branches.layout.repository'
import { createItemLook, deleteItemLook, listItemLooks, updateItemLook } from '#server/features/branches/branches.item-looks.service'
import { deleteItemLookStatement, findItemLook, itemLookUse, itemLooksWithUse, updateItemLookStatement } from '#server/features/branches/branches.item-looks.repository'
import { createTable } from '#server/features/branches/branches.service'
import type { QrConfig } from '#server/features/branches/branches.qr'
import { branchLayoutItemLooks, customItemLooks } from '#server/features/branches/branches.schema'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// A cafe's own chair and fixture looks (D273, step 3d): cafe-wide, edited at a version, shared by
// the pieces placed with them, never deleted while a saved floor uses them, and of one kind for good.

type Batch = [Statement, ...Statement[]]

let db: Db
let branch: string
let actor: Actor
const qr: QrConfig = { secret: 'test-secret', baseUrl: 'https://cafe.example' }

async function addBranch(name: string, tenantId = TEST_TENANT) {
  const id = newId()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', tenantId })
  return id
}

beforeEach(async () => {
  db = await createTestDb()
  branch = await addBranch('Riverside')
  actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
})

const chair = (name: string, extra: Partial<CreateItemLookInput> = {}): CreateItemLookInput => ({
  name,
  kind: 'cafe-chair',
  finishes: { frame: 'walnut', seat: 'navy' },
  defaultWidth: 46,
  defaultDepth: 52,
  defaultHeight: null,
  photoId: null,
  ...extra,
})
const edit = (input: CreateItemLookInput, version: number) => {
  const { kind: _kind, ...fields } = input
  return { version, ...fields }
}

let pieces = 0
const piece = (lookId?: string, kind: LayoutItem['kind'] = 'cafe-chair'): LayoutItem =>
  ({ id: `item-${++pieces}`, kind, x: 100, y: 100, rotation: 0, width: 46, depth: 52, finishes: {}, ...(lookId && { lookId }) })

const floor = (id: string, items: LayoutItem[], name = id === 'ground' ? 'Ground' : 'Upstairs'): Floor => ({
  id,
  name,
  height: 300,
  hasRoof: true,
  outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
  edges: [{ kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }],
  walls: [],
  items,
})

/** Saves a layout of these floors (no tables), from `version`. */
const furnish = (floors: Floor[], version = 0, on = db, as = actor, at = branch) =>
  saveLayout(on, as, at, { version, layout: { floors, placements: [] } })
const usesOf = async (tenantId = TEST_TENANT) =>
  (await db.select().from(branchLayoutItemLooks).where(eq(branchLayoutItemLooks.tenantId, tenantId))).map(({ floorId, lookId, kind, pieces }) => ({ floorId, lookId, kind, pieces }))
const lookField = (floorAt: number, index: number) => [`layout.floors.${floorAt}.items.${index}.lookId`]

describe('item looks', () => {
  it('creates a look and lists the cafe\'s looks by name, each with its pieces in every branch, audited', async () => {
    const walnut = await createItemLook(db, actor, chair('walnut chair'))
    const counter = await createItemLook(db, actor, chair('Bar counter', { kind: 'service-counter', finishes: { cabinet: 'dark-wood', top: 'white-marble' }, defaultWidth: 240, defaultDepth: 70 }))
    expect(walnut).toMatchObject({ name: 'walnut chair', kind: 'cafe-chair', finishes: { frame: 'walnut', seat: 'navy' }, defaultWidth: 46, defaultDepth: 52, photo: null, version: 1, pieces: 0 })
    const uptown = await addBranch('Uptown')
    await furnish([floor('ground', [piece(walnut.id), piece(walnut.id), piece()])])
    await furnish([floor('ground', [piece(walnut.id)])], 0, db, actor, uptown)
    expect((await listItemLooks(db, TEST_TENANT)).map(row => [row.name, row.pieces])).toEqual([['Bar counter', 0], ['walnut chair', 3]])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.targetId, counter.id))
    expect(audit).toMatchObject([{ action: 'branch.item-look.create', targetType: 'furniture_item_look', tenantId: TEST_TENANT, metadata: { kind: 'service-counter' } }])
  })

  it('refuses a name another item look has, in any capitals; a table look of that name is no clash', async () => {
    await createItemLook(db, actor, chair('Walnut chair'))
    await expectApiError(() => createItemLook(db, actor, chair('WALNUT CHAIR', { kind: 'bar-stool' })), 409, 'LOOK_NAME_TAKEN', ['name'])
    const second = await createItemLook(db, actor, chair('Oak stool', { kind: 'bar-stool' }))
    await expectApiError(() => updateItemLook(db, actor, second.id, edit(chair('walnut chair'), 1)), 409, 'LOOK_NAME_TAKEN', ['name'])
  })

  it(`refuses a look past ${MAX_CUSTOM_ITEM_LOOKS}, also when another create lands meanwhile (the guard in the batch)`, async () => {
    for (let index = 0; index < MAX_CUSTOM_ITEM_LOOKS - 1; index++) await createItemLook(db, actor, chair(`Chair ${index}`))
    const racing = interleaved(db, () => createItemLook(db, actor, chair('Landed first')))
    await expectApiError(() => createItemLook(racing, actor, chair('One too many')), 409, 'LOOK_LIMIT')
    expect(await listItemLooks(db, TEST_TENANT)).toHaveLength(MAX_CUSTOM_ITEM_LOOKS)
    await expectApiError(() => createItemLook(db, actor, chair('Still too many')), 409, 'LOOK_LIMIT')
  })

  it('the database refuses a size outside 10 to 2000 cm', async () => {
    const insert = (defaultWidthCm: number) => db.insert(customItemLooks).values({ tenantId: TEST_TENANT, name: `W${defaultWidthCm}`, kind: 'plant', finishes: {}, defaultWidthCm, defaultDepthCm: 50 })
    const refused = { cause: { message: expect.stringMatching(/CHECK constraint failed: custom_item_looks_check/) } }
    await expect(insert(9)).rejects.toMatchObject(refused)
    await expect(insert(2001)).rejects.toMatchObject(refused)
    await insert(2000)
  })
})

describe('editing an item look', () => {
  it('replaces the look at the version read; its pieces keep their own size', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await furnish([floor('ground', [{ ...piece(created.id), width: 60, depth: 60 }])])
    const updated = await updateItemLook(db, actor, created.id, edit(chair('Brass chair', { finishes: { frame: 'pale-oak', seat: 'terracotta' }, defaultWidth: 50 }), 1))
    expect(updated).toMatchObject({ id: created.id, name: 'Brass chair', kind: 'cafe-chair', finishes: { frame: 'pale-oak', seat: 'terracotta' }, defaultWidth: 50, version: 2, pieces: 1 })
    expect((await getLayout(db, TEST_TENANT, branch)).floors[0]!.items).toMatchObject([{ lookId: created.id, width: 60, depth: 60 }])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.item-look.update'))
    expect(audit[0]!.metadata).toMatchObject({ name: { from: 'Walnut chair', to: 'Brass chair' } })
  })

  it('never changes the kind: the edit has none, and the database refuses a kind its pieces don\'t have', async () => {
    expect(v.safeParse(updateItemLookSchema, { ...edit(chair('Mine'), 1), kind: 'bar-stool' }).success).toBe(false)
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await furnish([floor('ground', [piece(created.id)])])
    // Past the service: the uses' foreign key names the kind, so the look can't move to another.
    await expect(db.update(customItemLooks).set({ kind: 'bar-stool' }).where(eq(customItemLooks.id, created.id))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/FOREIGN KEY/) } })
  })

  it('refuses a stale version, and a change that lands meanwhile (the version guard), writing nothing', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await updateItemLook(db, actor, created.id, edit(chair('Walnut chair 2'), 1))
    await expectApiError(() => updateItemLook(db, actor, created.id, edit(chair('Mine'), 1)), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => updateItemLook(db, actor, created.id, edit(chair('Theirs'), 2)))
    await expectApiError(() => updateItemLook(racing, actor, created.id, edit(chair('Mine'), 2)), 409, 'VERSION_CONFLICT')
    expect((await listItemLooks(db, TEST_TENANT))[0]).toMatchObject({ name: 'Theirs', version: 3 })
  })

  it('404s an unknown look, and one deleted meanwhile', async () => {
    await expectApiError(() => updateItemLook(db, actor, newId(), edit(chair('Mine'), 1)), 404, 'NOT_FOUND')
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    const racing = interleaved(db, () => deleteItemLook(db, actor, created.id, { version: 1 }))
    await expectApiError(() => updateItemLook(racing, actor, created.id, edit(chair('Mine'), 1)), 404, 'NOT_FOUND')
  })
})

describe('deleting an item look', () => {
  it('deletes a look no piece uses, audited', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await deleteItemLook(db, actor, created.id, { version: 1 })
    expect(await listItemLooks(db, TEST_TENANT)).toEqual([])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.item-look.delete'))
    expect(audit).toMatchObject([{ targetId: created.id, metadata: { name: 'Walnut chair' } }])
  })

  it('refuses while saved floors use it, naming them with their branch and pieces, in any branch', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    const uptown = await addBranch('Uptown')
    await furnish([floor('ground', [piece(created.id), piece(created.id)]), floor('upstairs', [piece(created.id)])])
    await furnish([floor('ground', [piece(created.id)])], 0, db, actor, uptown)
    await expectApiError(() => deleteItemLook(db, actor, created.id, { version: 1 }), 409, 'LOOK_IN_USE', undefined, 'This look is used by 4 pieces: 2 on the Ground floor (Riverside), 1 on the Upstairs floor (Riverside), 1 on the Ground floor (Uptown). Give them another look first.')
    expect(await listItemLooks(db, TEST_TENANT)).toMatchObject([{ id: created.id, pieces: 4 }])
  })

  it('refuses when a layout using it is saved meanwhile (the uses\' foreign key)', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    // The delete's own check reads with a batch: the save lands after it, before the write.
    const racing = interleaved(db, () => furnish([floor('ground', [piece(created.id)])]), 1)
    await expectApiError(() => deleteItemLook(racing, actor, created.id, { version: 1 }), 409, 'LOOK_IN_USE', undefined, 'This look is used by 1 piece: 1 on the Ground floor (Riverside). Give it another look first.')
    expect(await findItemLook(db, TEST_TENANT, created.id)).toBeDefined()
  })

  it('refuses a stale version, and a change that lands meanwhile (the version guard)', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await expectApiError(() => deleteItemLook(db, actor, created.id, { version: 2 }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => updateItemLook(db, actor, created.id, edit(chair('Renamed'), 1)), 1)
    await expectApiError(() => deleteItemLook(racing, actor, created.id, { version: 1 }), 409, 'VERSION_CONFLICT')
    expect(await listItemLooks(db, TEST_TENANT)).toMatchObject([{ name: 'Renamed' }])
  })

  it('a look is free again once its pieces leave: their own finishes, deleted, or their floor removed', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await furnish([floor('ground', [piece(created.id), piece(created.id)]), floor('upstairs', [piece(created.id)])])
    await furnish([floor('ground', [piece(), piece(created.id)]), floor('upstairs', [piece(created.id)])], 1)
    expect(await usesOf()).toEqual([{ floorId: 'ground', lookId: created.id, kind: 'cafe-chair', pieces: 1 }, { floorId: 'upstairs', lookId: created.id, kind: 'cafe-chair', pieces: 1 }])
    await furnish([floor('ground', [piece()])], 2)
    expect(await usesOf()).toEqual([])
    await deleteItemLook(db, actor, created.id, { version: 1 })
  })
})

describe('item looks on the plan', () => {
  it('saves pieces with custom looks and reads them back, one use row per floor and look', async () => {
    const walnut = await createItemLook(db, actor, chair('Walnut chair'))
    const plant = await createItemLook(db, actor, chair('Fig in stone', { kind: 'plant', finishes: { pot: 'limestone' }, defaultWidth: 60, defaultDepth: 60 }))
    const floors = [floor('ground', [piece(walnut.id), piece(walnut.id), piece(plant.id, 'plant'), piece()]), floor('upstairs', [piece(walnut.id)])]
    const saved = await furnish(floors)
    expect(saved.floors).toEqual(floors)
    expect((await usesOf()).sort((a, b) => `${a.floorId}${a.lookId}`.localeCompare(`${b.floorId}${b.lookId}`))).toEqual([
      { floorId: 'ground', lookId: plant.id, kind: 'plant', pieces: 1 },
      { floorId: 'ground', lookId: walnut.id, kind: 'cafe-chair', pieces: 2 },
      { floorId: 'upstairs', lookId: walnut.id, kind: 'cafe-chair', pieces: 1 },
    ].sort((a, b) => `${a.floorId}${a.lookId}`.localeCompare(`${b.floorId}${b.lookId}`)))
  })

  it('refuses a look the cafe doesn\'t have, or one of another kind, by its place in the save, writing nothing', async () => {
    const walnut = await createItemLook(db, actor, chair('Walnut chair'))
    await expectApiError(() => furnish([floor('ground', [piece(walnut.id), piece(newId())])]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0, 1))
    // A chair's look on a counter: the counter would be drawn as nothing it is.
    await expectApiError(() => furnish([floor('ground', [piece()]), floor('upstairs', [piece(walnut.id, 'service-counter')])]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(1, 0), 'A piece of furniture on this plan uses a look that was deleted. Choose another look for it and save again.')
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
    expect(await usesOf()).toEqual([])
  })

  it('names tables and pieces together when both use looks that are gone', async () => {
    const t1 = await createTable(db, actor, branch, { label: 'T1', area: null, seats: 4 }, qr)
    const placement = { tableId: t1.id, floorId: 'ground', x: 200, y: 200, rotation: 0, width: 80, depth: 80, lookId: newId() }
    const save = () => saveLayout(db, actor, branch, { version: 0, layout: { floors: [floor('ground', [piece(newId()), piece(newId())])], placements: [placement] } })
    await expectApiError(save, 409, 'LAYOUT_LOOK_UNAVAILABLE', ['layout.placements.0.lookId', ...lookField(0, 0), ...lookField(0, 1)], 'A table and 2 pieces of furniture on this plan use a look that was deleted. Choose another look for them and save again.')
  })

  it('refuses a look deleted meanwhile (the uses\' foreign key)', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    // The save's checks read with a batch: the delete lands after them, before the write.
    const racing = interleaved(db, () => deleteItemLook(db, actor, created.id, { version: 1 }), 1)
    await expectApiError(() => furnish([floor('ground', [piece(created.id)])], 0, racing), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0, 0))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
  })

  it('the contract refuses a look on stairs (a structure)', () => {
    expect(v.safeParse(floorSchema, floor('ground', [piece(newId(), 'stairs')])).success).toBe(false)
    expect(v.safeParse(floorSchema, floor('ground', [piece(undefined, 'stairs')])).success).toBe(true)
  })

  it('the database refuses a use of another kind than its look\'s, and a count outside 1 to 200', async () => {
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    await furnish([floor('ground', [])])
    const write = (kind: 'cafe-chair' | 'bar-stool', pieces: number) =>
      db.batch(replaceLayoutStatements(db, TEST_TENANT, branch, [{ id: 'ground', position: 0, name: 'Ground', heightCm: 300, hasRoof: true, geometry: { outline: [], edges: [], walls: [], items: [] } }], [], [{ floorId: 'ground', lookId: created.id, kind, pieces }]) as Batch)
    await expect(write('bar-stool', 1)).rejects.toThrow(/foreign key/i)
    await expect(write('cafe-chair', 0)).rejects.toThrow(/check/i)
    await expect(write('cafe-chair', 201)).rejects.toThrow(/check/i)
    await write('cafe-chair', 200)
  })
})

describe('an item look\'s photo', () => {
  const store: ObjectStore = { put: async () => undefined, del: async () => undefined }
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array.from({ length: 32 }, (_, i) => i)])
  const upload = (as = actor) => uploadImage(db, store, as, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
  const stateOf = async (id: string) => (await db.select({ state: mediaAssets.state }).from(mediaAssets).where(eq(mediaAssets.id, id)))[0]?.state

  it('attaches the photo with the look, lists it, and releases it when replaced, removed or deleted', async () => {
    const [first, second] = [await upload(), await upload()]
    const created = await createItemLook(db, actor, chair('Walnut chair', { photoId: first.id }))
    expect(created.photo).toEqual({ id: first.id, url: first.url })
    expect(await stateOf(first.id)).toBe('attached')
    // The same photo again isn't attached a second time (that would be refused).
    expect((await updateItemLook(db, actor, created.id, edit(chair('Walnut chair', { photoId: first.id }), 1))).photo?.id).toBe(first.id)
    await updateItemLook(db, actor, created.id, edit(chair('Walnut chair', { photoId: second.id }), 2))
    expect([await stateOf(first.id), await stateOf(second.id)]).toEqual(['temporary', 'attached'])
    expect((await updateItemLook(db, actor, created.id, edit(chair('Walnut chair'), 3))).photo).toBeNull()
    expect(await stateOf(second.id)).toBe('temporary')
    const other = await createItemLook(db, actor, chair('Oak stool', { kind: 'bar-stool', photoId: second.id }))
    await deleteItemLook(db, actor, other.id, { version: 1 })
    expect(await stateOf(second.id)).toBe('temporary')
  })

  it('refuses a photo another look has, or takes meanwhile (the attach guard in the batch)', async () => {
    const photo = await upload()
    await createItemLook(db, actor, chair('Walnut chair', { photoId: photo.id }))
    await expectApiError(() => createItemLook(db, actor, chair('Oak stool', { photoId: photo.id })), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    const second = await upload()
    const mine = await createItemLook(db, actor, chair('Mine'))
    const racingEdit = interleaved(db, () => createItemLook(db, actor, chair('Also first', { photoId: second.id })))
    await expectApiError(() => updateItemLook(racingEdit, actor, mine.id, edit(chair('Mine', { photoId: second.id }), 1)), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    const third = await upload()
    const racingCreate = interleaved(db, () => createItemLook(db, actor, chair('Landed first', { photoId: third.id })))
    await expectApiError(() => createItemLook(racingCreate, actor, chair('Mine too', { photoId: third.id })), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    expect((await listItemLooks(db, TEST_TENANT)).map(row => row.name)).toEqual(['Also first', 'Landed first', 'Mine', 'Walnut chair'])
  })
})

describe('tenants', () => {
  const OTHER = 'tenant-2'
  let theirBranch: string
  let theirOwner: Actor
  let theirLook: string

  beforeEach(async () => {
    theirBranch = await addBranch('Their branch', OTHER)
    theirOwner = { userId: (await createUser(db)).id, tenantId: OTHER, role: 'owner', requestId: 'req-2' }
    theirLook = (await createItemLook(db, theirOwner, chair('Walnut chair'))).id
    await furnish([floor('ground', [piece(theirLook)])], 0, db, theirOwner, theirBranch)
  })

  it('another cafe\'s looks aren\'t listed, edited or deleted; the same name is free for us', async () => {
    expect(await listItemLooks(db, TEST_TENANT)).toEqual([])
    await expectApiError(() => updateItemLook(db, actor, theirLook, edit(chair('Mine now'), 1)), 404, 'NOT_FOUND')
    await expectApiError(() => deleteItemLook(db, actor, theirLook, { version: 1 }), 404, 'NOT_FOUND')
    expect(await createItemLook(db, actor, chair('Walnut chair'))).toMatchObject({ name: 'Walnut chair', pieces: 0 })
    expect(await listItemLooks(db, OTHER)).toMatchObject([{ id: theirLook, version: 1, pieces: 1 }])
  })

  it('another cafe\'s look can\'t be given to our piece, and the database refuses the link itself', async () => {
    await expectApiError(() => furnish([floor('ground', [piece(theirLook)])]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0, 0))
    await furnish([floor('ground', [])])
    const row = { floorId: 'ground', lookId: theirLook, kind: 'cafe-chair' as const, pieces: 1 }
    const floorRow = { id: 'ground', position: 0, name: 'Ground', heightCm: 300, hasRoof: true, geometry: { outline: [], edges: [], walls: [], items: [] } }
    await expect(db.batch(replaceLayoutStatements(db, TEST_TENANT, branch, [floorRow], [], [row]) as Batch)).rejects.toThrow(/foreign key/i)
  })

  it('the repository reads and writes none of their rows with our cafe\'s id', async () => {
    expect(await itemLooksWithUse(db, TEST_TENANT)).toEqual({ looks: [], use: new Map() })
    expect(await findItemLook(db, TEST_TENANT, theirLook)).toBeUndefined()
    expect(await itemLookUse(db, TEST_TENANT, theirLook, 5)).toEqual({ total: 0, places: [] })
    const before = await findItemLook(db, OTHER, theirLook)
    await db.batch([
      updateItemLookStatement(db, TEST_TENANT, theirLook, 1, { name: 'Taken', finishes: {}, defaultWidthCm: 60, defaultDepthCm: 60, defaultHeightCm: null, photoAssetId: null }, new Date()),
      deleteItemLookStatement(db, TEST_TENANT, theirLook, 1),
      // Our branch's replace never touches their floors' uses.
      ...replaceLayoutStatements(db, TEST_TENANT, theirBranch, [], []),
    ])
    expect(await findItemLook(db, OTHER, theirLook)).toEqual(before)
    expect(await itemLookUse(db, OTHER, theirLook, 5)).toEqual({ total: 1, places: [{ floor: 'Ground', branch: 'Their branch', pieces: 1 }] })
  })
})

describe('heights (step 3e, QS2)', () => {
  it('a look keeps the height it is made with; without one, the kind\'s default (a look from before 3e too)', async () => {
    const tall = await createItemLook(db, actor, chair('Tall chair', { defaultHeight: 105 }))
    const plain = await createItemLook(db, actor, chair('Plain chair'))
    expect([tall.defaultHeight, plain.defaultHeight]).toEqual([105, ITEM_HEIGHTS['cafe-chair'].default])
    expect((await findItemLook(db, TEST_TENANT, plain.id))!.defaultHeightCm).toBeNull()
    const edited = await updateItemLook(db, actor, tall.id, edit(chair('Tall chair', { defaultHeight: 110 }), 1))
    expect(edited).toMatchObject({ defaultHeight: 110, version: 2 })
  })

  it('refuses a height out of the kind\'s range: the create in the contract, the edit (no kind) against the look\'s kind', async () => {
    const issues = (input: unknown) => v.safeParse(createItemLookSchema, input).issues?.map(issue => v.getDotPath(issue))
    expect(issues(chair('Short stool', { kind: 'bar-stool', defaultHeight: 44 }))).toEqual(['defaultHeight'])
    expect(issues(chair('Bar stool', { kind: 'bar-stool', defaultHeight: 90 }))).toBeUndefined()
    // 160 fits a display shelf but not a chair: the edit is checked against the look's own kind.
    const created = await createItemLook(db, actor, chair('Walnut chair'))
    expect(v.safeParse(updateItemLookSchema, edit(chair('Walnut chair', { defaultHeight: 160 }), 1)).success).toBe(true)
    await expectApiError(() => updateItemLook(db, actor, created.id, edit(chair('Walnut chair', { defaultHeight: 160 }), 1)), 400, 'VALIDATION_FAILED', ['defaultHeight'])
    expect((await findItemLook(db, TEST_TENANT, created.id))!.version).toBe(1)
  })

  it('the database refuses a height outside 20 to 300 cm', async () => {
    const insert = (defaultHeightCm: number) => db.insert(customItemLooks).values({ tenantId: TEST_TENANT, name: `H${defaultHeightCm}`, kind: 'plant', finishes: {}, defaultWidthCm: 50, defaultDepthCm: 50, defaultHeightCm })
    const refused = { cause: { message: expect.stringMatching(/CHECK constraint failed: custom_item_looks_height_check/) } }
    await expect(insert(19)).rejects.toMatchObject(refused)
    await expect(insert(301)).rejects.toMatchObject(refused)
    await insert(300)
  })

  it('a piece saves its own height in its kind\'s range; stairs and people and pets have none', async () => {
    await furnish([floor('ground', [{ ...piece(), height: 110 }, { ...piece(undefined, 'display-shelf'), width: 100, depth: 40, height: 240 }])])
    expect((await getLayout(db, TEST_TENANT, branch)).floors[0]!.items.map(item => item.height)).toEqual([110, 240])
    const heightIssues = (item: LayoutItem) => v.safeParse(floorSchema, floor('ground', [item])).issues?.map(issue => v.getDotPath(issue))
    expect(heightIssues({ ...piece(), height: 69 })).toEqual(['items.0.height'])
    expect(heightIssues({ ...piece(undefined, 'bar-stool'), height: 91 })).toEqual(['items.0.height'])
    expect(heightIssues({ ...piece(undefined, 'stairs'), width: 100, depth: 340, height: 300 })).toEqual(['items.0.height'])
    expect(heightIssues({ ...piece(undefined, 'cat'), width: 25, depth: 40, height: 40 })).toEqual(['items.0.height'])
    expect(heightIssues({ ...piece(undefined, 'bar-stool'), height: 45 })).toBeUndefined()
  })
})
