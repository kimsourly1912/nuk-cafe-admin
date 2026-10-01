import type { ImageType, MediaAsset } from '#shared/contracts/media'
import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import type { Db, Statement } from '#server/utils/batch'
import { requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { imageTooLarge, mediaNotAvailable, noFile, unsupportedImage } from './media.errors'
import * as repo from './media.repository'
import { isImageType, mediaUrl, objectKeyFor, sha256Hex, sniffImageType, TEMPORARY_TTL_MS } from './media.rules'

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
  const objectKey = objectKeyFor(mimeType)
  const row = { id, objectKey, mimeType, byteSize: data.length, sha256: await sha256Hex(data), uploadedBy: actor.userId, now: new Date() }

  await store.put(objectKey, data, { contentType: mimeType })
  try {
    await db.batch([
      repo.insertAssetStatement(db, row),
      auditStatement(db, actor, { action: 'media.asset.upload', targetType: 'media_asset', targetId: id, metadata: { mimeType, byteSize: data.length } }),
    ])
  }
  catch (error) {
    await store.del(objectKey).catch(() => {})
    throw error
  }
  return toAsset(row)
}

/**
 * For a feature that references an upload (a menu item's image): checks it can be used now
 * (exists and temporary) and returns the statements that attach it **in that feature's batch**,
 * including the guard for an asset cleaned up or attached elsewhere in between. Map a stale batch
 * to `mediaNotAvailable(field)`.
 */
export async function attachStatements(db: Db, assetId: string, field = 'imageId'): Promise<Statement[]> {
  const asset = await repo.findAsset(db, assetId)
  if (asset?.state !== 'temporary') throw mediaNotAvailable(field)
  return [repo.attachStatement(db, assetId, new Date()), requireOneChange(db)]
}

/** The statement that releases an upload a record no longer uses; its 24 hours start now. */
export function releaseStatement(db: Db, assetId: string): Statement {
  return repo.releaseStatement(db, assetId, new Date())
}

export async function getAsset(db: Db, id: string): Promise<MediaAsset | undefined> {
  const row = await repo.findAsset(db, id)
  return row && toAsset(row)
}

/** The public URL of each of these assets that exists, by id (for lists of records with images). */
export async function assetUrls(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await repo.findAssets(db, [...new Set(ids)])
  return new Map(rows.map(row => [row.id, mediaUrl(row.objectKey)]))
}

export interface PurgeReport {
  deleted: number
  /** Attached or released again after being found: kept. */
  kept: number
  /** Rows deleted whose object couldn't be removed (left in R2; logged by the task). */
  objectErrors: { objectKey: string, error: string }[]
}

/**
 * `media:purge-temporary`: deletes temporary assets whose state is older than 24 hours. The row goes
 * first, with a conditional delete (an attach in between keeps it), then the object. So a
 * record never points at a missing object; at worst an object outlives its row. Safe to run twice.
 */
export async function purgeExpiredUploads(db: Db, store: ObjectStore, options: { now?: Date, limit?: number } = {}): Promise<PurgeReport> {
  const before = new Date((options.now ?? new Date()).getTime() - TEMPORARY_TTL_MS)
  const report: PurgeReport = { deleted: 0, kept: 0, objectErrors: [] }
  for (const asset of await repo.findExpiredTemporary(db, before, options.limit ?? 100)) {
    if (!await repo.deleteIfStillExpired(db, asset.id, before)) {
      report.kept++
      continue
    }
    report.deleted++
    try {
      await store.del(asset.objectKey)
    }
    catch (error) {
      report.objectErrors.push({ objectKey: asset.objectKey, error: String(error) })
    }
  }
  return report
}

/** How many uploads exist (the sample-data reset's confirmation, D94). */
export async function countUploads(db: Db): Promise<number> {
  return repo.countAssets(db)
}

/**
 * Deletes up to `limit` uploads, row and object, oldest first: test data resets only (the sample-data
 * feature, D94), after the records that used them are gone. Call again until none are left (a
 * Worker request may only make so many queries). Row first, like the purge: a missing object is
 * harmless, an object without a row would never be cleaned up.
 */
export async function deleteUploads(db: Db, store: ObjectStore, limit: number): Promise<PurgeReport> {
  const report: PurgeReport = { deleted: 0, kept: 0, objectErrors: [] }
  for (const asset of await repo.firstAssets(db, limit)) {
    await repo.deleteAsset(db, asset.id)
    report.deleted++
    try {
      await store.del(asset.objectKey)
    }
    catch (error) {
      report.objectErrors.push({ objectKey: asset.objectKey, error: String(error) })
    }
  }
  return report
}
