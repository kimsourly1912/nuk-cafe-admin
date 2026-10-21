import type { ImageType, MediaAsset, MenuImage, PhotoEdit, PhotoForEdit, PhotoVariant, UploadedPhoto } from '#shared/contracts/media'
import { IMAGE_MAX_BYTES, PHOTO_PLACEHOLDER_MAX_LENGTH, PHOTO_SIZES, PHOTO_SOURCE_MAX_EDGE } from '#shared/contracts/media'
import type { Db, Statement } from '#server/utils/batch'
import { requireOneChange, tryGuardedBatch } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { imageTooLarge, mediaNotAvailable, noFile, photoNotFound, photoRefused, unsupportedImage } from './media.errors'
import * as repo from './media.repository'
import * as objectRepo from './media.objects.repository'
import { imageSize, isImageType, isPlaceholder, mediaUrl, objectKeyFor, sha256Hex, sniffImageType, sourceKeyFor, TEMPORARY_TTL_MS } from './media.rules'

/**
 * Uploads and their lifecycle (docs/server/security.md → Uploads, D57). The object store is passed
 * in (NuxtHub's `blob` in routes and tasks, an in-memory one in tests), so this runs without Nitro.
 */
export interface ObjectStore {
  put: (key: string, body: Uint8Array<ArrayBuffer>, options: { contentType: string }) => Promise<unknown>
  del: (key: string) => Promise<unknown>
}

export interface UploadedFile {
  /** The type the browser claimed; must match the bytes. */
  type: string
  data: Uint8Array<ArrayBuffer>
}

const toAsset = (row: { id: string, objectKey: string, mimeType: string, byteSize: number }): MediaAsset =>
  ({ id: row.id, url: mediaUrl(row.objectKey), mimeType: row.mimeType as ImageType, byteSize: row.byteSize })

/** The checks, before anything is stored: size, then the type from the bytes and the claim. */
export function checkImage(file: UploadedFile | undefined): ImageType {
  if (!file || file.data.length === 0) throw noFile()
  if (file.data.length > IMAGE_MAX_BYTES) throw imageTooLarge()
  const sniffed = sniffImageType(file.data.subarray(0, 16))
  if (!sniffed || !isImageType(file.type) || file.type !== sniffed) throw unsupportedImage()
  return sniffed
}

/**
 * Stores an image in R2 and records it as a temporary asset, with an audit row. If the record
 * can't be written, the object is removed again, so no object is left without a row.
 */
export async function uploadImage(db: Db, store: ObjectStore, actor: Actor, file: UploadedFile | undefined): Promise<MediaAsset> {
  const mimeType = checkImage(file)
  const data = file!.data
  const id = newId()
  const objectKey = objectKeyFor(actor.tenantId, mimeType)
  const row = { id, tenantId: actor.tenantId, objectKey, mimeType, byteSize: data.length, sha256: await sha256Hex(data), uploadedBy: actor.userId, now: new Date() }

  await planObjects(db, actor.tenantId, [objectKey], new Date(Date.now() + TEMPORARY_TTL_MS))
  try {
    await store.put(objectKey, data, { contentType: mimeType })
    await db.batch([
      repo.insertAssetStatement(db, row),
      ...objectRepo.deleteObjectPlansStatements(db, actor.tenantId, [objectKey]),
      auditStatement(db, actor, { action: 'media.asset.upload', targetType: 'media_asset', targetId: id, metadata: { mimeType, byteSize: data.length } }),
    ])
  }
  catch (error) {
    await removeObject(db, store, actor.tenantId, objectKey).catch(() => {})
    throw error
  }
  return toAsset(row)
}

/**
 * For a feature that references an upload (a menu item's image): checks it can be used now
 * (the tenant's, exists and temporary) and returns the statements that attach it **in that feature's batch**,
 * including the guard for an asset cleaned up or attached elsewhere in between. Map a stale batch
 * to `mediaNotAvailable(field)`.
 */
export async function attachStatements(db: Db, tenantId: string, assetId: string, field = 'imageId'): Promise<Statement[]> {
  const asset = await repo.findAsset(db, tenantId, assetId)
  // A photo's file (D158) is never used on its own: the photo is.
  if (asset?.state !== 'temporary' || asset.parentId) throw mediaNotAvailable(field)
  return [repo.attachStatement(db, tenantId, assetId, new Date()), requireOneChange(db)]
}

/** The statement that releases an upload a record no longer uses; its 24 hours start now. */
export function releaseStatement(db: Db, tenantId: string, assetId: string): Statement {
  return repo.releaseStatement(db, tenantId, assetId, new Date())
}

export async function getAsset(db: Db, tenantId: string, id: string): Promise<MediaAsset | undefined> {
  const row = await repo.findAsset(db, tenantId, id)
  return row && toAsset(row)
}

/**
 * How the menu shows each of these uploads that exists, by id (D158): a menu photo's files and
 * placeholder; a single image (a photo from before D158, a logo) as every file. One two-query batch per ID piece.
 */
