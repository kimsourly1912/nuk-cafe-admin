import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CUSTOM_LOOKS } from '#shared/contracts/shop-layout'
import type { CreateLookInput, Floor, Placement } from '#shared/contracts/shop-layout'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { deleteUploads, uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { mediaAssets } from '#server/features/media/media.schema'
import { getLayout, saveLayout } from '#server/features/branches/branches.layout.service'
import { replaceLayoutStatements } from '#server/features/branches/branches.layout.repository'
import { createLook, deleteLook, listLooks, updateLook } from '#server/features/branches/branches.looks.service'
import { deleteLookStatement, findLook, looksWithUse, lookUse, updateLookStatement } from '#server/features/branches/branches.looks.repository'
import { archiveTable, createTable } from '#server/features/branches/branches.service'
import { customFurnitureLooks } from '#server/features/branches/branches.schema'
import type { QrConfig } from '#server/features/branches/branches.qr'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// A cafe's own table looks (D273, step 3a): cafe-wide, edited at a version, shared by the tables
// placed with them, and never deleted while a saved layout uses them.

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

const look = (name: string, extra: Partial<CreateLookInput> = {}): CreateLookInput => ({
  name,
  shape: 'rect',
  base: 'legs',
  chair: 'cafe-chair',
  finishes: { top: 'walnut', base: 'graphite', frame: 'walnut', seat: 'navy' },
  defaultWidth: 160,
  defaultDepth: 80,
  photoId: null,
  ...extra,
})

const floor = (id: string): Floor => ({
  id,
  name: 'Ground',
  height: 300,
  hasRoof: true,
  outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
  edges: [{ kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }],
  walls: [],
  items: [],
})

const placed = (tableId: string, lookId: string): Placement =>
  ({ tableId, floorId: 'ground', x: 200, y: 200, rotation: 0, width: 120, depth: 70, lookId })

const table = (label: string, at = branch, as = actor) => createTable(db, as, at, { label, area: null, seats: 4 }, qr)
/** Saves a one-floor layout placing each table with its look, from `version`. */
const place = (placements: Placement[], version = 0, on = db, as = actor, at = branch) =>
  saveLayout(on, as, at, { version, layout: { floors: [floor('ground')], placements } })
const lookField = (index: number) => [`layout.placements.${index}.lookId`]

describe('custom looks', () => {
  it('creates a look and lists the cafe\'s looks by name, each with its tables, audited', async () => {
    const walnut = await createLook(db, actor, look('walnut long'))
    const booth = await createLook(db, actor, look('Blue booth', { shape: 'booth', chair: 'none', finishes: { top: 'walnut', base: 'walnut', seat: 'navy' } }))
    expect(walnut).toMatchObject({ name: 'walnut long', shape: 'rect', base: 'legs', chair: 'cafe-chair', finishes: { top: 'walnut', seat: 'navy' }, defaultWidth: 160, defaultDepth: 80, version: 1, tables: 0 })
    const t1 = await table('T1')
    await place([placed(t1.id, walnut.id)])
    expect((await listLooks(db, TEST_TENANT)).map(row => [row.name, row.tables])).toEqual([['Blue booth', 0], ['walnut long', 1]])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.targetId, booth.id))
    expect(audit).toMatchObject([{ action: 'branch.look.create', targetType: 'furniture_look', tenantId: TEST_TENANT }])
  })

  it('refuses a name another look has, in any capitals, on create and on update', async () => {
    const first = await createLook(db, actor, look('Walnut long'))
    await expectApiError(() => createLook(db, actor, look('WALNUT LONG')), 409, 'LOOK_NAME_TAKEN', ['name'])
    const second = await createLook(db, actor, look('Oak short'))
    await expectApiError(() => updateLook(db, actor, second.id, { version: 1, ...look('walnut long') }), 409, 'LOOK_NAME_TAKEN', ['name'])
    // Its own name again is no clash.
    expect(await updateLook(db, actor, first.id, { version: 1, ...look('Walnut Long') })).toMatchObject({ name: 'Walnut Long', version: 2 })
  })

  it(`refuses a look past ${MAX_CUSTOM_LOOKS}, also when another create lands meanwhile (the guard in the batch)`, async () => {
    for (let index = 0; index < MAX_CUSTOM_LOOKS - 1; index++) await createLook(db, actor, look(`Look ${index}`))
    const racing = interleaved(db, () => createLook(db, actor, look('Landed first')))
    await expectApiError(() => createLook(racing, actor, look('One too many')), 409, 'LOOK_LIMIT')
    expect(await listLooks(db, TEST_TENANT)).toHaveLength(MAX_CUSTOM_LOOKS)
    await expectApiError(() => createLook(db, actor, look('Still too many')), 409, 'LOOK_LIMIT')
  })

  it('the database refuses a size outside 40 to 600 cm', async () => {
    const insert = (defaultWidthCm: number) => db.insert(customFurnitureLooks).values({ tenantId: TEST_TENANT, name: `W${defaultWidthCm}`, shape: 'rect', base: 'legs', chair: 'none', finishes: { top: 'walnut', base: 'walnut' }, defaultWidthCm, defaultDepthCm: 80 })
    const refused = { cause: { message: expect.stringMatching(/CHECK constraint failed: custom_furniture_looks_check/) } }
    await expect(insert(39)).rejects.toMatchObject(refused)
    await expect(insert(601)).rejects.toMatchObject(refused)
    await insert(600)
  })
})

