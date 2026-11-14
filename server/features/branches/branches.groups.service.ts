import { MAX_LAYOUT_GROUPS } from '#shared/contracts/shop-layout'
import type { CreateLayoutGroupInput, LayoutGroup } from '#shared/contracts/shop-layout'
import type { Db } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireAtMost, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import type { Actor } from '#server/features/identity'
import { groupChanged, groupLimit, groupNameTaken, groupNotFound } from './branches.errors'
import * as repo from './branches.groups.repository'
import type { GroupRow } from './branches.groups.repository'
import { audit } from './branches.service'

/**
 * A cafe's saved groups (plan Phase 5, D284): pieces and walls under a name, for every branch.
 * Placing one copies its pieces with new ids into a floor's drawing, saved with the layout: no
 * layout points at a group, so a group is deleted at any time and nothing else changes. The pieces
 * are checked by the shared contract; a custom look a piece names is checked again when the layout
 * holding its copy is saved.
 */

function toGroup(row: GroupRow): LayoutGroup {
  return { id: row.id, name: row.name, items: row.pieces.items, walls: row.pieces.walls, version: row.version }
}

export async function listGroups(db: Db, tenantId: string): Promise<LayoutGroup[]> {
  return (await repo.listGroups(db, tenantId)).map(toGroup)
}

/** A new group for the cafe. A name in use is `groupNameTaken`; past the limit, `groupLimit`. */
export async function createGroup(db: Db, actor: Actor, input: CreateLayoutGroupInput): Promise<LayoutGroup> {
  const { tenantId } = actor
  if (await repo.countGroups(db, tenantId) >= MAX_LAYOUT_GROUPS) throw groupLimit()
  const id = newId()
  try {
    await db.batch([
      repo.insertGroupStatement(db, tenantId, id, input.name, { items: input.items, walls: input.walls }, new Date()),
      // Two creates at once: the count is checked again with this group in it.
      requireAtMost(db, repo.groupCount(db, tenantId), MAX_LAYOUT_GROUPS),
      audit(db, actor, 'group.create', 'layout_group', id, { name: input.name, items: input.items.length, walls: input.walls.length }),
    ])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw groupNameTaken(input.name)
    if (isStaleWrite(error)) throw groupLimit()
    throw error
  }
  const row = await repo.findGroup(db, tenantId, id)
  if (!row) throw groupNotFound()
  return toGroup(row)
}

/** Deletes the group at the version read; another cafe's or an unknown one is 404. */
export async function deleteGroup(db: Db, actor: Actor, id: string, input: { version: number }): Promise<void> {
  const { tenantId } = actor
  const current = await repo.findGroup(db, tenantId, id)
  if (!current) throw groupNotFound()
  if (current.version !== input.version) throw groupChanged()
  try {
    await db.batch([
      repo.deleteGroupStatement(db, tenantId, id, input.version),
      requireOneChange(db),
      audit(db, actor, 'group.delete', 'layout_group', id, { name: current.name }),
    ])
  }
  catch (error) {
    if (!isStaleWrite(error)) throw error
    throw await repo.findGroup(db, tenantId, id) ? groupChanged() : groupNotFound()
  }
}
