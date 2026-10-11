import { and, asc, count, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { PhotoEdit } from '#shared/contracts/media'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { mediaAssets } from './media.schema'

export interface MediaRow {
  id: string
  objectKey: string
  mimeType: string
  byteSize: number
  state: 'temporary' | 'attached'
  stateChangedAt: Date
  /** Set on a menu photo's files (D158): the photo (its source) they were made from. */
  parentId: string | null
  placeholder: string | null
  edit: PhotoEdit | null
}

const columns = {
  id: mediaAssets.id,
  objectKey: mediaAssets.objectKey,
  mimeType: mediaAssets.mimeType,
  byteSize: mediaAssets.byteSize,
  state: mediaAssets.state,
  stateChangedAt: mediaAssets.stateChangedAt,
  parentId: mediaAssets.parentId,
  placeholder: mediaAssets.placeholder,
  edit: mediaAssets.edit,
}

export async function findAsset(db: Db, tenantId: string, id: string): Promise<MediaRow | undefined> {
  const rows: MediaRow[] = await db.select(columns).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.id, id))).limit(1)
  return rows[0]
}

export async function findAssets(db: Db, tenantId: string, ids: string[]): Promise<MediaRow[]> {
  return readInChunks(ids, piece => db.select(columns).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), inArray(mediaAssets.id, piece))))
}

export interface NewAsset {
  id: string
  tenantId: string
  objectKey: string
  mimeType: string
  byteSize: number
  sha256: string
  uploadedBy: string
  now: Date
  /** A menu photo's file (D158). */
  parentId?: string
  variant?: 'card' | 'detail' | 'detailSmall'
  width?: number
  height?: number
  /** A menu photo's source (D158). */
  placeholder?: string
  edit?: PhotoEdit
}

export function insertAssetStatement(db: Db, row: NewAsset): Statement {
  return db.insert(mediaAssets).values({
    id: row.id,
    tenantId: row.tenantId,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    createdAt: row.now,
    stateChangedAt: row.now,
    parentId: row.parentId,
    variant: row.variant,
    width: row.width,
    height: row.height,
    placeholder: row.placeholder,
    edit: row.edit,
  })
}

/** The files made from these photos (D158), each with the photo it belongs to. */
export async function findVariants(db: Db, tenantId: string, parentIds: string[]): Promise<{ parentId: string, variant: 'card' | 'detail' | 'detailSmall', objectKey: string }[]> {
  const rows = await readInChunks(parentIds, piece => db.select({ parentId: mediaAssets.parentId, variant: mediaAssets.variant, objectKey: mediaAssets.objectKey }).from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, tenantId), inArray(mediaAssets.parentId, piece))))
  return rows.flatMap(row => (row.parentId && row.variant ? [{ parentId: row.parentId, variant: row.variant, objectKey: row.objectKey }] : []))
}

/** The object keys of a photo's files (to delete them with it). */
export async function variantKeys(db: Db, parentId: string): Promise<string[]> {
  return (await db.select({ objectKey: mediaAssets.objectKey }).from(mediaAssets).where(eq(mediaAssets.parentId, parentId))).map(r => r.objectKey)
}

/** temporary → attached; changes nothing (follow with `requireOneChange`) if it isn't temporary, is gone or is another tenant's. */
export function attachStatement(db: Db, tenantId: string, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'attached', stateChangedAt: now })
    .where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.id, id), eq(mediaAssets.state, 'temporary'), isNull(mediaAssets.parentId)))
}

/** attached → temporary: its 24 hours start now. Changes nothing if it isn't attached. */
export function releaseStatement(db: Db, tenantId: string, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'temporary', stateChangedAt: now })
    .where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.id, id), eq(mediaAssets.state, 'attached')))
}

/** Temporary assets whose state is older than `before`, oldest first. */
export async function findExpiredTemporary(db: Db, before: Date, limit: number): Promise<{ id: string, objectKey: string }[]> {
  return db.select({ id: mediaAssets.id, objectKey: mediaAssets.objectKey }).from(mediaAssets)
    .where(and(eq(mediaAssets.state, 'temporary'), lt(mediaAssets.stateChangedAt, before), isNull(mediaAssets.parentId)))
    .orderBy(asc(mediaAssets.stateChangedAt))
    .limit(limit)
}

/**
 * Deletes the row only if it's still temporary and still expired: an attach (or a release that
 * restarted its 24 hours) since it was found keeps it. Returns whether it was deleted.
 */
export async function deleteIfStillExpired(db: Db, id: string, before: Date): Promise<boolean> {
  const rows = await db.delete(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.state, 'temporary'), lt(mediaAssets.stateChangedAt, before)))
    .returning({ id: mediaAssets.id })
  return rows.length === 1
}

/** The tenant's uploads, attached or not (test data resets only, D94). */
export async function countAssets(db: Db, tenantId: string): Promise<number> {
  const rows = await db.select({ n: count() }).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), isNull(mediaAssets.parentId)))
  return rows[0]?.n ?? 0
}

/** The tenant's next uploads to delete, oldest first. */
export async function firstAssets(db: Db, tenantId: string, limit: number): Promise<{ id: string, objectKey: string }[]> {
  return db.select({ id: mediaAssets.id, objectKey: mediaAssets.objectKey }).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), isNull(mediaAssets.parentId))).orderBy(asc(mediaAssets.createdAt)).limit(limit)
}

/** Deletes an upload and, for a menu photo, its files' rows (D158). */
export async function deleteAsset(db: Db, id: string): Promise<void> {
  await db.batch([db.delete(mediaAssets).where(eq(mediaAssets.parentId, id)), db.delete(mediaAssets).where(eq(mediaAssets.id, id))])
}