export async function imageSets(db: Db, tenantId: string, ids: string[]): Promise<Map<string, MenuImage>> {
  const { assets: rows, variants } = await repo.imageRows(db, tenantId, [...new Set(ids)])
  const filesOf = new Map<string, Partial<Record<PhotoVariant, string>>>()
  for (const v of variants) filesOf.set(v.parentId, { ...filesOf.get(v.parentId), [v.variant]: mediaUrl(v.objectKey) })
  return new Map(rows.map((row) => {
    const files = filesOf.get(row.id)
    if (files?.card && files.detail) return [row.id, { card: files.card, detail: files.detail, detailSmall: files.detailSmall ?? null, placeholder: row.placeholder }]
    const url = mediaUrl(row.objectKey)
    return [row.id, { card: url, detail: url, detailSmall: null, placeholder: null }]
  }))
}

/** The public URL of each of these uploads that exists, by id (a photo's card file, D158). */
export async function assetUrls(db: Db, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const sets = await imageSets(db, tenantId, ids)
  return new Map([...sets].map(([id, set]) => [id, set.card]))
}

// --- Menu photos (D158) ---

export interface PhotoUpload {
  source?: UploadedFile
  card?: UploadedFile
  detail?: UploadedFile
  detailSmall?: UploadedFile
  edit: PhotoEdit
  placeholder?: string
}

/** One of the photo's files: an image of the size the editor makes (the source: at most 2400 px). */
function checkPhotoFile(file: UploadedFile | undefined, name: string, size?: { width: number, height: number }) {
  if (!file) throw photoRefused(name, 'Missing')
  const type = checkImage(file)
  const actual = imageSize(file.data, type)
  if (!actual || actual.width < 1 || actual.height < 1) throw photoRefused(name, 'Not a readable image')
  if (size ? actual.width !== size.width || actual.height !== size.height : Math.max(actual.width, actual.height) > PHOTO_SOURCE_MAX_EDGE) {
    throw photoRefused(name, size ? `Must be ${size.width} × ${size.height}` : `At most ${PHOTO_SOURCE_MAX_EDGE} px`)
  }
  return { type, data: file.data, ...actual }
}

/**
 * A menu photo from the editor (D158): the private source, the files made from it and how they
 * were made. Stored as one temporary upload (the source) with its files: a menu item attaches it
 * like any image, and it's purged with its files after 24 hours unused. Every size is checked from
 * the headers; the objects are removed again if the rows can't be written.
 */
export async function uploadPhoto(db: Db, store: ObjectStore, actor: Actor, upload: PhotoUpload): Promise<UploadedPhoto> {
  const source = checkPhotoFile(upload.source, 'source')
  const files = (['card', 'detail', 'detailSmall'] as const).map(variant => ({ variant, ...checkPhotoFile(upload[variant], variant, PHOTO_SIZES[variant]) }))
  const placeholder = upload.placeholder && upload.placeholder.length <= PHOTO_PLACEHOLDER_MAX_LENGTH && isPlaceholder(upload.placeholder) ? upload.placeholder : undefined
  const now = new Date()
  const id = newId()
  const sourceKey = sourceKeyFor(actor.tenantId, source.type)
  const rows: repo.NewAsset[] = [
    { id, tenantId: actor.tenantId, objectKey: sourceKey, mimeType: source.type, byteSize: source.data.length, sha256: await sha256Hex(source.data), uploadedBy: actor.userId, now, width: source.width, height: source.height, placeholder, edit: upload.edit },
  ]
  for (const file of files) {
    rows.push({ id: newId(), tenantId: actor.tenantId, objectKey: objectKeyFor(actor.tenantId, file.type), mimeType: file.type, byteSize: file.data.length, sha256: await sha256Hex(file.data), uploadedBy: actor.userId, now, parentId: id, variant: file.variant, width: file.width, height: file.height })
  }
  const stored: string[] = []
  const removeStored = () => Promise.all(stored.map(key => removeObject(db, store, actor.tenantId, key).catch(() => {})))
  await planObjects(db, actor.tenantId, rows.map(row => row.objectKey), new Date(now.getTime() + TEMPORARY_TTL_MS))
  try {
    for (const [i, row] of rows.entries()) {
      const data = i === 0 ? source.data : files[i - 1]!.data
      await store.put(row.objectKey, data, { contentType: row.mimeType })
      stored.push(row.objectKey)
    }
    const [first, ...rest] = rows.map(row => repo.insertAssetStatement(db, row))
    await db.batch([
      first!,
      ...rest,
      ...objectRepo.deleteObjectPlansStatements(db, actor.tenantId, rows.map(row => row.objectKey)),
      auditStatement(db, actor, { action: 'media.photo.upload', targetType: 'media_asset', targetId: id, metadata: { width: source.width, height: source.height } }),
    ])
  }
  catch (error) {
    await removeStored()
    throw error
  }
  const image = (await imageSets(db, actor.tenantId, [id])).get(id)!
  return { id, image }
}

