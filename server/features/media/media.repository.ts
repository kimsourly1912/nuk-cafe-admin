import { and, asc, count, eq, exists, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { PhotoEdit } from '#shared/contracts/media'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { byId, firstRow, inTenant } from '#server/utils/query'
import { queueAssetObjectsStatement } from './media.objects.repository'
import { mediaAssets } from './media.schema'

// --- Row types ---

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

export interface VariantRow { parentId: string, variant: 'card' | 'detail' | 'detailSmall', objectKey: string }

// --- Columns and conditions ---

const assetColumns = {
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

const temporaryBefore = (table: { state: SQLiteColumn, stateChangedAt: SQLiteColumn }, before: Date) => and(eq(table.state, 'temporary'), lt(table.stateChangedAt, before))!

const root = alias(mediaAssets, 'expired_root')

// --- Reads ---

export async function findAsset(db: Db, tenantId: string, id: string): Promise<MediaRow | undefined> {
  return firstRow(db.select(assetColumns).from(mediaAssets).where(byId(mediaAssets, tenantId, id)))
}

/** Roots and their photo files in one snapshot per ID piece. Uses the asset primary key and media_assets_parent_idx. */
export async function imageRows(db: Db, tenantId: string, ids: string[]): Promise<{ assets: MediaRow[], variants: VariantRow[] }> {
  const source = alias(mediaAssets, 'photo_source')
  const pieces = await readInChunks(ids, async (piece) => {
    const [assets, files] = await db.batch([
      db.select(assetColumns).from(mediaAssets)
        .where(inTenant(mediaAssets, tenantId, inArray(mediaAssets.id, piece), isNull(mediaAssets.parentId))),
      db.select({ parentId: mediaAssets.parentId, variant: mediaAssets.variant, objectKey: mediaAssets.objectKey }).from(mediaAssets)
        .innerJoin(source, and(eq(source.tenantId, mediaAssets.tenantId), eq(source.id, mediaAssets.parentId)))
        .where(inTenant(
          mediaAssets,
          tenantId,
          inArray(source.id, piece),
          isNull(source.parentId),
          isNotNull(source.edit),
          isNotNull(mediaAssets.variant),
        )),
    ])
    const variants = files.flatMap(row => row.parentId && row.variant ? [{ parentId: row.parentId, variant: row.variant, objectKey: row.objectKey }] : [])
    return [{ assets, variants }]
  })
  return { assets: pieces.flatMap(piece => piece.assets), variants: pieces.flatMap(piece => piece.variants) }
}

/** The object keys of a photo's files (to delete them with it). */
export async function variantKeysOf(db: Db, tenantId: string, parentId: string): Promise<string[]> {
  return (await db.select({ objectKey: mediaAssets.objectKey }).from(mediaAssets).where(inTenant(mediaAssets, tenantId, eq(mediaAssets.parentId, parentId)))).map(r => r.objectKey)
}

/** Across cafes: expired temporary sources, oldest first; uses media_assets_purge_idx. */
export async function dueExpiredTemporary(db: Db, before: Date, limit: number): Promise<{ id: string, tenantId: string, objectKey: string }[]> {
  return db.select({ id: mediaAssets.id, tenantId: mediaAssets.tenantId, objectKey: mediaAssets.objectKey }).from(mediaAssets)
    .where(and(temporaryBefore(mediaAssets, before), isNull(mediaAssets.parentId)))
    .orderBy(asc(mediaAssets.stateChangedAt), asc(mediaAssets.id))
    .limit(limit)
}

/** The tenant's uploads, attached or not (test data resets only, D94). */
export async function countAssets(db: Db, tenantId: string): Promise<number> {
  const rows = await db.select({ n: count() }).from(mediaAssets).where(inTenant(mediaAssets, tenantId, isNull(mediaAssets.parentId)))
  return rows[0]?.n ?? 0
}

/** The cafe's next uploads to delete, oldest first; uses media_assets_tenant_idx. */
export async function listFirstAssets(db: Db, tenantId: string, limit: number): Promise<{ id: string, tenantId: string, objectKey: string }[]> {
  return db.select({ id: mediaAssets.id, tenantId: mediaAssets.tenantId, objectKey: mediaAssets.objectKey }).from(mediaAssets).where(inTenant(mediaAssets, tenantId, isNull(mediaAssets.parentId))).orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id)).limit(limit)
}

// --- Write statements ---

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

/** temporary → attached; changes nothing (follow with `requireOneChange`) if it isn't temporary, is gone or is another tenant's. */
export function attachStatement(db: Db, tenantId: string, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'attached', stateChangedAt: now })
    .where(inTenant(
      mediaAssets,
      tenantId,
      eq(mediaAssets.id, id),
      eq(mediaAssets.state, 'temporary'),
      isNull(mediaAssets.parentId),
    ))
}

/** attached → temporary: its 24 hours start now. Changes nothing if it isn't attached. */
export function releaseStatement(db: Db, tenantId: string, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'temporary', stateChangedAt: now })
    .where(inTenant(mediaAssets, tenantId, eq(mediaAssets.id, id), eq(mediaAssets.state, 'attached')))
}

/** Queue only while the cafe's root still meets the same expiry condition as its delete. */
export function queueExpiredAssetObjectsStatement(db: Db, tenantId: string, id: string, before: Date): Statement {
  const expired = exists(db.select({ id: root.id }).from(root).where(and(byId(root, tenantId, id), temporaryBefore(root, before))))
  return queueAssetObjectsStatement(db, tenantId, id, expired)
}

/** Delete only while still temporary and expired. Follow it with requireOneChange in the service's batch. */
export function deleteExpiredAssetStatement(db: Db, tenantId: string, id: string, before: Date): Statement {
  return db.delete(mediaAssets).where(and(byId(mediaAssets, tenantId, id), temporaryBefore(mediaAssets, before)))
}

/** Deletes a cafe's variants, then its source. Queue their object keys first in the same batch. */
export function deleteAssetStatements(db: Db, tenantId: string, id: string): Statement[] {
  return [
    db.delete(mediaAssets).where(inTenant(mediaAssets, tenantId, eq(mediaAssets.parentId, id))),
    db.delete(mediaAssets).where(byId(mediaAssets, tenantId, id)),
  ]
}