describe('editing a look', () => {
  it('replaces the look at the version read; tables placed with it keep their own size', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    await place([placed(t1.id, created.id)])
    const updated = await updateLook(db, actor, created.id, { version: 1, ...look('Marble round', { shape: 'round', base: 'pedestal', finishes: { top: 'white-marble', base: 'brass' }, defaultWidth: 90, defaultDepth: 90 }) })
    expect(updated).toMatchObject({ id: created.id, name: 'Marble round', shape: 'round', base: 'pedestal', finishes: { top: 'white-marble', base: 'brass' }, defaultWidth: 90, version: 2, tables: 1 })
    expect((await getLayout(db, TEST_TENANT, branch)).placements).toMatchObject([{ tableId: t1.id, lookId: created.id, width: 120, depth: 70 }])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.look.update'))
    expect(audit[0]!.metadata).toMatchObject({ name: { from: 'Walnut long', to: 'Marble round' } })
  })

  it('refuses a stale version, and a change that lands meanwhile (the version guard), writing nothing', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    await updateLook(db, actor, created.id, { version: 1, ...look('Walnut longer') })
    await expectApiError(() => updateLook(db, actor, created.id, { version: 1, ...look('Mine') }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => updateLook(db, actor, created.id, { version: 2, ...look('Theirs') }))
    await expectApiError(() => updateLook(racing, actor, created.id, { version: 2, ...look('Mine') }), 409, 'VERSION_CONFLICT')
    expect((await listLooks(db, TEST_TENANT))[0]).toMatchObject({ name: 'Theirs', version: 3 })
  })

  it('404s an unknown look, and one deleted meanwhile', async () => {
    await expectApiError(() => updateLook(db, actor, newId(), { version: 1, ...look('Mine') }), 404, 'NOT_FOUND')
    const created = await createLook(db, actor, look('Walnut long'))
    const racing = interleaved(db, () => deleteLook(db, actor, created.id, { version: 1 }))
    await expectApiError(() => updateLook(racing, actor, created.id, { version: 1, ...look('Mine') }), 404, 'NOT_FOUND')
  })
})

