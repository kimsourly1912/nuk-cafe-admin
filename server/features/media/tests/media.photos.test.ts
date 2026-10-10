import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PhotoEdit } from '#shared/contracts/media'
import type { Actor } from '#server/features/identity'
import { mediaAssets } from '#server/features/media/media.schema'
import { assetUrls, attachStatements, deleteUploads, imageSets, photoForEdit, photoSourceKey, purgeExpiredUploads, uploadImage, uploadPhoto } from '#server/features/media/media.service'
import type { ObjectStore, PhotoUpload } from '#server/features/media/media.service'
import { imageSize } from '#server/features/media/media.rules'
import { createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'

// Menu photos (D158): the editor's private source and the files made from it, stored as one
// upload that a menu item attaches like any image.

let db: Db
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
const OTHER = 'tenant-2'

function memoryStore() {
  const objects = new Map<string, Uint8Array>()
  const store = {
    objects,
    failPut: false,
    async put(key: string, body: Uint8Array) {
      if (store.failPut) throw new Error('R2 unavailable')
      objects.set(key, body)
    },
    async del(key: string) {
      objects.delete(key)
    },
  }
  return store satisfies ObjectStore
}
let store: ReturnType<typeof memoryStore>

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const ascii = (text: string) => [...text].map(c => c.charCodeAt(0))
const file = (type: string, head: number[]) => ({ type, data: new Uint8Array([...head, ...Array.from<number>({ length: 32 }).fill(0)]) })

/** Just enough of each format's header to carry a size (the server never decodes, D158). */
const png = (w: number, h: number) => file('image/png', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(w), ...u32be(h)])
const webp = (w: number, h: number) => file('image/webp', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)])
const jpeg = (w: number, h: number) => file('image/jpeg', [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255])

const EDIT: PhotoEdit = {
  focus: { x: 0.5, y: 0.45 },
  card: { zoom: 1, x: 0.5, y: 0.45, adjusted: false },
  detail: { zoom: 0.8, x: 0.5, y: 0.5, adjusted: true },
  fill: '#f4ede4',
}
const PLACEHOLDER = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASo='

const photo = (over: Partial<PhotoUpload> = {}): PhotoUpload => ({
  source: webp(2400, 1800),
  card: webp(480, 480),
  detail: webp(1200, 900),
  detailSmall: webp(600, 450),
  edit: EDIT,
  placeholder: PLACEHOLDER,
  ...over,
})
const upload = (over: Partial<PhotoUpload> = {}, by = actor) => uploadPhoto(db, store, by, photo(over))
const rows = () => db.select().from(mediaAssets)

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  store = memoryStore()
})

describe('reading sizes from headers', () => {
  it('reads PNG, JPEG and WebP (VP8X, VP8 and VP8L) without decoding', () => {
    expect(imageSize(png(480, 480).data, 'image/png')).toEqual({ width: 480, height: 480 })
    expect(imageSize(jpeg(1200, 900).data, 'image/jpeg')).toEqual({ width: 1200, height: 900 })
    expect(imageSize(webp(600, 450).data, 'image/webp')).toEqual({ width: 600, height: 450 })
    const vp8 = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x58, 0x02, 0xC2, 0x01, 0, 0])
    expect(imageSize(vp8, 'image/webp')).toEqual({ width: 600, height: 450 })
    // VP8L: 14 bits of width-1, then 14 of height-1, after the 0x2F signature byte.
    const bits = (600 - 1) | ((450 - 1) << 14)
    const vp8l = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8L'), 0, 0, 0, 0, 0x2F, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0])
    expect(imageSize(vp8l, 'image/webp')).toEqual({ width: 600, height: 450 })
    expect(imageSize(new Uint8Array([0xFF, 0xD8, 0x00]), 'image/jpeg')).toBeUndefined()
  })
})

