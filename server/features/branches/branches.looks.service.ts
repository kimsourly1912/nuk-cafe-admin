import { MAX_CUSTOM_LOOKS } from '#shared/contracts/shop-layout'
import type { CreateLookInput, CustomLook, UpdateLookInput } from '#shared/contracts/shop-layout'
import type { Db } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireAtMost, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { lookChanged, lookInUse, lookLimit, lookNameTaken, lookNotFound } from './branches.errors'
import * as repo from './branches.looks.repository'
import type { LookRow, LookValues } from './branches.looks.repository'
import { audit } from './branches.service'

/**
 * A cafe's own table looks (D273, step 3a): a shape, a base, chairs and finishes under a name,
 * for every branch of the cafe. A look is shared: editing it changes every table placed with it,
 * and it can't be deleted while a saved layout uses it. Each placement keeps its own size and turn.
 */

/** How many of the tables using a look its delete refusal names. */
const NAMED_TABLES = 5

function toLook(row: LookRow, tables: number): CustomLook {
  const { id, name, shape, base, chair, finishes, defaultWidthCm, defaultDepthCm, version } = row
  return { id, name, shape, base, chair, finishes, defaultWidth: defaultWidthCm, defaultDepth: defaultDepthCm, version, tables }
}

function toValues(input: CreateLookInput): LookValues {
  const { name, shape, base, chair, finishes, defaultWidth, defaultDepth } = input
  return { name, shape, base, chair, finishes, defaultWidthCm: defaultWidth, defaultDepthCm: defaultDepth }
}

/** The cafe's custom looks by name, each with how many placed tables use it. */
export async function listLooks(db: Db, tenantId: string): Promise<CustomLook[]> {
  const { looks, use } = await repo.looksWithUse(db, tenantId)
  return looks.map(look => toLook(look, use.get(look.id) ?? 0))
}

async function loadLook(db: Db, tenantId: string, id: string): Promise<CustomLook> {
  const row = await repo.findLook(db, tenantId, id)
  if (!row) throw lookNotFound()
  return toLook(row, (await repo.lookUse(db, tenantId, id, 0)).total)
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
  try {
    await db.batch([
      repo.insertLookStatement(db, tenantId, id, toValues(input), new Date()),
      // Two creates at once: the count is checked again with this look in it.
      requireAtMost(db, repo.lookCount(db, tenantId), MAX_CUSTOM_LOOKS),
      audit(db, actor, 'look.create', 'furniture_look', id, { name: input.name, shape: input.shape }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(input.name)
    if (isStaleWrite(error)) throw lookLimit()
    throw error
  }
  return loadLook(db, tenantId, id)
}

/** Replaces the look at the version read: every table placed with it changes with it. */
export async function updateLook(db: Db, actor: Actor, id: string, input: UpdateLookInput): Promise<CustomLook> {
  const { tenantId } = actor
  const { version, ...fields } = input
  const current = await openLook(db, tenantId, id, version)
  try {
    await db.batch([
      repo.updateLookStatement(db, tenantId, id, version, toValues(fields), new Date()),
      requireOneChange(db),
      audit(db, actor, 'look.update', 'furniture_look', id, {
        name: fields.name === current.name ? current.name : { from: current.name, to: fields.name },
      }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw lookNameTaken(fields.name)
    if (!isStaleWrite(error)) throw error
    throw await repo.findLook(db, tenantId, id) ? lookChanged() : lookNotFound()
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
