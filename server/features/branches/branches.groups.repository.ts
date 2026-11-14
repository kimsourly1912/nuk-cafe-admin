import { asc } from 'drizzle-orm'
import type { LayoutItem, Wall } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant } from '#server/utils/query'
import { layoutGroups } from './branches.schema'

// --- Row types ---

export interface GroupRow {
  id: string
  name: string
  pieces: { items: LayoutItem[], walls: Wall[] }
  version: number
}

const groupColumns = {
  id: layoutGroups.id,
  name: layoutGroups.name,
  pieces: layoutGroups.pieces,
  version: layoutGroups.version,
}

// --- Reads ---

/** The cafe's saved groups by name; at most MAX_LAYOUT_GROUPS. */
export function listGroups(db: Db, tenantId: string): Promise<GroupRow[]> {
  return db.select(groupColumns).from(layoutGroups)
    .where(inTenant(layoutGroups, tenantId))
    .orderBy(byName(layoutGroups.name), asc(layoutGroups.id))
}

export function findGroup(db: Db, tenantId: string, id: string): Promise<GroupRow | undefined> {
  return firstRow(db.select(groupColumns).from(layoutGroups).where(byId(layoutGroups, tenantId, id)))
}

export function countGroups(db: Db, tenantId: string): Promise<number> {
  return db.$count(layoutGroups, inTenant(layoutGroups, tenantId))
}

// --- Guards ---

/** The scalar count of the cafe's groups, for `requireAtMost`. */
export const groupCount = (db: Db, tenantId: string) => db.$count(layoutGroups, inTenant(layoutGroups, tenantId))

// --- Write statements ---

/** Fails on the name's unique index when the cafe has a group of that name (in any capitals). */
export function insertGroupStatement(db: Db, tenantId: string, id: string, name: string, pieces: GroupRow['pieces'], now: Date): Statement {
  return db.insert(layoutGroups).values({ id, tenantId, name, pieces, version: 1, createdAt: now, updatedAt: now })
}

/** Deletes the group if it's still at `version`. Follow it with `requireOneChange`. */
export function deleteGroupStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(layoutGroups).where(atVersion(layoutGroups, tenantId, id, version))
}
