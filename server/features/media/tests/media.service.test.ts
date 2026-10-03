import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { mediaAssets } from '#server/features/media/media.schema'
import { attachStatements, purgeExpiredUploads, releaseStatement, uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { sniffImageType } from '#server/features/media/media.rules'
import { createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { isStaleWrite } from '#server/utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }

/** An object store in memory, that can be told to fail. */
function memoryStore() {
  const objects = new Map<string, { body: Uint8Array, contentType: string }>()
  const store = {
    objects,
    failPut: false,
    failDel: false,
    async put(key: string, body: Uint8Array, options: { contentType: string }) {
      if (store.failPut) throw new Error('R2 unavailable')
      objects.set(key, { body, contentType: options.contentType })
    },
    async del(key: string) {
      if (store.failDel) throw new Error('R2 unavailable')
      objects.delete(key)
    },
  }
  return store satisfies ObjectStore
}
let store: ReturnType<typeof memoryStore>

const bytes = (...head: number[]) => new Uint8Array([...head, ...Array.from({ length: 32 }, (_, i) => i)])
const PNG = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
const JPEG = bytes(0xFF, 0xD8, 0xFF, 0xE0)
const WEBP = new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8 '].map(c => c.charCodeAt(0)), [1, 2, 3]))

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  store = memoryStore()
})

const upload = (type: string, data: Uint8Array) => uploadImage(db, store, actor, { type, data: data as Uint8Array<ArrayBuffer> })
const rowOf = async (id: string) => (await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)))[0]

/** Moves an asset's state time back by `hours`. */
async function age(id: string, hours: number) {
  const row = await rowOf(id)
  await db.update(mediaAssets).set({ stateChangedAt: new Date(row!.stateChangedAt.getTime() - hours * 3_600_000) }).where(eq(mediaAssets.id, id))
}

describe('uploading', () => {
  it('stores a PNG under a server-chosen key, records it as temporary, and audits it', async () => {
    const asset = await upload('image/png', PNG)
    expect(asset).toMatchObject({ mimeType: 'image/png', byteSize: PNG.length, url: expect.stringMatching(/^\/media\/t\/tenant-1\/menu\/[0-9a-f-]{36}\.png$/) })
    const key = asset.url.replace('/media/', '')
    expect(store.objects.get(key)).toMatchObject({ contentType: 'image/png' })
    expect(await rowOf(asset.id)).toMatchObject({ state: 'temporary', uploadedBy: 'admin-1', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, asset.id))
    expect(audit).toMatchObject({ action: 'media.asset.upload', actorId: 'admin-1', requestId: 'req-1' })
  })

  it('knows JPEG and WebP by their bytes', async () => {
    await expect(upload('image/jpeg', JPEG)).resolves.toMatchObject({ mimeType: 'image/jpeg' })
    await expect(upload('image/webp', WEBP)).resolves.toMatchObject({ mimeType: 'image/webp' })
  })

  it('refuses a file whose bytes aren\'t the image it claims to be, and stores nothing', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    await expectApiError(() => upload('image/png', svg), 415, 'UNSUPPORTED_MEDIA')
    await expectApiError(() => upload('image/svg+xml', svg), 415, 'UNSUPPORTED_MEDIA')
    await expectApiError(() => upload('image/jpeg', PNG), 415, 'UNSUPPORTED_MEDIA')
    await expectApiError(() => upload('text/html', PNG), 415, 'UNSUPPORTED_MEDIA')
    expect(store.objects.size).toBe(0)
    expect(await db.select().from(mediaAssets)).toEqual([])
  })

  it('refuses an empty file, a missing one, and one over 5 MB', async () => {
    await expectApiError(() => upload('image/png', new Uint8Array()), 400, 'VALIDATION_FAILED')
    await expectApiError(() => uploadImage(db, store, actor, undefined), 400, 'VALIDATION_FAILED')
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1)
    big.set(PNG)
    await expectApiError(() => upload('image/png', big), 413, 'PAYLOAD_TOO_LARGE')
    expect(store.objects.size).toBe(0)
  })

  it('removes the object again when the row can\'t be written', async () => {
    const broken = new Proxy(db, {
      get: (target, key, receiver) => key === 'batch' ? async () => { throw new Error('D1 unavailable') } : Reflect.get(target, key, receiver),
    })
    await expect(uploadImage(broken, store, actor, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })).rejects.toThrow('D1 unavailable')
    expect(store.objects.size).toBe(0)
  })

  it('writes no row when the object can\'t be stored', async () => {
    store.failPut = true
    await expect(upload('image/png', PNG)).rejects.toThrow('R2 unavailable')
    expect(await db.select().from(mediaAssets)).toEqual([])
  })
})

