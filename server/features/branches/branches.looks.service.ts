import { MAX_CUSTOM_LOOKS } from '#shared/contracts/shop-layout'
import type { CreateLookInput, CustomLook, UpdateLookInput } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireAtMost, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { assetUrls, attachStatements, mediaNotAvailable, releaseStatement } from '#server/features/media'
import { lookChanged, lookInUse, lookLimit, lookNameTaken, lookNotFound } from './branches.errors'
import * as repo from './branches.looks.repository'
import type { LookRow, LookValues } from './branches.looks.repository'
import { audit } from './branches.service'

/**
 * A cafe's own table looks (D273, step 3a): a shape, a base, chairs and finishes under a name,
 * for every branch of the cafe. A look is shared: editing it changes every table placed with it,
 * and it can't be deleted while a saved layout uses it. Each placement keeps its own size and turn.
 * Its photo (step 3b) is an upload of the cafe's, attached in the look's batch and released when
 * the look replaces, removes or is deleted with it (the media feature's lifecycle).
 */

/** How many of the tables (or floors, for an item look) using a look its delete refusal names. */
export const NAMED_USES = 5

/** `photos`: each photo's URL by upload id; a photo whose upload is gone shows none. */
function toLook(row: LookRow, tables: number, photos: Map<string, string>): CustomLook {
  const { id, name, shape, base, chair, finishes, defaultWidthCm, defaultDepthCm, photoAssetId, version } = row
  const url = photoAssetId ? photos.get(photoAssetId) : undefined
  return {
    id,
    name,
    shape,
    base,
    chair,
    finishes,
    defaultWidth: defaultWidthCm,
    defaultDepth: defaultDepthCm,
    photo: photoAssetId && url ? { id: photoAssetId, url } : null,
    version,
    tables,
  }
}

function toValues(input: CreateLookInput): LookValues {
  const { name, shape, base, chair, finishes, defaultWidth, defaultDepth, photoId } = input
  return { name, shape, base, chair, finishes, defaultWidthCm: defaultWidth, defaultDepthCm: defaultDepth, photoAssetId: photoId ?? null }
}

export const photoUrls = (db: Db, tenantId: string, rows: { photoAssetId: string | null }[]) =>
  assetUrls(db, tenantId, rows.flatMap(row => (row.photoAssetId ? [row.photoAssetId] : [])))

/** The cafe's custom looks by name, each with how many placed tables use it and its photo. */
export async function listLooks(db: Db, tenantId: string): Promise<CustomLook[]> {
  const { looks, use } = await repo.looksWithUse(db, tenantId)
  const photos = await photoUrls(db, tenantId, looks)
  return looks.map(look => toLook(look, use.get(look.id) ?? 0, photos))
}

async function loadLook(db: Db, tenantId: string, id: string): Promise<CustomLook> {
  const row = await repo.findLook(db, tenantId, id)
  if (!row) throw lookNotFound()
  const [use, photos] = await Promise.all([repo.lookUse(db, tenantId, id, 0), photoUrls(db, tenantId, [row])])
  return toLook(row, use.total, photos)
}

/**
 * The statements that move the look from photo `from` to photo `to`: release the one it drops,
 * attach (and guard) the one it takes. Nothing when the photo stays. The attach checks the upload
 * now: another cafe's, a used one or one cleaned up is `mediaNotAvailable('photoId')`. Shared by
 * table looks and item looks (step 3d): the same lifecycle.
 */
export async function photoStatements(db: Db, tenantId: string, from: string | null, to: string | null): Promise<Statement[]> {
  if (from === to) return []
  return [
    ...(from ? [releaseStatement(db, tenantId, from)] : []),
    ...(to ? await attachStatements(db, tenantId, to, 'photoId') : []),
  ]
}

/** The look at the version read; another cafe's or an unknown one is 404. */
async function openLook(db: Db, tenantId: string, id: string, version: number): Promise<LookRow> {
  const row = await repo.findLook(db, tenantId, id)
  if (!row) throw lookNotFound()
  if (row.version !== version) throw lookChanged()
  return row
}