/** What the editor needs to open a photo again: how it was made (`null` before D158) and its files. */
export async function photoForEdit(db: Db, tenantId: string, id: string): Promise<PhotoForEdit> {
  const row = await repo.findAsset(db, tenantId, id)
  if (!row || row.parentId) throw photoNotFound()
  const image = (await imageSets(db, tenantId, [id])).get(id)!
  return { id, edit: row.edit, image }
}

/** The private source's object key, for the admin route that streams it; only a menu photo has one. */
export async function photoSourceKey(db: Db, tenantId: string, id: string): Promise<{ objectKey: string, mimeType: string }> {
  const row = await repo.findAsset(db, tenantId, id)
  if (!row || row.parentId || !row.edit) throw photoNotFound()
  return { objectKey: row.objectKey, mimeType: row.mimeType }
}

export interface PurgeReport {
  deleted: number
  /** Attached or released again after being found: kept. */
  kept: number
  /** Rows deleted whose object couldn't be removed (left in R2; logged by the task). */
  objectErrors: { objectKey: string, error: string }[]
}

/**
 * `media:purge-temporary`: deletes temporary assets whose state is older than 24 hours, every
 * tenant's (a platform task: the row says whose it is). The row goes
 * first, with a conditional delete (an attach in between keeps it), then the object. So a
 * record never points at a missing object; at worst an object outlives its row. Safe to run twice.
 */
export async function purgeExpiredUploads(db: Db, store: ObjectStore, options: { now?: Date, limit?: number } = {}): Promise<PurgeReport> {
  const now = options.now ?? new Date()
  const before = new Date(now.getTime() - TEMPORARY_TTL_MS)
  const report: PurgeReport = { deleted: 0, kept: 0, objectErrors: [] }
  for (const pending of await objectRepo.dueObjectDeletions(db, now, options.limit ?? 100)) {
    try {
      await removeObject(db, store, pending.tenantId, pending.objectKey)
    }
    catch (error) {
      report.objectErrors.push({ objectKey: pending.objectKey, error: String(error) })
      await db.batch([objectRepo.retryObjectDeletionStatement(db, pending.tenantId, pending.objectKey, new Date(now.getTime() + 60_000))])
    }
  }
  for (const asset of await repo.dueExpiredTemporary(db, before, options.limit ?? 100)) {
    // A menu photo's files go with it (D158): their rows by the foreign key, their objects here.
    const files = await repo.variantKeysOf(db, asset.tenantId, asset.id)
    if (!await tryGuardedBatch(db, [repo.queueExpiredAssetObjectsStatement(db, asset.tenantId, asset.id, before), repo.deleteExpiredAssetStatement(db, asset.tenantId, asset.id, before), requireOneChange(db)])) {
      report.kept++
      continue
    }
    report.deleted++
    for (const objectKey of [asset.objectKey, ...files]) {
      try {
        await removeObject(db, store, asset.tenantId, objectKey)
      }
      catch (error) {
        report.objectErrors.push({ objectKey, error: String(error) })
      }
    }
  }
  return report
}

/** How many uploads the tenant has (the sample-data reset's confirmation, D94). */
export async function countUploads(db: Db, tenantId: string): Promise<number> {
  return repo.countAssets(db, tenantId)
}

/**
 * Deletes up to `limit` of the tenant's uploads, row and object, oldest first: test data resets only (the sample-data
 * feature, D94), after the records that used them are gone. Call again until none are left (a
 * Worker request may only make so many queries). Row first, like the purge: a missing object is
 * harmless, an object without a row would never be cleaned up.
 */
export async function deleteUploads(db: Db, tenantId: string, store: ObjectStore, limit: number): Promise<PurgeReport> {
  const report: PurgeReport = { deleted: 0, kept: 0, objectErrors: [] }
  for (const asset of await repo.listFirstAssets(db, tenantId, limit)) {
    const files = await repo.variantKeysOf(db, asset.tenantId, asset.id)
    await db.batch([objectRepo.queueAssetObjectsStatement(db, tenantId, asset.id), ...repo.deleteAssetStatements(db, tenantId, asset.id)])
    report.deleted++
    for (const objectKey of [asset.objectKey, ...files]) {
      try {
        await removeObject(db, store, asset.tenantId, objectKey)
      }
      catch (error) {
        report.objectErrors.push({ objectKey, error: String(error) })
      }
    }
  }
  return report
}

/** Clear the durable reference only after R2 confirms deletion (missing objects are harmless). */
async function removeObject(db: Db, store: ObjectStore, tenantId: string, key: string) {
  await store.del(key)
  await db.batch([objectRepo.deleteObjectStatement(db, tenantId, key)])
}

/** Provisional deletion records commit together before any object is uploaded. */
async function planObjects(db: Db, tenantId: string, keys: string[], after: Date): Promise<void> {
  const [first, ...rest] = objectRepo.insertObjectPlansStatements(db, tenantId, keys, after)
  if (first) await db.batch([first, ...rest])
}