describe('deleting a look', () => {
  it('deletes a look no table uses, audited', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    await deleteLook(db, actor, created.id, { version: 1 })
    expect(await listLooks(db, TEST_TENANT)).toEqual([])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.look.delete'))
    expect(audit).toMatchObject([{ targetId: created.id, metadata: { name: 'Walnut long' } }])
  })

  it('refuses while placed tables use it, naming them with their branch, in any branch', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const uptown = await addBranch('Uptown')
    const t1 = await table('T1')
    const u7 = await table('U7', uptown)
    await place([placed(t1.id, created.id)])
    await place([placed(u7.id, created.id)], 0, db, actor, uptown)
    await expectApiError(() => deleteLook(db, actor, created.id, { version: 1 }), 409, 'LOOK_IN_USE', undefined, 'This look is used by T1 (Riverside), U7 (Uptown). Give those tables another look first.')
    expect(await listLooks(db, TEST_TENANT)).toMatchObject([{ id: created.id, tables: 2 }])
  })

  it('refuses when a layout using it is saved meanwhile (the placements\' foreign key)', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    // The delete's own check reads with a batch: the save lands after it, before the write.
    const racing = interleaved(db, () => place([placed(t1.id, created.id)]), 1)
    await expectApiError(() => deleteLook(racing, actor, created.id, { version: 1 }), 409, 'LOOK_IN_USE', undefined, 'This look is used by T1 (Riverside). Give that table another look first.')
    expect(await findLook(db, TEST_TENANT, created.id)).toBeDefined()
  })

  it('refuses a stale version, and a change that lands meanwhile (the version guard)', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    await expectApiError(() => deleteLook(db, actor, created.id, { version: 2 }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => updateLook(db, actor, created.id, { version: 1, ...look('Renamed') }), 1)
    await expectApiError(() => deleteLook(racing, actor, created.id, { version: 1 }), 409, 'VERSION_CONFLICT')
    expect(await listLooks(db, TEST_TENANT)).toMatchObject([{ name: 'Renamed' }])
  })

  it('a look is free again once its tables leave the plan: another look, an archived table, a removed floor', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    const t2 = await table('T2')
    await place([placed(t1.id, created.id), placed(t2.id, created.id)])
    await place([placed(t1.id, 'round-cafe'), placed(t2.id, created.id)], 1)
    await archiveTable(db, actor, branch, t2.id, { version: 1 }, qr)
    await deleteLook(db, actor, created.id, { version: 1 })
    expect(await listLooks(db, TEST_TENANT)).toEqual([])
  })
})

describe('looks on the plan', () => {
  it('saves a table with a custom look and reads it back; built-in looks still save', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    const t2 = await table('T2')
    const saved = await place([placed(t1.id, created.id), placed(t2.id, 'green-booth')])
    expect(saved.placements.map(placement => placement.lookId).sort()).toEqual([created.id, 'green-booth'].sort())
  })

  it('refuses a look that is neither built in nor the cafe\'s, by its place in the save, writing nothing', async () => {
    const t1 = await table('T1')
    const t2 = await table('T2')
    await expectApiError(() => place([placed(t1.id, 'round-cafe'), placed(t2.id, newId())]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(1))
    await expectApiError(() => place([placed(t1.id, 'no-such-look')]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
  })

  it('refuses a look deleted meanwhile (the placements\' foreign key)', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    // The save's checks read with a batch: the delete lands after them, before the write.
    const racing = interleaved(db, () => deleteLook(db, actor, created.id, { version: 1 }), 1)
    await expectApiError(() => place([placed(t1.id, created.id)], 0, racing), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0))
    expect((await getLayout(db, TEST_TENANT, branch)).version).toBe(0)
  })

  it('the database refuses a placement with both a built-in and a custom look, or neither', async () => {
    const created = await createLook(db, actor, look('Walnut long'))
    const t1 = await table('T1')
    await place([])
    const row = { tableId: t1.id, floorId: 'ground', xCm: 0, yCm: 0, rotation: 0, widthCm: 80, depthCm: 80 }
    const write = (looks: { look: 'round-cafe' | null, customLookId: string | null }) =>
      db.batch(replaceLayoutStatements(db, TEST_TENANT, branch, [], [{ ...row, ...looks }]) as Batch)
    await expect(write({ look: 'round-cafe', customLookId: created.id })).rejects.toThrow(/check/i)
    await expect(write({ look: null, customLookId: null })).rejects.toThrow(/check/i)
  })
})