/** A new look for the cafe. A name in use is `lookNameTaken`; past the limit, `lookLimit`. */
export async function createLook(db: Db, actor: Actor, input: CreateLookInput): Promise<CustomLook> {
  const { tenantId } = actor
  if (await repo.countLooks(db, tenantId) >= MAX_CUSTOM_LOOKS) throw lookLimit()
  const id = newId()
  const values = toValues(input)
  try {
    await db.batch([
      repo.insertLookStatement(db, tenantId, id, values, new Date()),
      // Two creates at once: the count is checked again with this look in it.
      requireAtMost(db, repo.lookCount(db, tenantId), MAX_CUSTOM_LOOKS),
      ...await photoStatements(db, tenantId, null, values.photoAssetId),
      audit(db, actor, 'look.create', 'furniture_look', id, { name: input.name, shape: input.shape, photo: Boolean(values.photoAssetId) }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(input.name)
    if (!isStaleWrite(error)) throw error
    // The limit's guard or the photo's (used or cleaned up meanwhile): the count tells which.
    throw values.photoAssetId && await repo.countLooks(db, tenantId) < MAX_CUSTOM_LOOKS ? mediaNotAvailable('photoId') : lookLimit()
  }
  return loadLook(db, tenantId, id)
}

/** Replaces the look at the version read: every table placed with it changes with it. */
export async function updateLook(db: Db, actor: Actor, id: string, input: UpdateLookInput): Promise<CustomLook> {
  const { tenantId } = actor
  const { version, ...fields } = input
  const current = await openLook(db, tenantId, id, version)
  const values = toValues(fields)
  const photoChanging = values.photoAssetId !== current.photoAssetId
  try {
    await db.batch([
      repo.updateLookStatement(db, tenantId, id, version, values, new Date()),
      requireOneChange(db),
      ...await photoStatements(db, tenantId, current.photoAssetId, values.photoAssetId),
      audit(db, actor, 'look.update', 'furniture_look', id, {
        name: fields.name === current.name ? current.name : { from: current.name, to: fields.name },
        ...(photoChanging && { photo: values.photoAssetId ? 'set' : 'removed' }),
      }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(fields.name)
    if (!isStaleWrite(error)) throw error
    // The version's guard or the new photo's: a look still at the version read means the photo.
    const now = await repo.findLook(db, tenantId, id)
    if (!now) throw lookNotFound()
    throw now.version === version && photoChanging && values.photoAssetId ? mediaNotAvailable('photoId') : lookChanged()
  }
  return loadLook(db, tenantId, id)
}

/**
 * Deletes a look no placed table uses. One in use is `lookInUse`, naming some of its tables: the
 * check here gives the message, and the placements' foreign key refuses a use saved meanwhile.
 */
export async function deleteLook(db: Db, actor: Actor, id: string, input: { version: number }): Promise<void> {
  const { tenantId } = actor
  const current = await openLook(db, tenantId, id, input.version)
  const use = await repo.lookUse(db, tenantId, id, NAMED_USES)
  if (use.total) throw lookInUse(use.tables, use.total)
  try {
    await db.batch([
      repo.deleteLookStatement(db, tenantId, id, input.version),
      requireOneChange(db),
      // Its photo is no one's now: its 24 hours start (the media feature's cleanup).
      ...await photoStatements(db, tenantId, current.photoAssetId, null),
      audit(db, actor, 'look.delete', 'furniture_look', id, { name: current.name }),
    ])
  }
  catch (error) {
    if (isForeignKeyError(error)) {
      const now = await repo.lookUse(db, tenantId, id, NAMED_USES)
      throw lookInUse(now.tables, now.total)
    }
    if (!isStaleWrite(error)) throw error
    throw await repo.findLook(db, tenantId, id) ? lookChanged() : lookNotFound()
  }
}