describe('uploading a photo (D158)', () => {
  it('stores the source privately and three public files, as one temporary upload', async () => {
    const result = await upload()
    const all = await rows()
    expect(all).toHaveLength(4)
    const source = all.find(r => r.id === result.id)!
    expect(source).toMatchObject({ parentId: null, state: 'temporary', width: 2400, height: 1800, placeholder: PLACEHOLDER, edit: EDIT })
    expect(source.objectKey).toMatch(new RegExp(`^t/${TEST_TENANT}/source/`))
    const files = all.filter(r => r.parentId === result.id)
    expect(files.map(f => [f.variant, f.width, f.height]).sort()).toEqual([['card', 480, 480], ['detail', 1200, 900], ['detailSmall', 600, 450]])
    for (const f of files) expect(f.objectKey).toMatch(new RegExp(`^t/${TEST_TENANT}/menu/`))
    expect(store.objects.size).toBe(4)

    const card = files.find(f => f.variant === 'card')!.objectKey
    expect(result.image).toEqual({
      card: `/media/${card}`,
      detail: `/media/${files.find(f => f.variant === 'detail')!.objectKey}`,
      detailSmall: `/media/${files.find(f => f.variant === 'detailSmall')!.objectKey}`,
      placeholder: PLACEHOLDER,
    })
    // Callers that know only one URL get the card file.
    expect((await assetUrls(db, TEST_TENANT, [result.id])).get(result.id)).toBe(`/media/${card}`)
  })

  it('refuses a file of the wrong size or missing, and stores nothing', async () => {
    await expectApiError(() => upload({ card: webp(500, 500) }), 400, 'VALIDATION_FAILED')
    await expectApiError(() => upload({ detail: undefined }), 400, 'VALIDATION_FAILED')
    await expectApiError(() => upload({ source: webp(3000, 2000) }), 400, 'VALIDATION_FAILED')
    await expectApiError(() => upload({ detailSmall: { type: 'image/webp', data: png(600, 450).data } }), 415, 'UNSUPPORTED_MEDIA')
    expect(await rows()).toEqual([])
    expect(store.objects.size).toBe(0)
  })

  it('accepts JPEG and PNG files too (a browser that can\'t write WebP), and drops a placeholder that isn\'t one', async () => {
    const result = await upload({ source: jpeg(1600, 1200), card: jpeg(480, 480), detail: png(1200, 900), placeholder: 'javascript:alert(1)' })
    expect(result.image.placeholder).toBeNull()
  })

  it('removes the objects already stored when one can\'t be', async () => {
    let puts = 0
    const flaky = { ...store, put: async (key: string, body: Uint8Array) => {
      if (++puts === 3) throw new Error('R2 unavailable')
      store.objects.set(key, body)
    } }
    await expect(uploadPhoto(db, flaky, actor, photo())).rejects.toThrow('R2 unavailable')
    expect(store.objects.size).toBe(0)
    expect(await rows()).toEqual([])
  })
})

describe('using and cleaning up a photo', () => {
  it('a menu item attaches the photo; never one of its files on its own', async () => {
    const result = await upload()
    const card = (await rows()).find(r => r.variant === 'card')!
    await expectApiError(() => attachStatements(db, TEST_TENANT, card.id), 422, 'MEDIA_NOT_AVAILABLE')
    await db.batch(await attachStatements(db, TEST_TENANT, result.id) as [never])
    expect((await rows()).find(r => r.id === result.id)!.state).toBe('attached')
  })

  it('an unused photo is purged after 24 hours with its files, rows and objects', async () => {
    const result = await upload()
    const tomorrow = new Date(Date.now() + 25 * 3_600_000)
    const report = await purgeExpiredUploads(db, store, { now: tomorrow })
    expect(report.deleted).toBe(1)
    expect(await rows()).toEqual([])
    expect(store.objects.size).toBe(0)
    expect(await imageSets(db, TEST_TENANT, [result.id])).toEqual(new Map())
  })

  it('a test data reset deletes a photo with its files', async () => {
    await upload()
    await deleteUploads(db, TEST_TENANT, store, 10)
    expect(await rows()).toEqual([])
    expect(store.objects.size).toBe(0)
  })
})

describe('editing a photo again', () => {
  it('gives the editor how it was made and the files; the source only through the admin route', async () => {
    const result = await upload()
    expect(await photoForEdit(db, TEST_TENANT, result.id)).toEqual({ id: result.id, edit: EDIT, image: result.image })
    expect((await photoSourceKey(db, TEST_TENANT, result.id)).objectKey).toMatch(/\/source\//)
  })

  it('a photo from before D158 opens with no edit, and has no private source', async () => {
    const old = await uploadImage(db, store, actor, png(800, 600) as never)
    expect(await photoForEdit(db, TEST_TENANT, old.id)).toEqual({ id: old.id, edit: null, image: { card: old.url, detail: old.url, detailSmall: null, placeholder: null } })
    await expectApiError(() => photoSourceKey(db, TEST_TENANT, old.id), 404, 'NOT_FOUND')
  })

  it('another cafe\'s photo is not found, and its files are not listed', async () => {
    const theirs = await upload({}, { ...actor, tenantId: OTHER })
    await expectApiError(() => photoForEdit(db, TEST_TENANT, theirs.id), 404, 'NOT_FOUND')
    await expectApiError(() => photoSourceKey(db, TEST_TENANT, theirs.id), 404, 'NOT_FOUND')
    expect(await imageSets(db, TEST_TENANT, [theirs.id])).toEqual(new Map())
    const card = (await db.select().from(mediaAssets).where(eq(mediaAssets.variant, 'card')))[0]!
    await expectApiError(() => photoForEdit(db, TEST_TENANT, card.id), 404, 'NOT_FOUND')
  })
})
