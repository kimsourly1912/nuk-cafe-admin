import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { user } from '#server/db/tables'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_IMPORT_RETENTION_MS } from '#shared/contracts/assistant-import'
import { discardImportSource, getImportSource, listImportSources, purgeImportSources, readImportSource, uploadImportSource } from '#server/features/assistant'
import type { ImportObjectStore } from '#server/features/assistant'
import { assistantImportObjects, assistantImports } from '#server/features/assistant/assistant.schema'
import * as repo from '#server/features/assistant/assistant-import.repository'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1])
const WEBP = new TextEncoder().encode('RIFF1234WEBPexample')
const PDF = new TextEncoder().encode('%PDF-1.7\nfixture')
const notFound = { statusCode: 404, data: { code: 'NOT_FOUND' } }

function memoryStore() {
  const objects = new Map<string, Blob>()
  const store = {
    driver: { name: 'fs' }, objects, failPut: false, failDel: false,
    put: vi.fn(async (key: string, bytes: Uint8Array<ArrayBuffer>, options: { contentType: string }) => {
      objects.set(key, new Blob([bytes], { type: options.contentType }))
      if (store.failPut) throw new Error('R2 put failed after accepting bytes')
    }),
    get: vi.fn(async (key: string) => objects.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      if (store.failDel) throw new Error('R2 unavailable')
      objects.delete(key)
    }),
  }
  return store satisfies ImportObjectStore
}

let db: Db
let actor: Actor
let store: ReturnType<typeof memoryStore>
const upload = (type = 'image/png', data = PNG, fileName = 'private-menu.png') => uploadImportSource(db, store, actor, { type, data, fileName })
const records = () => db.select().from(assistantImports)
const ledger = () => db.select().from(assistantImportObjects)

beforeEach(async () => {
  db = await createTestDb()
  const admin = await createAdmin(db)
  actor = { userId: admin.userId, tenantId: TEST_TENANT, role: 'owner' }
  store = memoryStore()
})
afterEach(() => vi.restoreAllMocks())

describe('private source admission and accounting', () => {
  it.each([
    ['image/png', PNG, 'png'], ['image/jpeg', JPEG, 'jpg'], ['image/webp', WEBP, 'webp'], ['application/pdf', PDF, 'pdf'],
  ] as const)('stores %s with a server key and fixed 24-hour expiry', async (type, data, ext) => {
    const source = await upload(type, data, `menu.${ext}`)
    const [row] = await records()
    expect(row!.objectKey).toBe(`t/${actor.tenantId}/assistant-import/${source.id}.${ext}`)
    expect(source).not.toHaveProperty('objectKey')
    expect(source).not.toHaveProperty('url')
    expect(Date.parse(source.expiresAt) - Date.parse(source.createdAt)).toBe(ASSISTANT_IMPORT_RETENTION_MS)
    expect(await getImportSource(db, actor, source.id)).toEqual(source)
    expect(await listImportSources(db, actor)).toEqual([source])
    expect(await (await readImportSource(db, store, actor, source.id)).data.arrayBuffer()).toEqual(data.buffer)
    const events = await db.select().from(auditEvents)
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(`menu.${ext}`)
    expect(events[0]!.metadata).toEqual({ mimeType: type, byteSize: data.length })
  })

  it.each([
    ['image/png', JPEG, 'menu.png', 415], ['application/pdf', PNG, 'menu.pdf', 415],
    ['image/svg+xml', new TextEncoder().encode('<svg/>'), 'menu.svg', 415],
    ['image/png', new Uint8Array(), 'menu.png', 400],
    ['image/png', PNG, '../private.png', 400], ['image/png', PNG, 'menu\n.png', 400],
  ] as const)('refuses invalid source admission (%s, %s, %s)', async (type, data, name, statusCode) => {
    await expect(upload(type, data, name)).rejects.toMatchObject({ statusCode })
    expect(store.put).not.toHaveBeenCalled()
    expect(await records()).toEqual([])
    expect(await ledger()).toEqual([])
  })

  it('refuses oversized source bytes before any storage write', async () => {
    await expect(upload('image/png', new Uint8Array(ASSISTANT_IMPORT_MAX_BYTES + 1))).rejects.toMatchObject({ statusCode: 413 })
    expect(store.put).not.toHaveBeenCalled()
  })

  it('refuses public or unsupported storage drivers before writing', async () => {
    for (const name of ['vercel-blob', 's3']) {
      store.driver.name = name
      await expect(upload()).rejects.toMatchObject({ statusCode: 500, data: { code: 'AI_IMPORT_NOT_CONFIGURED' } })
    }
    expect(store.put).not.toHaveBeenCalled()
  })

  it('atomically bounds active sources per owner/cafe, including racing uploads', async () => {
    for (let i = 0; i < 4; i++) await upload()
    const results = await Promise.allSettled([upload(), upload(), upload()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 429, data: { code: 'AI_IMPORT_SOURCE_LIMIT' } })
    expect(await records()).toHaveLength(5)
    expect(await ledger()).toHaveLength(5)
    expect(store.put).toHaveBeenCalledTimes(5)
    expect(await db.select().from(auditEvents)).toHaveLength(5)
    // Limits are not shared between cafes or owners.
    await ensureTenant(db, 'another-cafe')
    await uploadImportSource(db, store, { ...actor, tenantId: 'another-cafe' }, { type: 'image/png', data: PNG, fileName: 'menu.png' })
  })
})