describe('a look\'s photo (step 3b)', () => {
  const store: ObjectStore = { put: async () => undefined, del: async () => undefined }
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array.from({ length: 32 }, (_, i) => i)])
  const upload = (as = actor) => uploadImage(db, store, as, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
  const stateOf = async (id: string) => (await db.select({ state: mediaAssets.state }).from(mediaAssets).where(eq(mediaAssets.id, id)))[0]?.state

  it('attaches the photo with the look and lists it; audited', async () => {
    const photo = await upload()
    const created = await createLook(db, actor, look('Walnut long', { photoId: photo.id }))
    expect(created.photo).toEqual({ id: photo.id, url: photo.url })
    expect(await stateOf(photo.id)).toBe('attached')
    expect((await listLooks(db, TEST_TENANT)).map(row => row.photo)).toEqual([{ id: photo.id, url: photo.url }])
    expect(await createLook(db, actor, look('No photo'))).toMatchObject({ photo: null })
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.targetId, created.id))
    expect(audit[0]!.metadata).toMatchObject({ photo: true })
  })

  it('refuses a photo another look has, on create and on edit, writing nothing', async () => {
    const photo = await upload()
    await createLook(db, actor, look('Walnut long', { photoId: photo.id }))
    await expectApiError(() => createLook(db, actor, look('Oak short', { photoId: photo.id })), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    const other = await createLook(db, actor, look('Oak short'))
    await expectApiError(() => updateLook(db, actor, other.id, { version: 1, ...look('Oak short', { photoId: photo.id }) }), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    expect((await listLooks(db, TEST_TENANT)).map(row => [row.name, row.photo?.id ?? null, row.version])).toEqual([['Oak short', null, 1], ['Walnut long', photo.id, 1]])
  })

  it('an edit that keeps the photo leaves it attached; replacing or removing it releases the old one', async () => {
    const [first, second] = [await upload(), await upload()]
    const created = await createLook(db, actor, look('Walnut long', { photoId: first.id }))
    // The same photo again isn't attached a second time (that would be refused).
    const renamed = await updateLook(db, actor, created.id, { version: 1, ...look('Walnut longer', { photoId: first.id }) })
    expect(renamed.photo?.id).toBe(first.id)
    const replaced = await updateLook(db, actor, created.id, { version: 2, ...look('Walnut longer', { photoId: second.id }) })
    expect(replaced.photo?.id).toBe(second.id)
    expect([await stateOf(first.id), await stateOf(second.id)]).toEqual(['temporary', 'attached'])
    const removed = await updateLook(db, actor, created.id, { version: 3, ...look('Walnut longer') })
    expect(removed.photo).toBeNull()
    expect(await stateOf(second.id)).toBe('temporary')
    // A released photo can be another look's.
    expect((await createLook(db, actor, look('Oak short', { photoId: first.id }))).photo?.id).toBe(first.id)
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'branch.look.update'))
    expect(audit.map(row => (row.metadata as { photo?: string }).photo)).toEqual([undefined, 'set', 'removed'])
  })

  it('deleting a look releases its photo', async () => {
    const photo = await upload()
    const created = await createLook(db, actor, look('Walnut long', { photoId: photo.id }))
    await deleteLook(db, actor, created.id, { version: 1 })
    expect(await stateOf(photo.id)).toBe('temporary')
  })

  it('refuses a photo another look takes meanwhile (the attach guard in the batch), writing nothing', async () => {
    const photo = await upload()
    const racingCreate = interleaved(db, () => createLook(db, actor, look('Landed first', { photoId: photo.id })))
    await expectApiError(() => createLook(racingCreate, actor, look('Mine', { photoId: photo.id })), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    expect((await listLooks(db, TEST_TENANT)).map(row => row.name)).toEqual(['Landed first'])

    const second = await upload()
    const mine = await createLook(db, actor, look('Mine'))
    const racingEdit = interleaved(db, () => createLook(db, actor, look('Also first', { photoId: second.id })))
    await expectApiError(() => updateLook(racingEdit, actor, mine.id, { version: 1, ...look('Mine', { photoId: second.id }) }), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    expect((await listLooks(db, TEST_TENANT)).find(row => row.id === mine.id)).toMatchObject({ photo: null, version: 1 })
  })

  it('a stale edit that changes the photo is still a version conflict', async () => {
    const photo = await upload()
    const created = await createLook(db, actor, look('Walnut long'))
    const racing = interleaved(db, () => updateLook(db, actor, created.id, { version: 1, ...look('Theirs') }))
    await expectApiError(() => updateLook(racing, actor, created.id, { version: 1, ...look('Mine', { photoId: photo.id }) }), 409, 'VERSION_CONFLICT')
    expect(await stateOf(photo.id)).toBe('temporary')
  })

  it('a look whose upload is gone shows no photo and still saves', async () => {
    const photo = await upload()
    const created = await createLook(db, actor, look('Walnut long', { photoId: photo.id }))
    // The sample menu's reset deletes every upload of the cafe (D94).
    await deleteUploads(db, TEST_TENANT, store, 10)
    expect((await listLooks(db, TEST_TENANT))[0]!.photo).toBeNull()
    expect(await updateLook(db, actor, created.id, { version: 1, ...look('Walnut long') })).toMatchObject({ photo: null, version: 2 })
  })

  it('refuses another cafe\'s upload, and never shows it', async () => {
    await ensureTenant(db, 'tenant-2')
    const theirOwner: Actor = { userId: (await createUser(db)).id, tenantId: 'tenant-2', role: 'owner', requestId: 'req-2' }
    const theirs = await upload(theirOwner)
    await expectApiError(() => createLook(db, actor, look('Walnut long', { photoId: theirs.id })), 422, 'MEDIA_NOT_AVAILABLE', ['photoId'])
    expect(await stateOf(theirs.id)).toBe('temporary')
    // Even a row that names it (written past the service) shows no photo.
    const created = await createLook(db, actor, look('Walnut long'))
    await db.update(customFurnitureLooks).set({ photoAssetId: theirs.id }).where(eq(customFurnitureLooks.id, created.id))
    expect((await listLooks(db, TEST_TENANT))[0]!.photo).toBeNull()
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
    theirLook = (await createLook(db, theirOwner, look('Walnut long'))).id
    const theirTable = await table('T1', theirBranch, theirOwner)
    await place([placed(theirTable.id, theirLook)], 0, db, theirOwner, theirBranch)
  })

  it('another cafe\'s looks aren\'t listed, edited or deleted; the same name is free for us', async () => {
    expect(await listLooks(db, TEST_TENANT)).toEqual([])
    await expectApiError(() => updateLook(db, actor, theirLook, { version: 1, ...look('Mine now') }), 404, 'NOT_FOUND')
    await expectApiError(() => deleteLook(db, actor, theirLook, { version: 1 }), 404, 'NOT_FOUND')
    expect(await createLook(db, actor, look('Walnut long'))).toMatchObject({ name: 'Walnut long', tables: 0 })
    expect(await listLooks(db, OTHER)).toMatchObject([{ id: theirLook, name: 'Walnut long', version: 1, tables: 1 }])
  })

  it('another cafe\'s look can\'t be given to our table, and the database refuses the link itself', async () => {
    const t1 = await table('T1')
    await expectApiError(() => place([placed(t1.id, theirLook)]), 409, 'LAYOUT_LOOK_UNAVAILABLE', lookField(0))
    await place([])
    const row = { tableId: t1.id, floorId: 'ground', xCm: 0, yCm: 0, rotation: 0, widthCm: 80, depthCm: 80, look: null, customLookId: theirLook }
    await expect(db.batch(replaceLayoutStatements(db, TEST_TENANT, branch, [], [row]) as Batch)).rejects.toThrow(/foreign key/i)
  })

  it('the repository reads and writes none of their rows with our cafe\'s id', async () => {
    expect(await looksWithUse(db, TEST_TENANT)).toEqual({ looks: [], use: new Map() })
    expect(await findLook(db, TEST_TENANT, theirLook)).toBeUndefined()
    expect(await lookUse(db, TEST_TENANT, theirLook, 5)).toEqual({ total: 0, tables: [] })
    const before = await findLook(db, OTHER, theirLook)
    await db.batch([
      updateLookStatement(db, TEST_TENANT, theirLook, 1, { name: 'Taken', shape: 'round', base: 'pedestal', chair: 'none', finishes: { top: 'walnut', base: 'walnut' }, defaultWidthCm: 60, defaultDepthCm: 60, photoAssetId: null }, new Date()),
      deleteLookStatement(db, TEST_TENANT, theirLook, 1),
    ])
    expect(await findLook(db, OTHER, theirLook)).toEqual(before)
    expect(await lookUse(db, OTHER, theirLook, 5)).toEqual({ total: 1, tables: [{ label: 'T1', branch: 'Their branch' }] })
  })
})
