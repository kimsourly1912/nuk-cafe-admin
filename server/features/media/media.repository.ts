import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type { Db, Statement } from '../../utils/batch'
import { readInChunks } from '../../utils/batch'
import { mediaAssets } from './media.schema'

export interface MediaRow {
  id: string
  objectKey: string
  mimeType: string
  byteSize: number
  state: 'temporary' | 'attached'
  stateChangedAt: Date
}

const columns = {
  id: mediaAssets.id,
  objectKey: mediaAssets.objectKey,
  mimeType: mediaAssets.mimeType,
  byteSize: mediaAssets.byteSize,
  state: mediaAssets.state,
  stateChangedAt: mediaAssets.stateChangedAt,
}

export async function findAsset(db: Db, id: string): Promise<MediaRow | undefined> {
  const rows: MediaRow[] = await db.select(columns).from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
  return rows[0]
}

export async function findAssets(db: Db, ids: string[]): Promise<MediaRow[]> {
  return readInChunks(ids, piece => db.select(columns).from(mediaAssets).where(inArray(mediaAssets.id, piece)))
}

export function insertAssetStatement(db: Db, row: { id: string, objectKey: string, mimeType: string, byteSize: number, sha256: string, uploadedBy: string, now: Date }): Statement {
  return db.insert(mediaAssets).values({
    id: row.id,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    createdAt: row.now,
    stateChangedAt: row.now,
  })
}

/** temporary → attached; changes nothing (follow with `requireOneChange`) if it isn't temporary or is gone. */
export function attachStatement(db: Db, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'attached', stateChangedAt: now })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.state, 'temporary')))
}

/** attached → temporary: its 24 hours start now. Changes nothing if it isn't attached. */
export function releaseStatement(db: Db, id: string, now: Date): Statement {
  return db.update(mediaAssets).set({ state: 'temporary', stateChangedAt: now })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.state, 'attached')))
}

/** Temporary assets whose state is older than `before`, oldest first. */
export async function findExpiredTemporary(db: Db, before: Date, limit: number): Promise<{ id: string, objectKey: string }[]> {
  return db.select({ id: mediaAssets.id, objectKey: mediaAssets.objectKey }).from(mediaAssets)
    .where(and(eq(mediaAssets.state, 'temporary'), lt(mediaAssets.stateChangedAt, before)))
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