describe('attaching and releasing', () => {
  it('attaches a temporary upload in the caller\'s batch, once', async () => {
    const asset = await upload('image/png', PNG)
    await db.batch(await attachStatements(db, TEST_TENANT, asset.id) as never)
    expect(await rowOf(asset.id)).toMatchObject({ state: 'attached' })
    // Already used by a record: not available to a second one.
    await expectApiError(() => attachStatements(db, TEST_TENANT, asset.id), 422, 'MEDIA_NOT_AVAILABLE')
  })

  it('lets only one of two records that checked at the same time attach the upload', async () => {
    const asset = await upload('image/png', PNG)
    // Both pass the check before either writes.
    const first = await attachStatements(db, TEST_TENANT, asset.id)
    const second = await attachStatements(db, TEST_TENANT, asset.id)
    await db.batch(first as never)
    const error = await db.batch(second as never).catch(e => e)
    expect(isStaleWrite(error)).toBe(true)
  })

  it('refuses an unknown upload, naming the caller\'s field', async () => {
    const error = await attachStatements(db, TEST_TENANT, '01a0e2a0-0000-7000-8000-000000000000', 'image').catch(e => e)
    expect(error).toMatchObject({ statusCode: 422, data: { code: 'MEDIA_NOT_AVAILABLE', fieldErrors: { image: expect.any(Array) } } })
  })

  it('fails the caller\'s batch when the upload is cleaned up between the check and the write', async () => {
    const asset = await upload('image/png', PNG)
    const statements = await attachStatements(db, TEST_TENANT, asset.id)
    await age(asset.id, 25)
    await purgeExpiredUploads(db, store)
    const error = await db.batch(statements as never).catch(e => e)
    expect(isStaleWrite(error)).toBe(true)
  })

  it('releasing makes it temporary again, and its 24 hours start then', async () => {
    const asset = await upload('image/png', PNG)
    await db.batch(await attachStatements(db, TEST_TENANT, asset.id) as never)
    await age(asset.id, 48)
    await db.batch([releaseStatement(db, TEST_TENANT, asset.id)])
    expect(await rowOf(asset.id)).toMatchObject({ state: 'temporary' })
    expect(await purgeExpiredUploads(db, store)).toMatchObject({ deleted: 0 })
  })
})

describe('purging', () => {
  it('deletes uploads unused for 24 hours, row and object; keeps newer and attached ones', async () => {
    const old = await upload('image/png', PNG)
    const fresh = await upload('image/png', PNG)
    const used = await upload('image/png', PNG)
    await db.batch(await attachStatements(db, TEST_TENANT, used.id) as never)
    await age(old.id, 25)
    await age(fresh.id, 23)
    await age(used.id, 72)

    expect(await purgeExpiredUploads(db, store)).toEqual({ deleted: 1, kept: 0, objectErrors: [] })
    expect(await rowOf(old.id)).toBeUndefined()
    expect(store.objects.has(old.url.replace('/media/', ''))).toBe(false)
    expect(await rowOf(fresh.id)).toBeDefined()
    expect(await rowOf(used.id)).toBeDefined()
    expect(store.objects.size).toBe(2)
    // Running again changes nothing.
    expect(await purgeExpiredUploads(db, store)).toEqual({ deleted: 0, kept: 0, objectErrors: [] })
  })

  it('keeps an upload attached between being found and being deleted', async () => {
    const asset = await upload('image/png', PNG)
    await age(asset.id, 25)
    // The purge finds it; then a record attaches it, just before the purge's delete runs.
    let attachedMeanwhile = false
    const racing = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== 'delete' || attachedMeanwhile) return Reflect.get(target, key, receiver)
        attachedMeanwhile = true
        return (table: typeof mediaAssets) => ({
          where: (condition: never) => ({
            returning: async (fields: never) => {
              await target.batch(await attachStatements(target, TEST_TENANT, asset.id) as never)
              return target.delete(table).where(condition).returning(fields)
            },
          }),
        })
      },
    })
    expect(await purgeExpiredUploads(racing, store)).toEqual({ deleted: 0, kept: 1, objectErrors: [] })
    expect(attachedMeanwhile).toBe(true)
    expect(await rowOf(asset.id)).toMatchObject({ state: 'attached' })
    expect(store.objects.size).toBe(1)
  })

  it('reports an object it couldn\'t remove, after deleting the row', async () => {
    const asset = await upload('image/png', PNG)
    await age(asset.id, 25)
    store.failDel = true
    const report = await purgeExpiredUploads(db, store)
    expect(report).toMatchObject({ deleted: 1, objectErrors: [{ objectKey: asset.url.replace('/media/', ''), error: expect.stringContaining('R2 unavailable') }] })
    expect(await rowOf(asset.id)).toBeUndefined()
  })
})

describe('sniffing', () => {
  it('recognizes only JPEG, PNG and WebP', () => {
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(WEBP)).toBe('image/webp')
    expect(sniffImageType(new TextEncoder().encode('GIF89a..........'))).toBeUndefined()
    expect(sniffImageType(new TextEncoder().encode('RIFF....WAVEfmt '))).toBeUndefined()
  })
})
