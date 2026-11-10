import { MAX_CUSTOM_LOOKS } from '#shared/contracts/shop-layout'
import type { CreateLookInput, CustomLook, UpdateLookInput } from '#shared/contracts/shop-layout'
import type { Db } from '#server/utils/batch'
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
 * A look may have a photo (step 3b): an upload of the cafe's, attached while the look uses it and
 * released (its 24 hours start) when the look drops, replaces or deletes it, in the look's batch.
 */

/** How many of the tables using a look its delete refusal names. */
const NAMED_TABLES = 5

/** The field a photo that can't be used is named on. */
const PHOTO_FIELD = 'photoId'

/** `urls`: the photos' addresses by id; a photo that is gone (none in `urls`) shows as none. */
function toLook(row: LookRow, tables: number, urls: Map<string, string>): CustomLook {
  const { id, name, shape, base, chair, finishes, defaultWidthCm, defaultDepthCm, photoAssetId, version } = row
  const url = photoAssetId ? urls.get(photoAssetId) : undefined
  const photo = photoAssetId && url ? { id: photoAssetId, url } : null
  return { id, name, shape, base, chair, finishes, defaultWidth: defaultWidthCm, defaultDepth: defaultDepthCm, photo, version, tables }
}

function toValues(input: CreateLookInput): LookValues {
  const { name, shape, base, chair, finishes, defaultWidth, defaultDepth, photoId } = input
  return { name, shape, base, chair, finishes, defaultWidthCm: defaultWidth, defaultDepthCm: defaultDepth, photoAssetId: photoId }
}

function photoUrls(db: Db, tenantId: string, rows: LookRow[]): Promise<Map<string, string>> {
  const ids = rows.flatMap(row => (row.photoAssetId ? [row.photoAssetId] : []))
  return ids.length ? assetUrls(db, tenantId, ids) : Promise.resolve(new Map())
}

/** The cafe's custom looks by name, each with how many placed tables use it. */
export async function listLooks(db: Db, tenantId: string): Promise<CustomLook[]> {
  const { looks, use } = await repo.looksWithUse(db, tenantId)
  const urls = await photoUrls(db, tenantId, looks)
  return looks.map(look => toLook(look, use.get(look.id) ?? 0, urls))
}

async function loadLook(db: Db, tenantId: string, id: string): Promise<CustomLook> {
  const row = await repo.findLook(db, tenantId, id)
  if (!row) throw lookNotFound()
  const [use, urls] = await Promise.all([repo.lookUse(db, tenantId, id, 0), photoUrls(db, tenantId, [row])])
  return toLook(row, use.total, urls)
}

/**
 * The statements that move a look from photo `from` to photo `to`: the old one released, the new
 * one attached (422 `MEDIA_NOT_AVAILABLE` on `photoId` when it isn't a fresh upload of this cafe's).
 * None when the photo stays.
 */
async function photoStatements(db: Db, tenantId: string, from: string | null, to: string | null) {
  if (from === to) return []
  return [
    ...(from ? [releaseStatement(db, tenantId, from)] : []),
    ...(to ? await attachStatements(db, tenantId, to, PHOTO_FIELD) : []),
  ]
}

/** The look at the version read; another cafe's or an unknown one is 404. */
async function openLook(db: Db, tenantId: string, id: string, version: number): Promise<LookRow> {
  const row = await repo.findLook(db, tenantId, id)
  if (!row) throw lookNotFound()
  if (row.version !== version) throw lookChanged()
  return row
}

/**
 * A new look for the cafe. A name in use is `lookNameTaken`; past the limit, `lookLimit`; a photo
 * that isn't a fresh upload of this cafe's, `mediaNotAvailable`.
 */
export async function createLook(db: Db, actor: Actor, input: CreateLookInput): Promise<CustomLook> {
  const { tenantId } = actor
  if (await repo.countLooks(db, tenantId) >= MAX_CUSTOM_LOOKS) throw lookLimit()
  const id = newId()
  try {
    await db.batch([
      repo.insertLookStatement(db, tenantId, id, toValues(input), new Date()),
      // Two creates at once: the count is checked again with this look in it.
      requireAtMost(db, repo.lookCount(db, tenantId), MAX_CUSTOM_LOOKS),
      ...await photoStatements(db, tenantId, null, input.photoId),
      audit(db, actor, 'look.create', 'furniture_look', id, { name: input.name, shape: input.shape, photo: !!input.photoId }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(input.name)
    if (!isStaleWrite(error)) throw error
    // Either other looks filled the cafe's limit, or the photo was used or cleaned up meanwhile.
    if (!input.photoId || await repo.countLooks(db, tenantId) >= MAX_CUSTOM_LOOKS) throw lookLimit()
    throw mediaNotAvailable(PHOTO_FIELD)
  }
  return loadLook(db, tenantId, id)
}

/** Replaces the look at the version read: every table placed with it changes with it. */
export async function updateLook(db: Db, actor: Actor, id: string, input: UpdateLookInput): Promise<CustomLook> {
  const { tenantId } = actor
  const { version, ...fields } = input
  const current = await openLook(db, tenantId, id, version)
  const photoChanged = current.photoAssetId !== fields.photoId
  try {
    await db.batch([
      repo.updateLookStatement(db, tenantId, id, version, toValues(fields), new Date()),
      requireOneChange(db),
      ...await photoStatements(db, tenantId, current.photoAssetId, fields.photoId),
      audit(db, actor, 'look.update', 'furniture_look', id, {
        name: fields.name === current.name ? current.name : { from: current.name, to: fields.name },
        photoChanged,
      }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(fields.name)
    if (!isStaleWrite(error)) throw error
    // Someone changed or deleted the look, or the new photo was used or cleaned up meanwhile.
    const now = await repo.findLook(db, tenantId, id)
    if (!now) throw lookNotFound()
    throw now.version === version && photoChanged && fields.photoId ? mediaNotAvailable(PHOTO_FIELD) : lookChanged()
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
  const use = await repo.lookUse(db, tenantId, id, NAMED_TABLES)
  if (use.total) throw lookInUse(use.tables, use.total)
  try {
    await db.batch([
      repo.deleteLookStatement(db, tenantId, id, input.version),
      requireOneChange(db),
      ...await photoStatements(db, tenantId, current.photoAssetId, null),
      audit(db, actor, 'look.delete', 'furniture_look', id, { name: current.name }),
    ])
  }
  catch (error) {
    if (isForeignKeyError(error)) {
      const now = await repo.lookUse(db, tenantId, id, NAMED_TABLES)
      throw lookInUse(now.tables, now.total)
    }
    if (!isStaleWrite(error)) throw error
    throw await repo.findLook(db, tenantId, id) ? lookChanged() : lookNotFound()
  }
}
