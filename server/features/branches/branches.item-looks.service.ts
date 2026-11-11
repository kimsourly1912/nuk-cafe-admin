import { heightFits, heightRangeMessage, ITEM_HEIGHTS, MAX_CUSTOM_ITEM_LOOKS } from '#shared/contracts/shop-layout'
import type { CreateItemLookInput, CustomItemLook, UpdateItemLookInput } from '#shared/contracts/shop-layout'
import type { Db } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireAtMost, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { mediaNotAvailable } from '#server/features/media'
import { itemLookChanged, itemLookHeightOutOfRange, itemLookInUse, itemLookLimit, itemLookNameTaken, itemLookNotFound } from './branches.errors'
import * as repo from './branches.item-looks.repository'
import type { ItemLookRow, ItemLookValues } from './branches.item-looks.repository'
import { NAMED_USES, photoStatements, photoUrls } from './branches.looks.service'
import { audit } from './branches.service'

/**
 * A cafe's own chair and fixture looks (D273, step 3d): a kind of chair or fixture, its finishes
 * and the size a new piece starts with, under a name, for every branch. Like a table look
 * (step 3a) it is shared: editing it changes every piece placed with it, it can't be deleted while a
 * saved floor uses it, and its photo is attached and released in its batch (step 3b). Its kind is
 * set once: the pieces saved with it are of that kind.
 */

function toLook(row: ItemLookRow, pieces: number, photos: Map<string, string>): CustomItemLook {
  const { id, name, kind, finishes, defaultWidthCm, defaultDepthCm, defaultHeightCm, photoAssetId, version } = row
  const url = photoAssetId ? photos.get(photoAssetId) : undefined
  return {
    id,
    name,
    kind,
    finishes,
    defaultWidth: defaultWidthCm,
    defaultDepth: defaultDepthCm,
    defaultHeight: defaultHeightCm ?? ITEM_HEIGHTS[kind].default,
    photo: photoAssetId && url ? { id: photoAssetId, url } : null,
    version,
    pieces,
  }
}

function toValues(input: Omit<CreateItemLookInput, 'kind'>): Omit<ItemLookValues, 'kind'> {
  const { name, finishes, defaultWidth, defaultDepth, defaultHeight, photoId } = input
  return { name, finishes, defaultWidthCm: defaultWidth, defaultDepthCm: defaultDepth, defaultHeightCm: defaultHeight ?? null, photoAssetId: photoId ?? null }
}

/** The cafe's chair and fixture looks by name, each with how many placed pieces use it and its photo. */
export async function listItemLooks(db: Db, tenantId: string): Promise<CustomItemLook[]> {
  const { looks, use } = await repo.itemLooksWithUse(db, tenantId)
  const photos = await photoUrls(db, tenantId, looks)
  return looks.map(look => toLook(look, use.get(look.id) ?? 0, photos))
}

async function loadItemLook(db: Db, tenantId: string, id: string): Promise<CustomItemLook> {
  const row = await repo.findItemLook(db, tenantId, id)
  if (!row) throw itemLookNotFound()
  const [use, photos] = await Promise.all([repo.itemLookUse(db, tenantId, id, 0), photoUrls(db, tenantId, [row])])
  return toLook(row, use.total, photos)
}

/** The look at the version read; another cafe's or an unknown one is 404. */
async function openItemLook(db: Db, tenantId: string, id: string, version: number): Promise<ItemLookRow> {
  const row = await repo.findItemLook(db, tenantId, id)
  if (!row) throw itemLookNotFound()
  if (row.version !== version) throw itemLookChanged()
  return row
}