describe('source access and discard', () => {
  it('another cafe is 404 even when the same owner made the upload', async () => {
    const source = await upload()
    await ensureTenant(db, 'another-cafe')
    const other = { ...actor, tenantId: 'another-cafe' }
    await expect(getImportSource(db, other, source.id)).rejects.toMatchObject(notFound)
    await expect(readImportSource(db, store, other, source.id)).rejects.toMatchObject(notFound)
    await expect(discardImportSource(db, store, other, source.id, source.version)).rejects.toMatchObject(notFound)
    expect(await listImportSources(db, other)).toEqual([])
    expect(store.get).not.toHaveBeenCalled()
    expect(store.del).not.toHaveBeenCalled()
  })

  it('another owner of the same cafe cannot read or discard this private source', async () => {
    const source = await upload()
    const second = await createAdmin(db)
    const other = { ...actor, userId: second.userId }
    await expect(getImportSource(db, other, source.id)).rejects.toMatchObject(notFound)
    await expect(readImportSource(db, store, other, source.id)).rejects.toMatchObject(notFound)
    await expect(discardImportSource(db, store, other, source.id, 1)).rejects.toMatchObject(notFound)
    expect(await listImportSources(db, other)).toEqual([])
  })

  it('expiry hides reads/listing immediately, without waiting for physical cleanup', async () => {
    const source = await upload()
    await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, source.id))
    expect(await listImportSources(db, actor)).toEqual([])
    await expect(getImportSource(db, actor, source.id)).rejects.toMatchObject(notFound)
    await expect(readImportSource(db, store, actor, source.id)).rejects.toMatchObject(notFound)
    expect(store.objects.size).toBe(1)
  })

  it('checks access again after a storage read races with discard', async () => {
    const source = await upload()
    const data = [...store.objects.values()][0]!
    store.get.mockImplementationOnce(async () => {
      await discardImportSource(db, store, actor, source.id, 1)
      return data
    })
    await expect(readImportSource(db, store, actor, source.id)).rejects.toMatchObject(notFound)
  })

  it('a stale version cannot delete source bytes or commit its discard audit', async () => {
    const source = await upload()
    await expect(discardImportSource(db, store, actor, source.id, 2)).rejects.toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
    expect(await getImportSource(db, actor, source.id)).toEqual(source)
    expect(store.del).not.toHaveBeenCalled()
    expect(await db.select().from(auditEvents)).toHaveLength(1)
  })

  it('discards immediately and leaves no source, object or cleanup record on success', async () => {
    const source = await upload()
    expect(await discardImportSource(db, store, actor, source.id, 1)).toEqual({ cleanupPending: false })
    expect(await records()).toEqual([])
    expect(await ledger()).toEqual([])
    expect(store.objects.size).toBe(0)
    await expect(getImportSource(db, actor, source.id)).rejects.toMatchObject(notFound)
    expect(await db.select().from(auditEvents)).toHaveLength(2)
  })
})