/** A new chair or fixture look for the cafe. A name in use is `itemLookNameTaken`; past the limit, `itemLookLimit`. */
export async function createItemLook(db: Db, actor: Actor, input: CreateItemLookInput): Promise<CustomItemLook> {
  const { tenantId } = actor
  if (await repo.countItemLooks(db, tenantId) >= MAX_CUSTOM_ITEM_LOOKS) throw itemLookLimit()
  const id = newId()
  const values: ItemLookValues = { kind: input.kind, ...toValues(input) }
  try {
    await db.batch([
      repo.insertItemLookStatement(db, tenantId, id, values, new Date()),
      // Two creates at once: the count is checked again with this look in it.
      requireAtMost(db, repo.itemLookCount(db, tenantId), MAX_CUSTOM_ITEM_LOOKS),
      ...await photoStatements(db, tenantId, null, values.photoAssetId),
      audit(db, actor, 'item-look.create', 'furniture_item_look', id, { name: input.name, kind: input.kind, photo: Boolean(values.photoAssetId) }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw itemLookNameTaken(input.name)
    if (!isStaleWrite(error)) throw error
    // The limit's guard or the photo's (used or cleaned up meanwhile): the count tells which.
    throw values.photoAssetId && await repo.countItemLooks(db, tenantId) < MAX_CUSTOM_ITEM_LOOKS ? mediaNotAvailable('photoId') : itemLookLimit()
  }
  return loadItemLook(db, tenantId, id)
}

/** Replaces the look at the version read (its kind stays): every piece placed with it changes with it. */
export async function updateItemLook(db: Db, actor: Actor, id: string, input: UpdateItemLookInput): Promise<CustomItemLook> {
  const { tenantId } = actor
  const { version, ...fields } = input
  const current = await openItemLook(db, tenantId, id, version)
  // The edit has no kind (it never changes), so its height is checked against the look's here.
  if (fields.defaultHeight !== null && !heightFits(current.kind, fields.defaultHeight)) throw itemLookHeightOutOfRange(heightRangeMessage(current.kind))
  const values = toValues(fields)
  const photoChanging = values.photoAssetId !== current.photoAssetId
  try {
    await db.batch([
      repo.updateItemLookStatement(db, tenantId, id, version, values, new Date()),
      requireOneChange(db),
      ...await photoStatements(db, tenantId, current.photoAssetId, values.photoAssetId),
      audit(db, actor, 'item-look.update', 'furniture_item_look', id, {
        name: fields.name === current.name ? current.name : { from: current.name, to: fields.name },
        ...(photoChanging && { photo: values.photoAssetId ? 'set' : 'removed' }),
      }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw itemLookNameTaken(fields.name)
    if (!isStaleWrite(error)) throw error
    // The version's guard or the new photo's: a look still at the version read means the photo.
    const now = await repo.findItemLook(db, tenantId, id)
    if (!now) throw itemLookNotFound()
    throw now.version === version && photoChanging && values.photoAssetId ? mediaNotAvailable('photoId') : itemLookChanged()
  }
  return loadItemLook(db, tenantId, id)
}

/**
 * Deletes a look no placed piece uses. One in use is `itemLookInUse`, naming the floors that hold
 * its pieces: the check here gives the message, and the uses' foreign key refuses a use saved
 * meanwhile.
 */
export async function deleteItemLook(db: Db, actor: Actor, id: string, input: { version: number }): Promise<void> {
  const { tenantId } = actor
  const current = await openItemLook(db, tenantId, id, input.version)
  const use = await repo.itemLookUse(db, tenantId, id, NAMED_USES)
  if (use.total) throw itemLookInUse(use.places, use.total)
  try {
    await db.batch([
      repo.deleteItemLookStatement(db, tenantId, id, input.version),
      requireOneChange(db),
      // Its photo is no one's now: its 24 hours start (the media feature's cleanup).
      ...await photoStatements(db, tenantId, current.photoAssetId, null),
      audit(db, actor, 'item-look.delete', 'furniture_item_look', id, { name: current.name }),
    ])
  }
  catch (error) {
    if (isForeignKeyError(error)) {
      const now = await repo.itemLookUse(db, tenantId, id, NAMED_USES)
      throw itemLookInUse(now.places, now.total)
    }
    if (!isStaleWrite(error)) throw error
    throw await repo.findItemLook(db, tenantId, id) ? itemLookChanged() : itemLookNotFound()
  }
}