describe('durable storage cleanup', () => {
  it('caps a cleanup invocation at ten objects even when a caller asks for more', async () => {
    for (let group = 0; group < 3; group++) {
      const admin = await createAdmin(db)
      for (let i = 0; i < 4; i++) await uploadImportSource(db, store, { ...actor, userId: admin.userId }, { type: 'image/png', data: PNG, fileName: 'menu.png' })
    }
    const now = new Date(Date.now() + ASSISTANT_IMPORT_RETENTION_MS + 1000)
    expect(await purgeImportSources(db, store, { now, limit: 1000 })).toEqual({ deleted: 10, pending: 0 })
    expect(await ledger()).toHaveLength(2)
    expect(store.objects.size).toBe(2)
    expect(await purgeImportSources(db, store, { now })).toEqual({ deleted: 2, pending: 0 })
  })

  it('a failed discard revokes access but retains the object ledger until deletion succeeds', async () => {
    const source = await upload()
    store.failDel = true
    expect(await discardImportSource(db, store, actor, source.id, 1)).toEqual({ cleanupPending: true })
    expect(await records()).toEqual([])
    expect(await ledger()).toHaveLength(1)
    expect(await purgeImportSources(db, store)).toEqual({ deleted: 0, pending: 1 })
    expect(await ledger()).toHaveLength(1)
    store.failDel = false
    expect(await purgeImportSources(db, store)).toEqual({ deleted: 1, pending: 0 })
    expect(await ledger()).toEqual([])
    expect(store.objects.size).toBe(0)
    expect(await purgeImportSources(db, store)).toEqual({ deleted: 0, pending: 0 })
  })

  it('purges at the fixed expiry, keeps a fresh source and retries expired-object failures', async () => {
    const source = await upload()
    const now = new Date(source.expiresAt)
    expect(await purgeImportSources(db, store, { now: new Date(now.getTime() - 1) })).toEqual({ deleted: 0, pending: 0 })
    store.failDel = true
    expect(await purgeImportSources(db, store, { now })).toEqual({ deleted: 0, pending: 1 })
    expect(await records()).toEqual([])
    store.failDel = false
    expect(await purgeImportSources(db, store, { now })).toEqual({ deleted: 1, pending: 0 })
  })

  it.each(['user', 'tenant content'])('erasure (%s) retains cleanup metadata until bytes are deleted', async (kind) => {
    const source = await upload()
    if (kind === 'user') await db.delete(user).where(eq(user.id, actor.userId))
    else {
      // Tenant FKs are RESTRICT: tenant erasure removes its content before the organization.
      await db.delete(assistantImports).where(eq(assistantImports.tenantId, actor.tenantId))
    }
    expect(await records()).toEqual([])
    expect(await ledger()).toHaveLength(1)
    expect(await purgeImportSources(db, store, { now: new Date(Date.parse(source.createdAt) + 10 * 60 * 1000) })).toEqual({ deleted: 1, pending: 0 })
    expect(store.objects.size).toBe(0)
    expect(await ledger()).toEqual([])
  })

  it('failed storage puts, including accepted bytes, compensate metadata and queue retries', async () => {
    store.failPut = true
    store.failDel = true
    await expect(upload()).rejects.toThrow('R2 put failed')
    expect(await records()).toEqual([])
    expect(await ledger()).toHaveLength(1)
    expect(store.objects.size).toBe(1)
    store.failDel = false
    expect(await purgeImportSources(db, store)).toEqual({ deleted: 1, pending: 0 })
  })

  it('finalization failure removes accepted bytes and the failed source reservation', async () => {
    vi.spyOn(repo, 'finishUpload').mockRejectedValueOnce(new Error('D1 finalization failed'))
    await expect(upload()).rejects.toThrow('D1 finalization failed')
    expect(await records()).toEqual([])
    expect(await ledger()).toEqual([])
    expect(store.objects.size).toBe(0)
  })

  it('a crashed upload remains hidden and expires; it is not treated as usable source data', async () => {
    const source = await upload()
    await db.update(assistantImports).set({ state: 'uploading' }).where(eq(assistantImports.id, source.id))
    expect(await listImportSources(db, actor)).toEqual([])
    expect(await purgeImportSources(db, store, { now: new Date(Date.parse(source.createdAt) + 11 * 60 * 1000) })).toEqual({ deleted: 0, pending: 0 })
    expect(await purgeImportSources(db, store, { now: new Date(source.expiresAt) })).toEqual({ deleted: 1, pending: 0 })
  })
})
